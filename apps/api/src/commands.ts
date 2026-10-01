import {Inject,Injectable} from '@nestjs/common';
import {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Db,Context,BusinessError,audit} from './db';
function canonical(v:any):string{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
@Injectable()
export class CommandService{
 constructor(@Inject(Db) private db:Db){}
 async run<T>(ctx:Context,key:string|undefined,command:string,body:any,fn:(c:PoolClient)=>Promise<T>,accessWrite=false):Promise<T>{
  const k=z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/).parse(key),digest=createHash('sha256').update(canonical(body)).digest('hex');
  try{return await this.db.transaction(ctx,async c=>{
   await c.query(`SELECT ${accessWrite?'pg_advisory_xact_lock':'pg_advisory_xact_lock_shared'}(hashtextextended($1,77))`,[ctx.companyId]);
   const user=await c.query('SELECT id FROM users WHERE id=$1 AND active FOR SHARE',[ctx.userId]);
   const session=await c.query("SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-interval '30 minutes' FOR SHARE",[ctx.sessionId,ctx.userId]);
   if(!user.rowCount||!session.rowCount)throw new BusinessError('SESSION_REVOKED','Session is no longer authorized.',401);
   const m=await c.query('SELECT m.super_admin FROM memberships m JOIN companies co ON co.id=m.company_id WHERE m.company_id=$1 AND m.user_id=$2 AND m.active AND co.active',[ctx.companyId,ctx.userId]);
   if(!m.rowCount)throw new BusinessError('ACCESS_REVOKED','Company membership is no longer active.',403);
   const isSuperAdmin=m.rows[0].super_admin===true;
   const grants=isSuperAdmin
    ? await c.query('SELECT code AS permission_code FROM permissions ORDER BY code')
    : await c.query('SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2',[ctx.companyId,ctx.userId]);
   ctx.permissions=grants.rows.map(r=>r.permission_code);
   if(!ctx.requiredPermission||!ctx.permissions.includes(ctx.requiredPermission))throw new BusinessError('PERMISSION_REVOKED','This permission is no longer granted.',403);
   ctx.branches=(isSuperAdmin
    ? await c.query('SELECT id AS branch_id FROM branches WHERE company_id=$1 AND active ORDER BY id',[ctx.companyId])
    : await c.query('SELECT s.branch_id FROM user_branch_scopes s JOIN branches b ON b.company_id=s.company_id AND b.id=s.branch_id WHERE s.company_id=$1 AND s.user_id=$2 AND b.active',[ctx.companyId,ctx.userId])).rows.map(r=>r.branch_id);
   await c.query("SELECT set_config('app.reason',$1,true)",[body?.reason??command]);
   await c.query('INSERT INTO idempotency_keys(company_id,actor_id,command,key,request_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[ctx.companyId,ctx.userId,command,k,digest]);
   const prior=(await c.query('SELECT * FROM idempotency_keys WHERE company_id=$1 AND actor_id=$2 AND command=$3 AND key=$4 FOR UPDATE',[ctx.companyId,ctx.userId,command,k])).rows[0];
   if(prior.request_hash!==digest)throw new BusinessError('IDEMPOTENCY_CONFLICT','This key was used for a different request.',409);
   if(prior.result!==null)return prior.result;
   const result=await fn(c);
   await c.query('UPDATE idempotency_keys SET result=$5 WHERE company_id=$1 AND actor_id=$2 AND command=$3 AND key=$4',[ctx.companyId,ctx.userId,command,k,JSON.stringify(result)]);
   return result;
  });}catch(e){
   // Separate transaction: financial rollback must not erase the failed attempt.
   try{await this.db.transaction(ctx,c=>audit(c,ctx,'COMMAND_FAILED',null,{command,code:e instanceof BusinessError?e.code:'INTEGRITY_OR_DATABASE_FAILURE'},undefined,'COMMAND',null));}catch{console.error('SECURITY_ALERT: failed-command audit persistence unavailable',ctx.requestId);}
   throw e;
  }
 }
}
