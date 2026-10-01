import {previewMemorySessionsEnabled} from './preview-session';
import {sessionCookieName} from './session-cookie';
import {Inject,Injectable} from '@nestjs/common';
import {Db,BusinessError,Context,requestId} from './db';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import {Request} from 'express';
import {z} from 'zod';
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const uuid=z.string().uuid();
@Injectable()
export class AuthService {
 constructor(@Inject(Db) private db:Db){}
 async login(body:unknown,req:Request){
  if(!req.is('application/json'))throw new BusinessError('CONTENT_TYPE','Login requires application/json.',415);
  const v=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(1).max(256)}).strict().parse(body);
  const rate=(await this.db.pool.query("INSERT INTO auth_rate_limits(bucket,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(bucket) DO UPDATE SET window_start=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END,attempts=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END RETURNING attempts",['login-ip:'+hash(req.ip??'unknown')])).rows[0];
  if(rate.attempts>60)throw new BusinessError('RATE_LIMIT','Too many login attempts. Try again later.',429);
  const c=await this.db.pool.connect();
  try{
   await c.query('BEGIN');
   const attempts=await c.query(`SELECT count(*) FROM login_history WHERE created_at>now()-interval '15 minutes' AND NOT success AND (email_digest=$1 OR ip=$2)`,[hash(v.email),req.ip]);
   if(Number(attempts.rows[0].count)>=30) throw new BusinessError('RATE_LIMIT','Too many login attempts. Try again later.',429);
   const result=await c.query('SELECT * FROM users WHERE email=$1 FOR UPDATE',[v.email]);const u=result.rows[0];
   // Unknown accounts still perform a password KDF to avoid the obvious timing oracle.
   const verified=u?.password_hash ? await argon2.verify(u.password_hash,v.password) : (await argon2.hash(v.password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1}),false);
   const ok=Boolean(u?.active && u.principal_type==='HUMAN' && verified && (!u.locked_until || new Date(u.locked_until)<new Date()));
   await c.query('INSERT INTO login_history(user_id,email_digest,success,reason,ip) VALUES($1,$2,$3,$4,$5)',[u?.id??null,hash(v.email),ok,ok?'LOGIN':'INVALID_OR_LOCKED',req.ip]);
   if(!ok){if(u)await c.query(`UPDATE users SET failed_logins=failed_logins+1,locked_until=CASE WHEN failed_logins+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1`,[u.id]); await c.query('COMMIT');throw new BusinessError('INVALID_LOGIN','Invalid credentials or account unavailable.',401);}
   await c.query('UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=$1',[u.id]);
   const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
   const session=(await c.query(`INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,ip,device) VALUES($1,$2,$3,now()+interval '8 hours',$4,$5) RETURNING id`,[u.id,hash(token),hash(csrf),req.ip,req.headers['user-agent']?.slice(0,512)??''])).rows[0];
   await c.query("INSERT INTO security_events(actor_id,subject_user_id,session_id,action,outcome,request_id,ip) VALUES($1,$1,$2,'LOGIN','SUCCESS',$3,$4)",[u.id,session.id,(req as any).requestId??requestId(),req.ip]);
   await c.query('COMMIT');return {token,csrf};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async session(req:Request,write=false){
  const supplied=req.header('X-ERP-Session');
  // A supplied header is authoritative: never fall back to a different cookie identity.
  if(supplied!==undefined&&!previewMemorySessionsEnabled())throw new BusinessError('UNAUTHENTICATED','Preview session transport is unavailable.',401);
  const token=supplied!==undefined?supplied:req.cookies?.[sessionCookieName()];
  if(typeof token!=='string' || token.length>128)throw new BusinessError('UNAUTHENTICATED','Please sign in.',401);
  const r=await this.db.pool.query(`SELECT s.*,u.display_name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes' AND u.active AND u.principal_type='HUMAN'`,[hash(token)]);
  const s=r.rows[0];if(!s)throw new BusinessError('UNAUTHENTICATED','Session expired or revoked.',401);
  if(write){const supplied=req.header('X-CSRF-Token')??'';if(supplied.length>128 || !timingSafeEqual(Buffer.from(hash(supplied)),Buffer.from(s.csrf_hash)))throw new BusinessError('CSRF','Invalid anti-CSRF token.',403);}
  (req as any).authenticatedUserId=s.user_id;(req as any).authenticatedSessionId=s.id;await this.db.pool.query('UPDATE sessions SET last_seen_at=now() WHERE id=$1',[s.id]);return s;
 }
 async me(req:Request){
  const resume=req.header('X-ERP-Resume-Session');
  if(resume!==undefined&&resume!=='verify-csrf')throw new BusinessError('VALIDATION','Unknown session verification mode.',400);
  const s=await this.session(req,resume==='verify-csrf');
  return this.db.transaction({userId:s.user_id,companyId:''},async c=>{
   const companies=await c.query(`SELECT c.id,c.code,c.name,c.base_currency FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=$1 AND m.active AND c.active ORDER BY c.created_at,c.id`,[s.user_id]);
   return {id:s.user_id,name:s.display_name,email:s.email,companies:companies.rows};
  });
 }
 async context(req:Request,permission:string,write=false):Promise<Context>{
  const s=await this.session(req,write);const companyId=uuid.parse(req.header('X-Company-ID'));
  return this.db.transaction({userId:s.user_id,companyId},async c=>{
   const m=await c.query(`SELECT m.super_admin FROM memberships m JOIN companies co ON co.id=m.company_id WHERE m.company_id=$1 AND m.user_id=$2 AND m.active AND co.active`,[companyId,s.user_id]);
   if(!m.rowCount)throw new BusinessError('FORBIDDEN','Company access denied.',403);
   (req as any).authContext={companyId};
   const isSuperAdmin=m.rows[0].super_admin===true;
   const p=isSuperAdmin
    ? await c.query('SELECT code AS permission_code FROM permissions ORDER BY code')
    : await c.query('SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2',[companyId,s.user_id]);
   const permissions=p.rows.map(r=>r.permission_code);
   if(!permissions.includes(permission))throw new BusinessError('FORBIDDEN','You do not have permission for this action.',403);
   const b=isSuperAdmin
    ? await c.query('SELECT id AS branch_id FROM branches WHERE company_id=$1 AND active ORDER BY id',[companyId])
    : await c.query('SELECT branch_id FROM user_branch_scopes WHERE company_id=$1 AND user_id=$2',[companyId,s.user_id]);
   const ctx:Context={requiredPermission:permission,userId:s.user_id,companyId,sessionId:s.id,ip:req.ip??'127.0.0.1',device:req.headers['user-agent']?.slice(0,512)??'',requestId:(req as any).requestId??requestId(),permissions,branches:b.rows.map(r=>r.branch_id)};(req as any).authContext=ctx;return ctx;
  });
 }
 async logout(req:Request){const s=await this.session(req,true);const c=await this.db.pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[s.user_id]);await c.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1',[s.id]);await c.query("INSERT INTO security_events(actor_id,subject_user_id,session_id,action,outcome,request_id,ip) VALUES($1,$1,$2,'LOGOUT','SUCCESS',$3,$4)",[s.user_id,s.id,(req as any).requestId??requestId(),req.ip]);await c.query('COMMIT');return {ok:true};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
}
