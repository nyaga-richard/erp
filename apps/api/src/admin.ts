import {Inject,Injectable} from '@nestjs/common';
import {PoolClient} from 'pg';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {Db,Context,BusinessError,audit} from './db';
import {CommandService} from './commands';
import {hashPassword} from './security';
const reason=z.string().trim().min(5).max(500),ids=z.array(z.string().uuid()).max(100).refine(v=>new Set(v).size===v.length,'Duplicate IDs');
const roleInput=z.object({name:z.string().trim().min(3).max(80),permissions:z.array(z.string().min(3).max(80)).min(1).max(100).refine(v=>new Set(v).size===v.length,'Duplicate permission'),reason}).strict();
const access=z.object({active:z.boolean(),roleIds:ids.refine(v=>v.length>0,"At least one role is required"),branchIds:ids,expectedVersion:z.number().int().positive(),reason}).strict();
@Injectable()
export class AdminService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService){}
 async listUsers(ctx:Context,query:any){const v=z.object({q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`];const total=(await c.query("SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND u.principal_type='HUMAN' AND (u.email ILIKE $2 OR u.display_name ILIKE $2)",args)).rows[0].n;
  const rows=(await c.query(`SELECT u.id,u.email,u.display_name,u.active AS identity_active,m.active,m.version,m.super_admin FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND u.principal_type='HUMAN' AND (u.email ILIKE $2 OR u.display_name ILIKE $2) ORDER BY u.display_name,u.id LIMIT $3 OFFSET $4`,[...args,v.limit,(v.page-1)*v.limit])).rows;
  // role IDs and branch scope are permissioned company data, never global identity secrets.
  for(const u of rows){u.roleIds=(await c.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2',[ctx.companyId,u.id])).rows.map(r=>r.role_id);u.branchIds=(await c.query('SELECT branch_id FROM user_branch_scopes WHERE company_id=$1 AND user_id=$2',[ctx.companyId,u.id])).rows.map(r=>r.branch_id);}
  return {data:rows,total,page:v.page,limit:v.limit};
 });}
 async roles(ctx:Context){return this.db.transaction(ctx,async c=>(await c.query(`SELECT r.id,r.name,r.version,r.created_by,coalesce((SELECT jsonb_agg(permission_code ORDER BY permission_code) FROM role_permissions p WHERE p.company_id=r.company_id AND p.role_id=r.id),'[]') AS permissions FROM roles r WHERE r.company_id=$1 ORDER BY r.name LIMIT 100`,[ctx.companyId])).rows);}
 async permissions(ctx:Context){return this.db.transaction(ctx,async c=>{const superAdmin=await this.isSuperAdmin(c,ctx);return {permissions:(await c.query('SELECT code,description FROM permissions ORDER BY code')).rows,delegable:superAdmin?(await c.query('SELECT code AS permission_code FROM permissions ORDER BY code')).rows.map(r=>r.permission_code):(await c.query('SELECT permission_code FROM permission_delegations WHERE company_id=$1 AND user_id=$2',[ctx.companyId,ctx.userId])).rows.map(r=>r.permission_code),branches:(await c.query('SELECT id,code,name,active FROM branches WHERE company_id=$1 ORDER BY name LIMIT 100',[ctx.companyId])).rows};});}
 async isSuperAdmin(c:PoolClient,ctx:Context){return Boolean((await c.query('SELECT 1 FROM memberships WHERE company_id=$1 AND user_id=$2 AND active AND super_admin',[ctx.companyId,ctx.userId])).rowCount);}
 async delegable(c:PoolClient,ctx:Context,codes:string[]){if(await this.isSuperAdmin(c,ctx))return;const allowed=(await c.query('SELECT permission_code FROM permission_delegations WHERE company_id=$1 AND user_id=$2',[ctx.companyId,ctx.userId])).rows.map(r=>r.permission_code);if(codes.some(code=>!allowed.includes(code)))throw new BusinessError('DELEGATION_DENIED','You may only grant or alter explicitly delegated permissions.',403);}
 async rolePermissions(c:PoolClient,ctx:Context,roleIds:string[]){const rows=(await c.query('SELECT id FROM roles WHERE company_id=$1 AND id=ANY($2::uuid[])',[ctx.companyId,roleIds])).rows;if(rows.length!==roleIds.length)throw new BusinessError('ROLE_SCOPE','A role is unavailable in this company.');return (await c.query('SELECT DISTINCT permission_code FROM role_permissions WHERE company_id=$1 AND role_id=ANY($2::uuid[])',[ctx.companyId,roleIds])).rows.map(r=>r.permission_code);}
 async ensureAdmin(c:PoolClient,ctx:Context){if(!(await c.query(`SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN user_roles ur ON ur.company_id=m.company_id AND ur.user_id=m.user_id JOIN role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id WHERE m.company_id=$1 AND m.active AND u.active AND rp.permission_code='users:manage' LIMIT 1`,[ctx.companyId])).rowCount)throw new BusinessError('LAST_ADMIN','At least one active user administrator must remain.');}
 async setAccess(c:PoolClient,ctx:Context,id:string,v:{roleIds:string[];branchIds:string[]}){
  await this.delegable(c,ctx,await this.rolePermissions(c,ctx,v.roleIds));
  const branches=(await c.query('SELECT b.id FROM branches b WHERE b.company_id=$1 AND b.id=ANY($2::uuid[]) AND (b.active OR EXISTS(SELECT 1 FROM user_branch_scopes s WHERE s.company_id=b.company_id AND s.branch_id=b.id AND s.user_id=$3))',[ctx.companyId,v.branchIds,id])).rows;
  if(branches.length!==v.branchIds.length)throw new BusinessError('BRANCH_SCOPE','A branch is unavailable in this company.');
  await c.query('DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2',[ctx.companyId,id]);for(const role of v.roleIds)await c.query('INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)',[ctx.companyId,id,role]);
  await c.query('DELETE FROM user_branch_scopes WHERE company_id=$1 AND user_id=$2',[ctx.companyId,id]);for(const branch of v.branchIds)await c.query('INSERT INTO user_branch_scopes(company_id,user_id,branch_id) VALUES($1,$2,$3)',[ctx.companyId,id,branch]);
 }
 async createUser(ctx:Context,key:string|undefined,body:unknown){const v=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),name:z.string().trim().min(2).max(100),roleIds:ids.refine(v=>v.length>0,"At least one role is required"),branchIds:ids,reason}).strict().parse(body);const password=await hashPassword(randomBytes(48).toString('base64url'));return this.commands.run(ctx,key,'admin.user.create',v,async c=>{
  if((await c.query('SELECT id FROM users WHERE email=$1',[v.email])).rowCount)throw new BusinessError('IDENTITY_EXISTS','Cannot provision this identity here. Existing identities require a separately authorized onboarding process.',409);
  const u=(await c.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[v.email,v.name,password])).rows[0];
  await c.query('INSERT INTO memberships(company_id,user_id,created_by) VALUES($1,$2,$3)',[ctx.companyId,u.id,ctx.userId]);await this.setAccess(c,ctx,u.id,v);
  await audit(c,ctx,'USER_PROVISION',null,{id:u.id,email:v.email,name:v.name,roleIds:v.roleIds,branchIds:v.branchIds},v.reason,'USER',u.id);return {id:u.id,version:1,message:'Membership provisioned. Use password reset to establish credentials; no initial password is exposed.'};
 },true);}
 async changeAccess(ctx:Context,key:string|undefined,id:string,body:unknown){z.string().uuid().parse(id);const v=access.parse(body);return this.commands.run(ctx,key,'admin.user.access.'+id,v,async c=>{
  if(id===ctx.userId)throw new BusinessError('SELF_CHANGE','You cannot change your own company access.',403);
  const old=(await c.query('SELECT * FROM memberships WHERE company_id=$1 AND user_id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];if(!old)throw new BusinessError('NOT_FOUND','Member not found.',404);if(old.super_admin)throw new BusinessError('SUPER_ADMIN_PROTECTED','Super-admin access cannot be changed through ordinary member administration; use the reviewed operator break-glass procedure.',403);if(old.version!==v.expectedVersion)throw new BusinessError('VERSION_CONFLICT','Membership changed. Reload before editing.',409);
  const oldRoles=(await c.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2',[ctx.companyId,id])).rows.map(r=>r.role_id);const oldBranches=(await c.query('SELECT branch_id FROM user_branch_scopes WHERE company_id=$1 AND user_id=$2',[ctx.companyId,id])).rows.map(r=>r.branch_id);
  await this.delegable(c,ctx,await this.rolePermissions(c,ctx,oldRoles));await this.setAccess(c,ctx,id,v);
  await c.query('UPDATE memberships SET active=$3,version=version+1,updated_by=$4,updated_at=now() WHERE company_id=$1 AND user_id=$2',[ctx.companyId,id,v.active,ctx.userId]);await this.ensureAdmin(c,ctx);
  await audit(c,ctx,'MEMBERSHIP_CHANGE',null,{before:{active:old.active,version:old.version,roleIds:oldRoles,branchIds:oldBranches},after:v},v.reason,'USER',id);return {id,version:old.version+1,active:v.active};
 },true);}
 async saveRole(ctx:Context,key:string|undefined,body:unknown,id?:string){if(id)z.string().uuid().parse(id);const v=(id?roleInput.extend({expectedVersion:z.number().int().positive()}):roleInput).parse(body);return this.commands.run(ctx,key,'admin.role.'+(id??'create'),v,async c=>{
  await this.delegable(c,ctx,v.permissions);let version=1,old:any=null;
  if(id){if((await c.query('SELECT 1 FROM user_roles WHERE company_id=$1 AND user_id=$2 AND role_id=$3',[ctx.companyId,ctx.userId,id])).rowCount)throw new BusinessError('SELF_ROLE','You cannot edit a role assigned to yourself.',403);
   old=(await c.query('SELECT * FROM roles WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];if(!old)throw new BusinessError('NOT_FOUND','Role not found.',404);if(old.version!==(v as any).expectedVersion)throw new BusinessError('VERSION_CONFLICT','Role changed. Reload before editing.',409);
   old.permissions=await this.rolePermissions(c,ctx,[id]);await this.delegable(c,ctx,old.permissions);version=old.version+1;await c.query('UPDATE roles SET name=$3,version=$4 WHERE company_id=$1 AND id=$2',[ctx.companyId,id,v.name,version]);await c.query('DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2',[ctx.companyId,id]);
  }else{id=(await c.query('INSERT INTO roles(company_id,name,created_by) VALUES($1,$2,$3) RETURNING id',[ctx.companyId,v.name,ctx.userId])).rows[0].id;}
  for(const permission of v.permissions)await c.query('INSERT INTO role_permissions(company_id,role_id,permission_code) VALUES($1,$2,$3)',[ctx.companyId,id,permission]);await this.ensureAdmin(c,ctx);
  await audit(c,ctx,'ROLE_CHANGE',null,{before:old?{name:old.name,permissions:old.permissions,version:old.version}:null,after:{name:v.name,permissions:v.permissions,version}},v.reason,'ROLE',id);return {id,version};
 },true);}
 async security(ctx:Context,query:any){const page=z.coerce.number().int().min(1).max(10000).parse(query.page??1);return this.db.transaction(ctx,async c=>(await c.query(`SELECT e.id,e.action,e.outcome,e.created_at,e.details,e.request_id,u.display_name AS actor,e.subject_user_id FROM security_events e JOIN users u ON u.id=e.actor_id WHERE e.company_id=$1 ORDER BY e.created_at DESC,e.id LIMIT 50 OFFSET $2`,[ctx.companyId,(page-1)*50])).rows);}
}
