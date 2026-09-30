// Explicit development-file or SMTP adapter. No plaintext reset secrets in logs or database.
const {Pool}=require('pg');const {createDecipheriv,randomUUID}=require('crypto');const fs=require('fs');const path=require('path');require('dotenv').config();
const mode=process.env.AUTH_MAIL_MODE,key=process.env.RESET_ENCRYPTION_KEY;
if(!['file','smtp'].includes(mode)||!/^[a-fA-F0-9]{64}$/.test(key||''))throw Error('Configure AUTH_MAIL_MODE and a 32-byte hex RESET_ENCRYPTION_KEY.');
if(mode==='file'&&process.env.NODE_ENV==='production')throw Error('Development file delivery is forbidden in production.');
if(mode==='smtp'&&(!process.env.SMTP_URL||!process.env.SMTP_FROM))throw Error('SMTP_URL and SMTP_FROM are required.');
if(process.env.NODE_ENV==='production'&&!process.env.AUTH_WORKER_DATABASE_URL)throw Error('Production worker requires its dedicated database role.');
const pool=new Pool({connectionString:process.env.AUTH_WORKER_DATABASE_URL||process.env.DATABASE_URL});
const transport=mode==='smtp'?require('nodemailer').createTransport(process.env.SMTP_URL):null;
const instanceId=randomUUID();let lastHeartbeat=0;
const service='00000000-0000-4000-8000-000000000001';let stopping=false;
async function once(){
 if(Date.now()-lastHeartbeat>15000){await pool.query("INSERT INTO service_heartbeats(service_name,instance_id) VALUES('auth-mail',$1) ON CONFLICT(service_name) DO UPDATE SET instance_id=EXCLUDED.instance_id,last_seen_at=now()",[instanceId]);lastHeartbeat=Date.now();}
 const c=await pool.connect();let job;
 try{await c.query('BEGIN');job=(await c.query(`SELECT o.* FROM auth_delivery_outbox o JOIN password_reset_tokens t ON t.id=o.reset_token_id WHERE o.sent_at IS NULL AND o.expires_at>now() AND t.used_at IS NULL AND o.attempts<8 AND (o.lease_until IS NULL OR o.lease_until<now()) ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1`)).rows[0];if(job)await c.query("UPDATE auth_delivery_outbox SET attempts=attempts+1,lease_until=now()+interval '2 minutes' WHERE id=$1",[job.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 if(!job)return false;
 try{
  const [iv,tag,cipher]=job.encrypted_payload.split('.');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'hex'));decipher.setAuthTag(Buffer.from(tag,'hex'));const message=JSON.parse(Buffer.concat([decipher.update(Buffer.from(cipher,'hex')),decipher.final()]).toString('utf8'));
  const text='A password reset was requested for your Karibu ERP account.\n\n'+message.link+'\n\nThis link is single-use and expires within 30 minutes of the request. If you did not request it, ignore this email.\n';
  if(mode==='file'){const dir=path.resolve(process.env.AUTH_MAIL_DIRECTORY||'.runtime/mail');fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,job.id+'.json'),JSON.stringify({developmentOnly:true,to:message.to,subject:'Reset your Karibu password',text},null,2),{mode:0o600});}
  else await transport.sendMail({from:process.env.SMTP_FROM,to:message.to,subject:'Reset your Karibu password',text,messageId:`<${job.id}@karibu-auth.local>`});
  const done=await pool.connect();try{await done.query('BEGIN');await done.query('UPDATE auth_delivery_outbox SET sent_at=now(),lease_until=NULL,last_error_code=NULL WHERE id=$1',[job.id]);await done.query("INSERT INTO security_events(actor_id,subject_user_id,action,outcome,request_id,details) VALUES($1,$2,'RESET_DELIVERY','SUCCESS',$3,$4)",[service,job.user_id,randomUUID(),JSON.stringify({jobId:job.id,adapter:mode})]);await done.query('COMMIT');}catch(e){await done.query('ROLLBACK');throw e;}finally{done.release();}
  console.log('Auth delivery completed:',job.id,'adapter:',mode);return true;
 }catch(e){await pool.query("UPDATE auth_delivery_outbox SET lease_until=now()+make_interval(secs=>$2),last_error_code='DELIVERY_FAILED' WHERE id=$1",[job.id,Math.min(3600,30*2**job.attempts)]);console.error('Auth delivery failed:',job.id,'(details redacted)');return false;}
}
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
(async()=>{try{do{const processed=await once();if(process.argv.includes('--once'))break;if(!processed&&!stopping)await new Promise(r=>setTimeout(r,2000));}while(!stopping);}finally{await pool.end();if(transport)transport.close();}})().catch(()=>{console.error('Auth worker unavailable; investigate database/adapter configuration.');process.exitCode=1;});
