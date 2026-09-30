import {Inject,Injectable} from '@nestjs/common';
import {Request} from 'express';
import {createCipheriv,randomBytes,createHash,randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {z} from 'zod';
import {Db,BusinessError} from './db';
import {AuthService,hash} from './auth';
export const AUTH_SERVICE='00000000-0000-4000-8000-000000000001';
export const passwordSchema=z.string().min(14).max(128).refine(p=>!['passwordpassword','1234567890123456','qwertyuiopasdfgh'].includes(p.toLowerCase()),'Choose a less predictable password.');
export const hashPassword=(p:string)=>argon2.hash(p,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
export async function securityEvent(c:any,req:Request,action:string,outcome:string,subject:string|null=null,details:unknown={},system=false){
 const ctx=(req as any).authContext;
 await c.query('INSERT INTO security_events(company_id,actor_id,subject_user_id,session_id,action,outcome,request_id,ip,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ctx?.companyId??null,system?AUTH_SERVICE:((req as any).authenticatedUserId??AUTH_SERVICE),subject,system?null:((req as any).authenticatedSessionId??null),action,outcome,(req as any).requestId??randomUUID(),req.ip,JSON.stringify(details)]);
}
@Injectable()
export class SecurityService{
 constructor(@Inject(Db) private db:Db,@Inject(AuthService) private auth:AuthService){}
 async rate(bucket:string,max:number){
  const r=(await this.db.pool.query(`INSERT INTO auth_rate_limits(bucket,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(bucket) DO UPDATE SET window_start=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END,attempts=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END RETURNING attempts`,[bucket])).rows[0];return r.attempts<=max;
 }
 key(){if(process.env.NODE_ENV==='production'&&(process.env.AUTH_MAIL_MODE==='file'||!process.env.PUBLIC_WEB_ORIGIN?.startsWith('https://')))throw new BusinessError('RESET_UNAVAILABLE','Production reset requires HTTPS and SMTP delivery.',503);if(process.env.AUTH_MAIL_MODE==='smtp'&&(!process.env.SMTP_URL||!process.env.SMTP_FROM))throw new BusinessError('RESET_UNAVAILABLE','SMTP delivery is not configured.',503);const key=process.env.RESET_ENCRYPTION_KEY??'';if(!/^[a-fA-F0-9]{64}$/.test(key)||!['file','smtp'].includes(process.env.AUTH_MAIL_MODE??''))throw new BusinessError('RESET_UNAVAILABLE','Password reset delivery is not configured. Contact the administrator.',503);return Buffer.from(key,'hex');}
 async resetRequest(body:unknown,req:Request){
  const v=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase())}).strict().parse(body);const key=this.key();
  const allowed=await this.rate('reset-ip:'+hash(req.ip??'unknown'),20),accountAllowed=await this.rate('reset-email:'+hash(v.email),3);
  const result={message:'If this account is eligible, password-reset instructions will be delivered.'};
  if(!allowed||!accountAllowed){await securityEvent(this.db.pool,req,'RESET_REQUEST','DENIED',null,{reason:'RATE_LIMIT'},true);return result;}
  const token=randomBytes(32).toString('base64url'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const origin=process.env.PUBLIC_WEB_ORIGIN??'';if(!/^https?:\/\/[^/]+$/.test(origin))throw new BusinessError('RESET_UNAVAILABLE','A trusted web origin must be configured.',503);
  const payload=JSON.stringify({to:v.email,link:origin+'/#reset='+token});const ciphertext=Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);const encrypted=iv.toString('hex')+'.'+cipher.getAuthTag().toString('hex')+'.'+ciphertext.toString('hex');
  const c=await this.db.pool.connect();try{await c.query('BEGIN');
   const u=(await c.query("SELECT id FROM users WHERE email=$1 AND active AND principal_type='HUMAN' FOR UPDATE",[v.email])).rows[0];
   if(u){const row=(await c.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING id,expires_at",[u.id,hash(token)])).rows[0];await c.query('INSERT INTO auth_delivery_outbox(reset_token_id,user_id,created_by,encrypted_payload,expires_at) VALUES($1,$2,$3,$4,$5)',[row.id,u.id,AUTH_SERVICE,encrypted,row.expires_at]);}
   await securityEvent(c,req,'RESET_REQUEST','ACCEPTED',null,{emailDigest:hash(v.email)},true);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async consume(body:unknown,req:Request){
  const v=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),password:passwordSchema}).strict().parse(body);
  if(!await this.rate('reset-consume:'+hash(req.ip??'unknown'),20))throw new BusinessError('RATE_LIMIT','Too many attempts. Try later.',429);
  const newHash=await hashPassword(v.password);const c=await this.db.pool.connect();try{await c.query('BEGIN');
   const hint=(await c.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1',[hash(v.token)])).rows[0];if(!hint)throw new BusinessError('RESET_INVALID','The reset link is invalid, expired or already used.',400);
   const u=(await c.query('SELECT id,email,active FROM users WHERE id=$1 FOR UPDATE',[hint.user_id])).rows[0];
   const token=(await c.query('SELECT id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[hash(v.token)])).rows[0];
   if(!token||!u?.active)throw new BusinessError('RESET_INVALID','The reset link is invalid, expired or already used.',400);
   if(v.password.toLowerCase().includes(u.email.toLowerCase()))throw new BusinessError('PASSWORD_POLICY','Do not include your email address in your password.');
   await c.query('UPDATE users SET password_hash=$2,failed_logins=0,locked_until=NULL WHERE id=$1',[u.id,newHash]);
   await c.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[u.id]);
   await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[u.id]);
   await securityEvent(c,req,'PASSWORD_RESET','SUCCESS',u.id,{allSessionsRevoked:true},true);await c.query('COMMIT');return {message:'Password updated. All sessions have been revoked. Sign in again.'};
  }catch(e){await c.query('ROLLBACK');await securityEvent(this.db.pool,req,'PASSWORD_RESET','DENIED',null,{reason:e instanceof BusinessError?e.code:'FAILURE'},true);throw e;}finally{c.release();}
 }
 async sessions(req:Request){const s=await this.auth.session(req);return (await this.db.pool.query('SELECT id,created_at,last_seen_at,expires_at,revoked_at,ip,device,(id=$2) AS current FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[s.user_id,s.id])).rows;}
 async revoke(req:Request,id:string,body:unknown){z.object({}).strict().parse(body);const s=await this.auth.session(req,true);if(id!=='all')z.string().uuid().parse(id);
  const c=await this.db.pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[s.user_id]);
   const rows=await c.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2) RETURNING id',[s.user_id,id==='all'?null:id]);if(!rows.rowCount&&id!=='all')throw new BusinessError('NOT_FOUND','Session not found.',404);
   await securityEvent(c,req,'SESSION_REVOKE','SUCCESS',s.user_id,{target:id,count:rows.rowCount});await c.query('COMMIT');return {ok:true,currentRevoked:id==='all'||id===s.id};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async changePassword(body:unknown,req:Request){
  const s=await this.auth.session(req,true);const v=z.object({currentPassword:z.string().min(1).max(256),newPassword:passwordSchema}).strict().parse(body);
  if(!await this.rate('password-change:'+s.user_id,8))throw new BusinessError('RATE_LIMIT','Too many attempts. Try later.',429);
  const c=await this.db.pool.connect();try{await c.query('BEGIN');const u=(await c.query('SELECT * FROM users WHERE id=$1 AND active FOR UPDATE',[s.user_id])).rows[0];
   const live=(await c.query('SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[s.id])).rowCount;
   if(!u||!live||!await argon2.verify(u.password_hash,v.currentPassword))throw new BusinessError('PASSWORD_CHECK','Current credentials are invalid.',403);
   if(v.newPassword.toLowerCase().includes(u.email)||v.newPassword===v.currentPassword)throw new BusinessError('PASSWORD_POLICY','Choose a new password that does not contain your email.');
   await c.query('UPDATE users SET password_hash=$2 WHERE id=$1',[s.user_id,await hashPassword(v.newPassword)]);await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[s.user_id]);await c.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[s.user_id]);
   await securityEvent(c,req,'PASSWORD_CHANGE','SUCCESS',s.user_id,{allSessionsRevoked:true});await c.query('COMMIT');return {message:'Password changed. Sign in again on every device.'};
  }catch(e){await c.query('ROLLBACK');await securityEvent(this.db.pool,req,'PASSWORD_CHANGE','DENIED',s.user_id,{reason:'CHECK_FAILED'});throw e;}finally{c.release();}
 }
}
