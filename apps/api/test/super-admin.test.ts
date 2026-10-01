import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {AuthService} from '../src/auth';
import {CommandService} from '../src/commands';
import {sessionCookieName} from '../src/session-cookie';
const root=path.resolve(__dirname,'../../..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');
const company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',session='cccccccc-cccc-4ccc-8ccc-cccccccccccc',branch='dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('company super-admin resolves future catalog permissions and every active company branch at request time',async()=>{
 const calls:string[]=[];
 const client:any={query:async(sql:string)=>{const q=sql.replace(/\s+/g,' ').trim();calls.push(q);
  if(q.startsWith('SELECT m.super_admin'))return {rows:[{super_admin:true}],rowCount:1};
  if(q.startsWith('SELECT code AS permission_code FROM permissions'))return {rows:[{permission_code:'future:feature:manage'}],rowCount:1};
  if(q.startsWith('SELECT id AS branch_id FROM branches'))return {rows:[{branch_id:branch}],rowCount:1};
  throw new Error('Unexpected SQL: '+q);
 }};
 const db:any={pool:{query:async(sql:string)=>sql.startsWith('SELECT s.*,u.display_name')?{rows:[{id:session,user_id:user,display_name:'Admin',email:'admin@example.test'}]}:{rows:[],rowCount:1}},transaction:async(_ctx:any,fn:any)=>fn(client)};
 const auth=new AuthService(db as any);const req:any={header:(name:string)=>name==='X-Company-ID'?company:undefined,cookies:{[sessionCookieName()]:'session-token'},headers:{'user-agent':'test'},ip:'127.0.0.1'};
 const ctx=await auth.context(req,'future:feature:manage');
 assert.deepEqual(ctx.permissions,['future:feature:manage']);assert.deepEqual(ctx.branches,[branch]);
 assert.ok(calls.some(q=>q.startsWith('SELECT code AS permission_code FROM permissions')));
 assert.ok(calls.some(q=>q.startsWith('SELECT id AS branch_id FROM branches')));
});

test('company super-admin permission is revalidated for writes and cannot be stale in a session context',async()=>{
 const calls:string[]=[],digest=createHash('sha256').update('{}').digest('hex');
 const client:any={query:async(sql:string)=>{const q=sql.replace(/\s+/g,' ').trim();calls.push(q);
  if(q.startsWith('SELECT id FROM users'))return {rows:[{id:user}],rowCount:1};
  if(q.startsWith('SELECT id FROM sessions'))return {rows:[{id:session}],rowCount:1};
  if(q.startsWith('SELECT m.super_admin'))return {rows:[{super_admin:true}],rowCount:1};
  if(q.startsWith('SELECT code AS permission_code FROM permissions'))return {rows:[{permission_code:'future:write'}],rowCount:1};
  if(q.startsWith('SELECT id AS branch_id FROM branches'))return {rows:[{branch_id:branch}],rowCount:1};
  if(q.startsWith('SELECT * FROM idempotency_keys'))return {rows:[{request_hash:digest,result:null}],rowCount:1};
  return {rows:[],rowCount:1};
 }};
 const db:any={transaction:async(_ctx:any,fn:any)=>fn(client)};const service=new CommandService(db as any);
 const ctx:any={userId:user,companyId:company,sessionId:session,ip:'127.0.0.1',device:'test',requestId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',requiredPermission:'future:write',permissions:[],branches:[]};
 const result=await service.run(ctx,'superadmin-write-key','admin.future.write',{},async()=>({ok:true}),true);
 assert.deepEqual(result,{ok:true});assert.deepEqual(ctx.permissions,['future:write']);assert.deepEqual(ctx.branches,[branch]);
 assert.ok(calls.some(q=>q.startsWith('SELECT code AS permission_code FROM permissions')));
});

test('super-admin promotion is explicit, only targets the immutable initial admin, and audits the grant',async()=>{
 const mod=require('../../../scripts/promote-initial-superadmin.cjs');
 const calls:string[]=[];
 const fakeClient={query:async(sql:string)=>{const q=sql.replace(/\s+/g,' ').trim();calls.push(q);
  if(q==='SELECT current_user AS role')return {rows:[{role:'erp_owner'}],rowCount:1};
  if(q.includes('SELECT 1 FROM schema_migrations'))return {rows:[{}],rowCount:1};
  if(q.includes('FROM production_onboarding o'))return {rows:[{company_id:company,company_code:'ACME',company_name:'Example Ltd',company_active:true,admin_id:user,email:'admin@example.test',display_name:'Initial Admin',user_active:true,membership_active:true,super_admin:false,can_manage_users:true}],rowCount:1};
  if(q.startsWith('SELECT super_admin,active FROM memberships'))return {rows:[{super_admin:false,active:true}],rowCount:1};
  return {rows:[],rowCount:1};
 },release(){}};
 let ended=false;const PoolCtor:any=class{constructor(_options:any){}connect(){return fakeClient}async end(){ended=true;}};
 const input=new PassThrough(),output=new PassThrough();const chunks:string[]=[];output.on('data',chunk=>chunks.push(String(chunk)));
 input.end('GRANT SUPER ADMIN ACME admin@example.test\n');
 const result=await mod.promoteInitialSuperAdmin({NODE_ENV:'production',MIGRATION_DATABASE_URL:'postgres://owner@db/erp'},{stdin:input,stdout:output},PoolCtor);
 assert.equal(result.alreadySuperAdmin,false);assert.equal(result.email,'admin@example.test');assert.ok(ended);
 assert.ok(calls.some(q=>q.startsWith('UPDATE memberships SET super_admin=true')));
 assert.ok(calls.some(q=>q.startsWith('INSERT INTO user_branch_scopes')&&q.includes('JOIN memberships m')));
 assert.ok(calls.some(q=>q.includes("'COMPANY_SUPERADMIN_GRANT'")));
 assert.ok(calls.some(q=>q.includes("'COMPANY_SUPERADMIN_GRANT','SUCCESS'")));
});

test('super-admin security is tenant-scoped, not editable through ordinary member access, and keeps approval separation',()=>{
 const auth=read('apps/api/src/auth.ts'),commands=read('apps/api/src/commands.ts'),admin=read('apps/api/src/admin.ts');
 const migration=read('db/026-company-super-admin.sql'),script=read('scripts/promote-initial-superadmin.cjs'),ui=read('apps/web/src/ControlCenter.tsx');
 assert.match(auth,/m\.super_admin/);assert.match(auth,/WHERE company_id=\$1 AND active ORDER BY id/);
 assert.match(commands,/m\.super_admin/);assert.match(admin,/old\.super_admin.*SUPER_ADMIN_PROTECTED/s);
 assert.match(migration,/super_admin boolean NOT NULL DEFAULT false/);assert.match(migration,/actor_has_company_permission/);
 assert.match(migration,/independentCreator/);assert.match(migration,/s\.created_by=NEW\.created_by/);
 assert.match(script,/o\.initial_admin_id/);assert.match(script,/Type exactly: GRANT SUPER ADMIN/);assert.match(script,/COMPANY_SUPERADMIN_GRANT/);
 assert.match(ui,/SUPER ADMIN · ALL PERMISSIONS/);
});
