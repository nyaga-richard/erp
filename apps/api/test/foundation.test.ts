import {sessionCookieName} from '../src/session-cookie';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,randomBytes,createDecipheriv,createHash} from 'node:crypto';
import {CommandService} from '../src/commands';
import {seed,C1,C2,B1,ids} from '../src/seed';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {validateLines} from '../src/accounting';

test('Decimal journal invariants',()=>{
 const a=randomUUID();assert.deepEqual(validateLines([{accountId:a,debit:'0.10',credit:'0',description:''},{accountId:a,debit:'0.20',credit:'0',description:''},{accountId:a,debit:'0',credit:'0.30',description:''}]),{debit:'0.30',credit:'0.30'});
 assert.throws(()=>validateLines([{accountId:a,debit:'0',credit:'0',description:''}]),/exactly one/);
 assert.throws(()=>validateLines([{accountId:a,debit:'1',credit:'0',description:''},{accountId:a,debit:'0',credit:'0.99',description:''}]),/equal/);
});

test('PostgreSQL + HTTP financial foundation',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres';
 const admin=new Pool({connectionString:adminUrl});
 const dbname='erp_test_'+Date.now();await admin.query(`CREATE DATABASE ${dbname}`);
 const ownerUrl=new URL(adminUrl);ownerUrl.pathname='/'+dbname;
 const runtimeUrl=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtimeUrl.pathname='/'+dbname;runtimeUrl.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtimeUrl.password=process.env.TEST_RUNTIME_PASSWORD??'';
 const owner=new Pool({connectionString:ownerUrl.toString()});let app:any;
 try{
 for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));
 await seed(ownerUrl.toString(),'Test-Only-Strong-Password-2026!');
 process.env.DATABASE_URL=runtimeUrl.toString();
 process.env.RESET_ENCRYPTION_KEY=randomBytes(32).toString('hex');process.env.AUTH_MAIL_MODE='file';process.env.PUBLIC_WEB_ORIGIN='https://erp.example.test';
 app=await bootstrap(0);const addr=app.getHttpServer().address();const base=`http://127.0.0.1:${addr.port}/api/v1`;
 type User={cookie:string;csrf:string};const users:User[]=[];
 async function api(path:string,u?:User,body?:unknown,opts:{key?:string;company?:string;csrf?:string}={}){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':opts.company??C1,...(u?{Cookie:u.cookie,'X-CSRF-Token':opts.csrf??u.csrf}:{}),'Idempotency-Key':opts.key??randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};
 }
  await t.test('login authenticates four distinct users and returns HttpOnly cookie',async()=>{
   for(const email of ['amina','brian','carol','auditor']){const r=await api('/auth/login',undefined,{email:email+'@demo.local',password:'Test-Only-Strong-Password-2026!'});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);users.push({cookie:cookie.split(';')[0],csrf:r.data.csrfToken});}
  });
  const [a,b,c,aud]=users;
  await t.test('cookie resumption verifies existing anti-CSRF context without weakening identity reads',async()=>{
   const resume=(csrf?:string,mode='verify-csrf')=>fetch(base+'/auth/me',{headers:{Cookie:a.cookie,'X-ERP-Resume-Session':mode,...(csrf===undefined?{}:{'X-CSRF-Token':csrf})}});
   assert.equal((await resume()).status,403);assert.equal((await resume('stale')).status,403);assert.equal((await resume(a.csrf)).status,200);assert.equal((await resume(a.csrf,'unknown')).status,400);assert.equal((await api('/auth/me',a)).status,200);
  });
  await t.test('preview memory sessions authenticate without cookies and preserve all security checks',async()=>{
   const old=process.env.ENABLE_PREVIEW_MEMORY_SESSION;process.env.ENABLE_PREVIEW_MEMORY_SESSION='true';
   try{
    const login=async(password:string)=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-ERP-Session-Transport':'memory'},body:JSON.stringify({email:'amina@demo.local',password})});
    const bad=await login('wrong-password');assert.equal(bad.status,401);assert.equal((await bad.json()).previewSessionToken,undefined);
    const response=await login('Test-Only-Strong-Password-2026!');assert.equal(response.status,201);assert.match(response.headers.get('cache-control')??'',/no-store/);
    const result=await response.json();assert.match(result.previewSessionToken,/^[A-Za-z0-9_-]{43}$/);
    const headers={'X-ERP-Session':result.previewSessionToken,'X-CSRF-Token':result.csrfToken,'X-Company-ID':C1,'Content-Type':'application/json'};
    assert.equal((await fetch(base+'/workspace',{headers})).status,200);
    assert.equal((await (await fetch(base+'/auth/me',{headers:{...headers,Cookie:b.cookie}})).json()).id,ids[0]);
    assert.equal((await fetch(base+'/auth/me',{headers:{...headers,'X-ERP-Session':'invalid',Cookie:a.cookie}})).status,401);
    assert.equal((await fetch(base+'/admin/users',{headers})).status,403);
    assert.equal((await fetch(base+'/workspace',{headers:{...headers,'X-Company-ID':randomUUID()}})).status,403);
    assert.equal((await fetch(base+'/auth/logout',{method:'POST',headers:{...headers,'X-CSRF-Token':'forged'},body:'{}'})).status,403);
    const normal=await api('/auth/login',undefined,{email:'amina@demo.local',password:'Test-Only-Strong-Password-2026!'});assert.equal(normal.data.previewSessionToken,undefined);
    process.env.ENABLE_PREVIEW_MEMORY_SESSION='false';
    assert.equal((await fetch(base+'/auth/me',{headers:{...headers,Cookie:a.cookie}})).status,401);
    const disabled=await login('Test-Only-Strong-Password-2026!');assert.equal((await disabled.json()).previewSessionToken,undefined);
    process.env.ENABLE_PREVIEW_MEMORY_SESSION='true';
    assert.equal((await fetch(base+'/auth/logout',{method:'POST',headers,body:'{}'})).status,201);
    assert.equal((await fetch(base+'/auth/me',{headers})).status,401);
    for(const condition of ["expires_at=now()-interval '1 second'","last_seen_at=now()-interval '31 minutes'"]){
     const expired=await (await login('Test-Only-Strong-Password-2026!')).json();
     await owner.query('UPDATE sessions SET '+condition+' WHERE token_hash=$1',[createHash('sha256').update(expired.previewSessionToken).digest('hex')]);
     assert.equal((await fetch(base+'/auth/me',{headers:{'X-ERP-Session':expired.previewSessionToken}})).status,401);
    }
    const config=await fetch(base+'/auth/config');assert.deepEqual(await config.json(),{previewMemorySession:true});assert.match(config.headers.get('cache-control')??'',/no-store/);
   }finally{if(old===undefined)delete process.env.ENABLE_PREVIEW_MEMORY_SESSION;else process.env.ENABLE_PREVIEW_MEMORY_SESSION=old;}
  });

  const wrongName=sessionCookieName()==='erp_session'?'__Host-erp_preview':'erp_session';
  assert.equal((await api('/auth/me',{...a,cookie:a.cookie.replace(/^[^=]+=/,wrongName+'=')})).status,401);
  assert.equal((await api('/auth/me',{...a,cookie:b.cookie.replace(/^[^=]+=/,wrongName+'=')+'; '+a.cookie})).data.id,ids[0]);
  await t.test('login rejects cross-site-form-compatible content types',async()=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'email=amina%40demo.local&password=anything'});assert.equal(r.status,415);});
  await t.test('unauthenticated reads fail',async()=>{assert.equal((await api('/accounts')).status,401);});
  const accounts=(await api('/accounts',a)).data;const debit=accounts.find((x:any)=>x.code==='6100').id,credit=accounts.find((x:any)=>x.code==='3100').id;
  const body={branchId:B1,date:'2026-09-26',currency:'KES',description:'Test journal — rent correction',lines:[{accountId:debit,debit:'1000.00',credit:'0'},{accountId:credit,debit:'0',credit:'1000.00'}]};
  await t.test('RBAC denies auditor posting/create',async()=>{assert.equal((await api('/journals/drafts',aud,body)).status,403);});
  await t.test('CSRF rejects authenticated unsafe request',async()=>{assert.equal((await api('/journals/drafts',a,body,{csrf:'forged'})).status,403);});
  await t.test('frontend creator impersonation and floats are rejected',async()=>{
   assert.equal((await api('/journals/drafts',a,{...body,created_by:ids[1]})).status,400);
   assert.equal((await api('/journals/drafts',a,{...body,lines:[{...body.lines[0],debit:1000},body.lines[1]]})).status,400);
  });
  await t.test('unbalanced proposal rolls back without source or numbering',async()=>{
   const before=(await owner.query('SELECT count(*) FROM source_documents')).rows[0].count;
   assert.equal((await api('/journals/drafts',a,{...body,lines:[{...body.lines[0],debit:'999'},body.lines[1]]})).status,422);
   assert.equal((await owner.query('SELECT count(*) FROM source_documents')).rows[0].count,before);
  });
  await t.test('manual control-account bypass is prohibited',async()=>{
   const ctrl=accounts.find((x:any)=>x.control_type==='AR').id;
   assert.equal((await api('/journals/drafts',a,{...body,lines:[{...body.lines[0],accountId:ctrl},body.lines[1]]})).status,422);
  });
  await t.test('company membership and foreign account/branch references are blocked',async()=>{
   assert.equal((await api('/accounts',b,undefined,{company:C2})).status,403);
   const other=(await api('/accounts',a,undefined,{company:C2})).data.find((x:any)=>x.code==='6100').id;
   assert.equal((await api('/journals/drafts',a,{...body,lines:[{...body.lines[0],accountId:other},body.lines[1]]})).status,422);
   assert.equal((await api('/journals/drafts',a,{...body,branchId:'20000000-0000-4000-8000-000000000002'})).status,403);
  });
  let source:string,journal:string;
  await t.test('concurrent idempotent create yields one source and changed body conflicts',async()=>{
   const key=randomUUID();const r=await Promise.all(Array.from({length:8},()=>api('/journals/drafts',a,body,{key})));assert.ok(r.every(x=>x.status===201));assert.equal(new Set(r.map(x=>x.data.id)).size,1);source=r[0].data.id;
   assert.equal((await api('/journals/drafts',a,{...body,description:'Different request body'},{key})).status,409);
  });
  await t.test('out-of-order post and self approval fail',async()=>{
   assert.equal((await api(`/documents/${source}/post`,c,{})).status,409);
   assert.equal((await api(`/documents/${source}/submit`,a,{})).status,201);
   assert.equal((await api(`/documents/${source}/approve`,a,{})).status,403);
   assert.equal((await api(`/documents/${source}/approve`,b,{})).status,201);
   assert.equal((await api(`/documents/${source}/post`,b,{})).status,403);
  });
  await t.test('concurrent posting yields one balanced journal, source, audit and outbox',async()=>{
   const key=randomUUID();const r=await Promise.all([api(`/documents/${source}/post`,c,{}, {key}),api(`/documents/${source}/post`,c,{}, {key})]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));assert.equal(r[0].data.journalId,r[1].data.journalId);journal=r[0].data.journalId;
   assert.equal((await api(`/documents/${source}/post`,c,{})).status,409);
   const d=(await api(`/documents/${source}`,a)).data;assert.equal(d.created_by,ids[0]);assert.equal(d.approved_by,ids[1]);assert.equal(d.posted_by,ids[2]);assert.equal(d.journals.length,1);assert.equal(d.events.length,4);
   const sums=(await owner.query('SELECT sum(debit-credit)::text AS difference FROM journal_lines WHERE journal_id=$1',[journal])).rows[0];assert.equal(sums.difference,'0.00');assert.equal((await owner.query('SELECT count(*) FROM outbox_events WHERE source_id=$1',[source])).rows[0].count,'1');
  });
  await t.test('DB denies mutation/deletion of journal, lines, source and audit',async()=>{
   await assert.rejects(()=>owner.query("UPDATE journal_entries SET description='tamper' WHERE id=$1",[journal]),/immutable/);
   await assert.rejects(()=>owner.query('DELETE FROM journal_lines WHERE journal_id=$1',[journal]),/immutable/);
   await assert.rejects(()=>owner.query('DELETE FROM source_documents WHERE id=$1',[source]),/cannot be deleted/);
   await assert.rejects(()=>owner.query("UPDATE audit_logs SET reason='tamper' WHERE source_id=$1",[source]),/append-only/);
  });
  await t.test('runtime role is not owner/superuser, RLS isolates company, domain writes unavailable',async()=>{
   const runtime=app.get(Db);const conn=await runtime.pool.connect();try{
    await conn.query('BEGIN');await conn.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true)",[ids[0],C1]);
    const roles=(await conn.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(roles.rolsuper,false);assert.equal(roles.rolbypassrls,false);
    assert.equal((await conn.query('SELECT count(*) FROM accounts WHERE company_id=$1',[C2])).rows[0].count,'0');
    await assert.rejects(()=>conn.query('DELETE FROM inventory_balances'),/permission denied/);
   }finally{await conn.query('ROLLBACK');conn.release();}
  });
  await t.test('full reversal is separately approved, preserves origin, and nets trial balance to zero',async()=>{
   const r=await api(`/journals/${journal}/reversal-drafts`,a,{date:'2026-09-26',reason:'Test correcting the original journal'});assert.equal(r.status,201,JSON.stringify(r));const id=r.data.id;
   assert.equal((await api(`/documents/${id}/submit`,a,{})).status,201);assert.equal((await api(`/documents/${id}/approve`,b,{})).status,201);assert.equal((await api(`/documents/${id}/post`,c,{})).status,201);
   const old=(await api(`/documents/${source}`,a)).data;assert.equal(old.status,'POSTED');assert.equal(old.created_by,ids[0]);assert.equal(old.links.length,1);
   const tb=(await api('/reports/trial-balance',a)).data;assert.ok(tb.every((x:any)=>Number(x.balance)===0));
   assert.equal((await api(`/journals/${journal}/reversal-drafts`,a,{date:'2026-09-26',reason:'Cannot reverse twice'})).status,409);
  });
  await t.test('closed period fails atomic posting; audited reopen permits retry',async()=>{
   const period=(await api('/periods',a)).data[0].id;
   assert.equal((await api(`/periods/${period}/close`,b,{reason:'Test close after reconciliation'})).status,201);
   const draft=(await api('/journals/drafts',a,body)).data.id;await api(`/documents/${draft}/submit`,a,{});await api(`/documents/${draft}/approve`,b,{});
   const key=randomUUID();const r=await api(`/documents/${draft}/post`,c,{}, {key});assert.equal(r.status,422);assert.equal(r.data.code,'PERIOD_CLOSED');
   assert.equal((await owner.query('SELECT count(*) FROM journal_entries WHERE source_id=$1',[draft])).rows[0].count,'0');
   assert.equal((await api(`/documents/${draft}`,a)).data.status,'APPROVED');
   assert.equal((await api(`/periods/${period}/reopen`,b,{reason:'Reopen for reviewed test journal'})).status,201);
   assert.equal((await api(`/documents/${draft}/post`,c,{}, {key})).status,201);
  });
  await t.test('DB deferred constraint rejects unbalanced journal even bypassing service',async()=>{
   const draft=(await api('/journals/drafts',a,body)).data.id;await api(`/documents/${draft}/submit`,a,{});await api(`/documents/${draft}/approve`,b,{});
   const conn=await owner.connect();try{
    await conn.query('BEGIN');await conn.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true)",[ids[2],C1]);
    const p=(await conn.query('SELECT id FROM financial_periods WHERE company_id=$1',[C1])).rows[0].id;
    const j=(await conn.query(`INSERT INTO journal_entries(company_id,branch_id,source_id,number,accounting_date,period_id,currency,base_currency,exchange_rate,description,created_by,posted_by) VALUES($1,$2,$3,'BAD-TEST','2026-09-26',$4,'KES','KES',1,'Should rollback',$5,$5) RETURNING id`,[C1,B1,draft,p,ids[2]])).rows[0].id;
    await conn.query('INSERT INTO journal_lines(company_id,journal_id,line_no,account_id,debit,base_debit,created_by) VALUES($1,$2,1,$3,10,10,$4)',[C1,j,debit,ids[2]]);
    await conn.query("UPDATE journal_entries SET status='POSTED' WHERE id=$1",[j]);
    await conn.query("UPDATE source_documents SET status='POSTED',posted_by=$2,posted_at=now(),updated_by=$2 WHERE id=$1",[draft,ids[2]]);
    await conn.query("INSERT INTO audit_logs(company_id,actor_id,action,module,entity_type,source_id,request_id) VALUES($1,$2,'POST','CORE','SOURCE_DOCUMENT',$3,$4)",[C1,ids[2],draft,randomUUID()]);
    await assert.rejects(()=>conn.query('COMMIT'),/unsealed or unbalanced/);
   }finally{await conn.query('ROLLBACK');conn.release();}
   assert.equal((await owner.query("SELECT count(*) FROM journal_entries WHERE number='BAD-TEST'")).rows[0].count,'0');
   assert.equal((await api(`/documents/${draft}`,a)).data.status,'APPROVED');
  });
  async function signIn(email:string,password='Test-Only-Strong-Password-2026!'):Promise<User>{const r=await api('/auth/login',undefined,{email,password});assert.equal(r.status,201,JSON.stringify(r.data));return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};}
  const adminUser=await signIn('admin@demo.local'),reviewer=await signIn('reviewer@demo.local');
  const adminId='30000000-0000-4000-8000-000000000005';
  let roleId:string,newUserId:string,newUser:User;
  const financeRole=(await api('/admin/roles',adminUser)).data.find((r:any)=>r.name==='Demo accounting team').id;
  const auditRole=(await api('/admin/roles',adminUser)).data.find((r:any)=>r.name==='Read-only auditor').id;
  await t.test('access administrator has no financial posting privilege; finance has no user management',async()=>{
   assert.equal((await api('/journals/drafts',adminUser,body)).status,403);
   assert.equal((await api('/admin/users',a)).status,403);
   assert.equal((await api('/admin/users',adminUser,undefined,{company:C2})).status,403);
  });
  await t.test('role creation is delegated and idempotent; unknown/undelegated permissions fail',async()=>{
   const key=randomUUID(),v={name:'Test temporary reviewer',permissions:['workspace:view','accounting:view','journals:view'],reason:'Create bounded review role'};
   const r=await api('/admin/roles',adminUser,v,{key});assert.equal(r.status,201,JSON.stringify(r.data));roleId=r.data.id;
   assert.equal((await api('/admin/roles',adminUser,v,{key})).data.id,roleId);
   assert.equal((await api('/admin/roles',adminUser,{...v,name:'No privilege',permissions:['root:everything']})).status,403);
   const own=(await api('/admin/roles',adminUser)).data.find((r:any)=>r.name.includes('Esther'));
   assert.equal((await api(`/admin/roles/${own.id}/revise`,adminUser,{...v,expectedVersion:1})).status,403);
  });
  await t.test('new user has no exposed password; memberships/roles are tenant-scoped',async()=>{
   const r=await api('/admin/users',adminUser,{email:'new.member@example.test',name:'New approved member',roleIds:[financeRole],branchIds:[B1],reason:'Provision additional independent poster'});assert.equal(r.status,201,JSON.stringify(r.data));newUserId=r.data.id;
   assert.equal(r.data.password,undefined);
   assert.equal((await api('/admin/users',adminUser,{email:'other@example.test',name:'Bad company assignment',roleIds:[financeRole],branchIds:['20000000-0000-4000-8000-000000000002'],reason:'Invalid cross company test'})).status,422);
   assert.equal((await owner.query("SELECT count(*) FROM users WHERE email='other@example.test'")).rows[0].count,'0');
   const rows=(await api('/admin/users?q=new.member&limit=10',adminUser)).data;assert.equal(rows.total,1);assert.equal(rows.data[0].password_hash,undefined);
  });
  async function resetToken(email:string){const r=await api('/auth/password-reset/request',undefined,{email});assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.token,undefined);
   const job=(await owner.query('SELECT o.* FROM auth_delivery_outbox o JOIN users u ON u.id=o.user_id WHERE u.email=$1 ORDER BY o.created_at DESC LIMIT 1',[email])).rows[0];
   const [iv,tag,cipher]=job.encrypted_payload.split('.');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.RESET_ENCRYPTION_KEY!,'hex'),Buffer.from(iv,'hex'));decipher.setAuthTag(Buffer.from(tag,'hex'));const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(cipher,'hex')),decipher.final()]).toString('utf8'));return {token:payload.link.split('#reset=')[1],job};
  }
  await t.test('reset request is generic for unknown email and stores encrypted delivery, not raw token',async()=>{
   const unknown=await api('/auth/password-reset/request',undefined,{email:'unknown@example.test'});
   const {token,job}=await resetToken('new.member@example.test');assert.deepEqual(unknown.data,{message:'If this account is eligible, password-reset instructions will be delivered.'});assert.ok(!job.encrypted_payload.includes(token));
   const row=(await owner.query('SELECT * FROM password_reset_tokens WHERE id=$1',[job.reset_token_id])).rows[0];assert.notEqual(row.token_hash,token);
   const result=await api('/auth/password-reset/consume',undefined,{token,password:'New-User-Strong-Password-2026!'});assert.equal(result.status,201,JSON.stringify(result.data));
   assert.equal((await api('/auth/password-reset/consume',undefined,{token,password:'Another-Strong-Password-2026!'})).status,400);
   newUser=await signIn('new.member@example.test','New-User-Strong-Password-2026!');
  });
  await t.test('expired reset is rejected; parallel consumption succeeds exactly once and revokes sessions',async()=>{
   const expired=await resetToken('new.member@example.test');await owner.query("UPDATE password_reset_tokens SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.job.reset_token_id]);assert.equal((await api('/auth/password-reset/consume',undefined,{token:expired.token,password:'Expired-Test-Password-2026!'})).status,400);
   const {token}=await resetToken('new.member@example.test');const r=await Promise.all([api('/auth/password-reset/consume',undefined,{token,password:'Reset-User-Strong-Password-2026!'}),api('/auth/password-reset/consume',undefined,{token,password:'Reset-User-Strong-Password-2026!'})]);assert.deepEqual(r.map(x=>x.status).sort(),[201,400]);
   assert.equal((await api('/accounts',newUser)).status,401);newUser=await signIn('new.member@example.test','Reset-User-Strong-Password-2026!');
  });
  await t.test('public reset throttles without exposing eligibility',async()=>{
   const before=(await owner.query('SELECT count(*) FROM auth_delivery_outbox WHERE user_id=$1',[newUserId])).rows[0].count;
   const r=await api('/auth/password-reset/request',undefined,{email:'new.member@example.test'});assert.equal(r.status,201);assert.equal((await owner.query('SELECT count(*) FROM auth_delivery_outbox WHERE user_id=$1',[newUserId])).rows[0].count,before);
  });
  await t.test('self access change, stale access revision and undelegated role grants are denied',async()=>{
   const all=(await api('/admin/users',adminUser)).data.data;const self=all.find((u:any)=>u.id===adminId);
   assert.equal((await api(`/admin/users/${adminId}/access`,adminUser,{active:false,roleIds:self.roleIds,branchIds:self.branchIds,expectedVersion:1,reason:'Attempt to disable self'})).status,403);
   const v={active:true,roleIds:[auditRole],branchIds:[B1],expectedVersion:1,reason:'Restrict member to read only'};
   assert.equal((await api(`/admin/users/${newUserId}/access`,adminUser,v)).status,201);assert.equal((await api('/journals/drafts',newUser,body)).status,403);
   assert.equal((await api(`/admin/users/${newUserId}/access`,adminUser,v)).status,409);
   assert.equal((await api(`/admin/users/${newUserId}/access`,adminUser,{...v,expectedVersion:2,roleIds:[financeRole]})).status,201);
  });
  await t.test('membership disable denies existing session and stale command context; reactivation preserves origin',async()=>{
   const session=(await owner.query('SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',[newUserId])).rows[0].id;
   const v={active:false,roleIds:[financeRole],branchIds:[B1],expectedVersion:3,reason:'Suspend access pending review'};
   assert.equal((await api(`/admin/users/${newUserId}/access`,adminUser,v)).status,201);assert.equal((await api('/accounts',newUser)).status,403);
   await assert.rejects(()=>app.get(CommandService).run({userId:newUserId,companyId:C1,sessionId:session,requestId:randomUUID(),ip:'127.0.0.1',device:'test',permissions:['journals:create'],branches:[B1],requiredPermission:'journals:create'},randomUUID(),'test.stale',{},async()=>({shouldNotExecute:true})),/membership/);
   assert.equal((await api(`/admin/users/${newUserId}/access`,adminUser,{...v,active:true,expectedVersion:4,reason:'Restore reviewed company access'})).status,201);
   assert.equal((await api('/accounts',newUser)).status,200);
  });
  let policyId:string;
  await t.test('policy is immutable and independently published with ordered two-step threshold',async()=>{
   const r=await api('/admin/approval-policies',adminUser,{eventType:'MANUAL_JOURNAL',threshold:'500.00',independentCreator:true,independentPoster:true,steps:[{permission:'journals:approve',minimumApprovers:1},{permission:'journals:reverse',minimumApprovers:1}],reason:'Require dual review above threshold'});assert.equal(r.status,201,JSON.stringify(r.data));policyId=r.data.id;
   await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT $1,role_id,'approvals:publish' FROM user_roles WHERE company_id=$1 AND user_id=$2 ON CONFLICT DO NOTHING",[C1,adminId]);
   const selfPublish=await api(`/admin/approval-policies/${policyId}/publish`,adminUser,{reason:'Cannot publish own draft'});assert.equal(selfPublish.status,403);assert.equal(selfPublish.data.code,'SEGREGATION');
   assert.equal((await api(`/admin/approval-policies/${policyId}/publish`,reviewer,{reason:'Independent policy review completed'})).status,201);
   await assert.rejects(()=>owner.query('UPDATE approval_policies SET threshold_base=0 WHERE id=$1',[policyId]),/immutable/);
  });
  let multi:string;
  await t.test('threshold snapshot; quorum incomplete blocks posting; same approver cannot count twice',async()=>{
   multi=(await api('/journals/drafts',a,body)).data.id;assert.equal((await api(`/documents/${multi}/submit`,a,{})).status,201);
   let d=(await api(`/documents/${multi}`,a)).data;assert.equal(d.approval_snapshot.policyId,policyId);assert.equal(d.approval_snapshot.steps.length,2);
   assert.equal((await api(`/documents/${multi}/approve`,b,{})).data.status,'PENDING_APPROVAL');
   assert.equal((await api(`/documents/${multi}/post`,newUser,{})).status,409);
   assert.equal((await api(`/documents/${multi}/approve`,b,{})).status,409);
   assert.equal((await api(`/documents/${multi}/approve`,c,{})).data.status,'APPROVED');
   assert.equal((await api(`/documents/${multi}/post`,b,{})).status,403);assert.equal((await api(`/documents/${multi}/post`,c,{})).status,403);
  });
  await t.test('new policy does not alter submitted snapshot; all approvers remain traceable at posting',async()=>{
   const r=await api('/admin/approval-policies',adminUser,{eventType:'MANUAL_JOURNAL',threshold:'500.00',independentCreator:false,independentPoster:false,steps:[{permission:'journals:approve',minimumApprovers:1}],reason:'Test a future simplified policy'});assert.equal(r.status,201);
   assert.equal((await api(`/admin/approval-policies/${r.data.id}/publish`,reviewer,{reason:'Independently authorize future policy'})).status,201);
   const d=(await api(`/documents/${multi}`,a)).data;assert.equal(d.approval_snapshot.policyId,policyId);assert.equal(d.approvals.length,2);
   assert.equal((await api(`/documents/${multi}/post`,newUser,{})).status,201);
   assert.equal((await api(`/documents/${multi}/revise`,a,{...body,expectedRevision:1,reason:'Must not edit posted source'})).status,409);
  });
  await t.test('revision invalidates effective approval but archives author and prior decisions',async()=>{
   const small={...body,lines:[{...body.lines[0],debit:'100.00'},{...body.lines[1],credit:'100.00'}]};const id=(await api('/journals/drafts',a,small)).data.id;
   await api(`/documents/${id}/submit`,a,{});await api(`/documents/${id}/approve`,b,{});
   const r=await api(`/documents/${id}/revise`,a,{...small,description:'Revised small correction',expectedRevision:1,reason:'Correct supporting document description'});assert.equal(r.status,201,JSON.stringify(r.data));
   const d=(await api(`/documents/${id}`,a)).data;assert.equal(d.revision,2);assert.equal(d.created_by,ids[0]);assert.equal(d.approved_by,null);assert.equal(d.approval_snapshot,null);assert.equal(d.revisions[0].snapshot.approved_by,ids[1]);assert.equal(d.approvals[0].revision,1);
   assert.equal((await api(`/documents/${id}/post`,c,{})).status,409);
   assert.equal((await api(`/documents/${id}/revise`,a,{...small,expectedRevision:1,reason:'Reject a stale edit request'})).status,409);
   await api(`/documents/${id}/submit`,a,{});assert.equal((await api(`/documents/${id}/reject`,b,{expectedRevision:2,reason:'Supporting information still incorrect'})).status,201);
   assert.equal((await api(`/documents/${id}/revise`,a,{...small,expectedRevision:2,reason:'Provide corrected supporting information'})).status,201);
   assert.equal((await api(`/documents/${id}/cancel`,a,{expectedRevision:3,reason:'No longer required by business'})).status,201);
   assert.equal((await api(`/documents/${id}/submit`,a,{})).status,409);
   assert.equal((await api(`/documents/${id}`,a)).data.cancelled_by,ids[0]);
  });
  await t.test('multi-person quorum requires two distinct approvals and database blocks forced approval',async()=>{
   const p=(await api('/admin/approval-policies',adminUser,{eventType:'MANUAL_JOURNAL',threshold:'2000.00',independentCreator:true,independentPoster:true,steps:[{permission:'journals:approve',minimumApprovers:2}],reason:'Two distinct reviewers for larger journals'})).data.id;
   assert.equal((await api(`/admin/approval-policies/${p}/publish`,reviewer,{reason:'Independent quorum policy publication'})).status,201);
   const bigger={...body,lines:[{...body.lines[0],debit:'3000.00'},{...body.lines[1],credit:'3000.00'}]},id=(await api('/journals/drafts',a,bigger)).data.id;
   await api(`/documents/${id}/submit`,a,{});assert.equal((await api(`/documents/${id}/approve`,b,{})).data.status,'PENDING_APPROVAL');
   const conn=await owner.connect();try{await conn.query('BEGIN');await conn.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true)",[ids[1],C1]);await assert.rejects(()=>conn.query("UPDATE source_documents SET status='APPROVED',approved_by=$2,approved_at=now(),updated_by=$2 WHERE id=$1",[id,ids[1]]),/quorum/);}finally{await conn.query('ROLLBACK');conn.release();}
   assert.equal((await api(`/documents/${id}/approve`,c,{})).data.status,'APPROVED');assert.equal((await api(`/documents/${id}/post`,newUser,{})).status,201);
  });
  await t.test('own session list excludes secrets; cannot revoke another user; password change revokes all',async()=>{
   const own=(await api('/auth/sessions',newUser)).data;assert.ok(own.length>0);assert.equal(own[0].token_hash,undefined);
   const other=(await api('/auth/sessions',b)).data[0].id;assert.equal((await api(`/auth/sessions/${other}/revoke`,newUser,{})).status,404);
   const second=await signIn('new.member@example.test','Reset-User-Strong-Password-2026!');
   assert.equal((await api('/auth/password/change',newUser,{currentPassword:'wrong-password-value',newPassword:'Changed-User-Password-2026!'})).status,403);
   assert.equal((await api('/auth/password/change',newUser,{currentPassword:'Reset-User-Strong-Password-2026!',newPassword:'Changed-User-Password-2026!'})).status,201);
   assert.equal((await api('/accounts',newUser)).status,401);assert.equal((await api('/accounts',second)).status,401);
   newUser=await signIn('new.member@example.test','Changed-User-Password-2026!');assert.equal((await api('/auth/sessions/all/revoke',newUser,{})).status,201);assert.equal((await api('/auth/me',newUser)).status,401);
  });
  await t.test('expired and idle sessions deny access; failed-login lockout is tracked',async()=>{
   const expires=await signIn('brian@demo.local');const one=(await api('/auth/sessions',expires)).data.find((x:any)=>x.current);await owner.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE id=$1",[one.id]);assert.equal((await api('/accounts',expires)).status,401);
   const idle=await signIn('brian@demo.local');const two=(await api('/auth/sessions',idle)).data.find((x:any)=>x.current);await owner.query("UPDATE sessions SET last_seen_at=now()-interval '31 minutes' WHERE id=$1",[two.id]);assert.equal((await api('/accounts',idle)).status,401);
   for(let i=0;i<5;i++)assert.equal((await api('/auth/login',undefined,{email:'new.member@example.test',password:'incorrect-password-value'})).status,401);
   const locked=(await owner.query('SELECT failed_logins,locked_until FROM users WHERE id=$1',[newUserId])).rows[0];assert.ok(locked.failed_logins>=5);assert.ok(locked.locked_until);
   assert.equal((await api('/auth/login',undefined,{email:'new.member@example.test',password:'Changed-User-Password-2026!'})).status,401);
  });
  await t.test('role revisions are optimistic and real permissions require delegation',async()=>{
   const change={name:'Renamed bounded reviewer',permissions:['workspace:view','accounting:view'],expectedVersion:1,reason:'Reduce unused reviewer permissions'};
   assert.equal((await api(`/admin/roles/${roleId}/revise`,adminUser,change)).data.version,2);assert.equal((await api(`/admin/roles/${roleId}/revise`,adminUser,change)).status,409);
   await owner.query("DELETE FROM permission_delegations WHERE company_id=$1 AND user_id=$2 AND permission_code='periods:reopen'",[C1,adminId]);
   assert.equal((await api('/admin/roles',adminUser,{name:'Forbidden real permission',permissions:['periods:reopen'],reason:'Attempt grant outside delegation'})).status,403);
   await owner.query("INSERT INTO permission_delegations(company_id,user_id,permission_code,granted_by) VALUES($1,$2,'periods:reopen',$2)",[C1,adminId]);
  });
  await t.test('a separate delegated role manager cannot remove the last active administrator',async()=>{
   const reviewerId='30000000-0000-4000-8000-000000000006';
   const target=(await api('/admin/roles',adminUser)).data.find((r:any)=>r.permissions.includes('users:manage'));
   await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT company_id,role_id,'roles:manage' FROM user_roles WHERE company_id=$1 AND user_id=$2 ON CONFLICT DO NOTHING",[C1,reviewerId]);
   await owner.query('INSERT INTO permission_delegations(company_id,user_id,permission_code,granted_by) SELECT $1,$2,code,$3 FROM permissions ON CONFLICT DO NOTHING',[C1,reviewerId,adminId]);
   const result=await api(`/admin/roles/${target.id}/revise`,reviewer,{name:target.name,permissions:target.permissions.filter((x:string)=>x!=='users:manage'),expectedVersion:target.version,reason:'Attempt to remove last administrator'});assert.equal(result.status,422,JSON.stringify(result.data));assert.equal(result.data.code,'LAST_ADMIN');
   const unchanged=(await api('/admin/roles',adminUser)).data.find((r:any)=>r.id===target.id);assert.equal(unchanged.version,target.version);assert.ok(unchanged.permissions.includes('users:manage'));
  });
  let configuredBranch:string;
  await t.test('branch administration is permissioned, tenant-scoped, strict and idempotent',async()=>{
   const input={code:'TEST-BRANCH',name:'Test branch',reason:'Prepare independent branch configuration'},key=randomUUID();
   assert.equal((await api('/admin/branches',reviewer)).status,200);assert.equal((await api('/admin/branches',reviewer,input)).status,403);
   assert.equal((await api('/admin/branches',adminUser,undefined,{company:C2})).status,403);
   assert.equal((await api('/admin/branches',adminUser,{...input,created_by:ids[0]})).status,400);
   const result=await api('/admin/branches',adminUser,input,{key});assert.equal(result.status,201,JSON.stringify(result.data));configuredBranch=result.data.id;
   assert.equal((await api('/admin/branches',adminUser,input,{key})).data.id,configuredBranch);
   assert.equal((await api('/admin/branches',adminUser,{...input,name:'Different body'},{key})).status,409);
   assert.equal((await api('/admin/branches',adminUser,input)).status,409);
   const listing=(await api('/admin/branches?q=TEST-BRANCH&page=1&limit=1',adminUser)).data;assert.equal(listing.total,1);assert.equal(listing.data[0].created_by,adminId);
   assert.equal((await owner.query('SELECT count(*)::int AS n FROM user_branch_scopes WHERE branch_id=$1',[configuredBranch])).rows[0].n,0);
  });
  await t.test('branch revisions retain creator, reject stale/foreign changes and keep journals unchanged',async()=>{
   const before=(await owner.query('SELECT count(*)::int AS n FROM journal_entries')).rows[0].n;
   const input={name:'Renamed test branch',active:true,expectedVersion:1,reason:'Clarify branch display name'};
   assert.equal((await api(`/admin/branches/${configuredBranch}/revise`,adminUser,input)).data.version,2);
   assert.equal((await api(`/admin/branches/${configuredBranch}/revise`,adminUser,input)).status,409);
   assert.equal((await api(`/admin/branches/20000000-0000-4000-8000-000000000002/revise`,adminUser,input)).status,404);
   const row=(await owner.query('SELECT * FROM branches WHERE id=$1',[configuredBranch])).rows[0];assert.equal(row.created_by,adminId);assert.equal(row.updated_by,adminId);assert.equal(row.name,input.name);
   assert.equal((await owner.query('SELECT count(*)::int AS n FROM journal_entries')).rows[0].n,before);
   const auditRows=(await owner.query("SELECT * FROM audit_logs WHERE entity_id=$1 AND action='BRANCH_REVISE'",[configuredBranch])).rows;assert.equal(auditRows.length,1);assert.equal(auditRows[0].new_values.before.version,1);
  });
  await t.test('deactivation checks dependencies and blocks financial work without destroying history',async()=>{
   assert.equal((await api(`/admin/branches/${B1}/revise`,adminUser,{name:'Main',active:false,expectedVersion:1,reason:'Attempt closing a working branch'})).status,422);
   const input={name:'Temporarily inactive branch',active:false,expectedVersion:2,reason:'Deactivate unused branch'};
   assert.equal((await api(`/admin/branches/${configuredBranch}/revise`,adminUser,input)).data.version,3);
   await owner.query('INSERT INTO user_branch_scopes(company_id,user_id,branch_id) VALUES($1,$2,$3)',[C1,ids[0],configuredBranch]);
   assert.equal((await api('/journals/drafts',a,{...body,branchId:configuredBranch})).status,403);
   assert.ok(!(await api('/workspace',a)).data.branches.some((b:any)=>b.id===configuredBranch));
   assert.equal((await api(`/admin/branches/${configuredBranch}/revise`,adminUser,{...input,name:'Reactivated branch',active:true,expectedVersion:3})).data.version,4);
   const draft=await api('/journals/drafts',a,{...body,branchId:configuredBranch});assert.equal(draft.status,201);
   const denied=await api(`/admin/branches/${configuredBranch}/revise`,adminUser,{...input,expectedVersion:4});assert.equal(denied.data.code,'BRANCH_IN_USE');
  });
  await t.test('access revisions retain existing inactive scopes but cannot newly grant them',async()=>{
   const b=(await api('/admin/branches',adminUser,{code:'INACTIVE-SCOPE',name:'Inactive scope test',reason:'Test retained historical access'})).data;
   const member=(await api('/admin/users?q=new.member',adminUser)).data.data[0];
   const input={active:true,roleIds:member.roleIds,branchIds:[B1,b.id],expectedVersion:member.version,reason:'Explicitly grant branch scope'};
   const assigned=await api(`/admin/users/${newUserId}/access`,adminUser,input);assert.equal(assigned.status,201,JSON.stringify(assigned.data));
   assert.equal((await api(`/admin/branches/${b.id}/revise`,adminUser,{name:'Inactive scope test',active:false,expectedVersion:1,reason:'Deactivate unused branch'})).status,201);
   assert.equal((await api(`/admin/users/${newUserId}/access`,adminUser,{...input,expectedVersion:assigned.data.version,reason:'Retain historical branch visibility'})).status,201);
   assert.equal((await api('/admin/users',adminUser,{email:'inactive-scope@example.test',name:'No inactive grant',roleIds:[auditRole],branchIds:[b.id],reason:'Attempt newly granting inactive scope'})).status,422);
  });
  await t.test('new branch integrates with journal posting and preserves scoped history after deactivation',async()=>{
   for(const userId of [ids[1],ids[2]])await owner.query('INSERT INTO user_branch_scopes(company_id,user_id,branch_id) VALUES($1,$2,$3)',[C1,userId,configuredBranch]);
   const source=(await owner.query('SELECT id FROM source_documents WHERE branch_id=$1',[configuredBranch])).rows[0].id;
   assert.equal((await api(`/documents/${source}/submit`,a,{})).status,201);assert.equal((await api(`/documents/${source}/approve`,b,{})).status,201);assert.equal((await api(`/documents/${source}/post`,c,{})).status,201);
   const posted=(await api(`/documents/${source}`,a)).data;assert.equal(posted.status,'POSTED');assert.equal(posted.branch_code,'TEST-BRANCH');assert.equal(posted.journals.length,1);
   const total=(await owner.query('SELECT sum(base_debit)::text AS debit,sum(base_credit)::text AS credit FROM journal_lines WHERE journal_id=$1',[posted.journals[0].id])).rows[0];assert.equal(total.debit,'1000.00');assert.equal(total.credit,total.debit);
   assert.equal((await api(`/admin/branches/${configuredBranch}/revise`,adminUser,{name:'Idle branch retaining history',active:false,expectedVersion:4,reason:'Close branch with posted history only'})).status,201);
   assert.equal((await api(`/documents/${source}`,a)).data.status,'POSTED');assert.equal((await api(`/documents/${source}`,aud)).status,404);
   assert.equal((await api('/journals',a)).data.find((j:any)=>j.source_id===source).branch_code,'TEST-BRANCH');
   assert.equal((await api('/journals/drafts',a,{...body,branchId:configuredBranch})).status,403);
  });
  await t.test('runtime SQL cannot change branch identity or skip an atomic configuration audit',async()=>{
   const runtime=app.get(Db);const ctx={userId:adminId,companyId:C1};
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query("UPDATE branches SET code='OTHER',version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",[configuredBranch,adminId])),/immutable|permission denied/i);
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query("UPDATE branches SET name='Unaudited',version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",[configuredBranch,adminId])),/audit/i);
  });
  let warehouseBranch:string,warehouseId:string;
  await t.test('company profile revisions are separately permissioned, strict and idempotent',async()=>{
   const original=(await api('/admin/company',adminUser)).data;assert.equal(original.id,C1);assert.equal((await api('/admin/company',adminUser,undefined,{company:C2})).status,403);
   const input={name:'Company profile test',expectedVersion:original.version,reason:'Revise display name without accounting changes'},key=randomUUID();
   assert.equal((await api('/admin/company/revise',reviewer,input)).status,403);
   await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT company_id,role_id,'organization:manage' FROM user_roles WHERE company_id=$1 AND user_id='30000000-0000-4000-8000-000000000006' ON CONFLICT DO NOTHING",[C1]);
   assert.equal((await api('/admin/company/revise',reviewer,input)).status,403); // Branch management is not company-profile authority.
   await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND permission_code='organization:manage' AND role_id IN (SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id='30000000-0000-4000-8000-000000000006')",[C1]);
   for(const field of ['base_currency','independent_approval','created_by','active'])assert.equal((await api('/admin/company/revise',adminUser,{...input,[field]:'forged'})).status,400);
   const journals=(await owner.query('SELECT count(*)::int AS n FROM journal_entries')).rows[0].n;
   const result=await api('/admin/company/revise',adminUser,input,{key});assert.equal(result.status,201,JSON.stringify(result.data));
   assert.equal((await api('/admin/company/revise',adminUser,input,{key})).data.version,result.data.version);
   assert.equal((await api('/admin/company/revise',adminUser,{...input,name:'Changed retry'},{key})).status,409);
   assert.equal((await api('/admin/company/revise',adminUser,input)).status,409);
   const profile=(await api('/admin/company',adminUser)).data;assert.equal(profile.created_by,original.created_by);assert.equal(profile.updated_by,adminId);assert.equal(profile.base_currency,'KES');
   assert.equal((await owner.query('SELECT count(*)::int AS n FROM journal_entries')).rows[0].n,journals);
   assert.equal((await api('/admin/company/revise',adminUser,{...input,name:original.name,expectedVersion:profile.version})).status,201);
  });
  await t.test('warehouse creation validates permissions, tenant, immutable hierarchy and actor fields',async()=>{
   warehouseBranch=(await api('/admin/branches',adminUser,{code:'WH-CONFIG',name:'Warehouse configuration test',reason:'Create hierarchy acceptance fixture'})).data.id;
   const input={branchId:warehouseBranch,code:'WH-TEST',name:'Test quarantine warehouse',locationType:'QUARANTINE',reason:'Configure quarantine location'},key=randomUUID();
   assert.equal((await api('/admin/warehouses',reviewer)).status,200);assert.equal((await api('/admin/warehouses',reviewer,input)).status,403);
   assert.equal((await api('/admin/warehouses',adminUser,undefined,{company:C2})).status,403);
   assert.equal((await api('/admin/warehouses',adminUser,{...input,branchId:'20000000-0000-4000-8000-000000000002'})).status,422);
   assert.equal((await api('/admin/warehouses',adminUser,{...input,branchId:configuredBranch})).status,422);
   for(const field of ['quantity','baseValue','created_by','companyId'])assert.equal((await api('/admin/warehouses',adminUser,{...input,[field]:'forged'})).status,400);
   const result=await api('/admin/warehouses',adminUser,input,{key});assert.equal(result.status,201,JSON.stringify(result.data));warehouseId=result.data.id;
   assert.equal((await api('/admin/warehouses',adminUser,input,{key})).data.id,warehouseId);
   assert.equal((await api('/admin/warehouses',adminUser,{...input,name:'Changed retry'},{key})).status,409);
   assert.equal((await api('/admin/warehouses',adminUser,input)).status,409);
   const rows=(await api('/admin/warehouses?q=WH-TEST&limit=1',adminUser)).data;assert.equal(rows.total,1);assert.equal(rows.data[0].branch_code,'WH-CONFIG');assert.equal(rows.data[0].created_by,adminId);
   assert.equal((await owner.query('SELECT count(*)::int AS n FROM inventory_balances WHERE warehouse_id=$1',[warehouseId])).rows[0].n,0);
   assert.equal((await owner.query('SELECT count(*)::int AS n FROM user_branch_scopes WHERE branch_id=$1',[warehouseBranch])).rows[0].n,0);
  });
  await t.test('warehouse optimistic revisions integrate with active-branch lifecycle',async()=>{
   const input={name:'Revised quarantine location',active:true,expectedVersion:1,reason:'Clarify warehouse display name'};
   assert.equal((await api(`/admin/warehouses/${warehouseId}/revise`,adminUser,input)).data.version,2);
   assert.equal((await api(`/admin/warehouses/${warehouseId}/revise`,adminUser,input)).status,409);
   for(const field of ['branchId','locationType','code'])assert.equal((await api(`/admin/warehouses/${warehouseId}/revise`,adminUser,{...input,[field]:'forged'})).status,400);
   assert.equal((await api(`/admin/branches/${warehouseBranch}/revise`,adminUser,{name:'Warehouse branch',active:false,expectedVersion:1,reason:'Attempt parent deactivation'})).status,422);
   assert.equal((await api(`/admin/warehouses/${warehouseId}/revise`,adminUser,{...input,active:false,expectedVersion:2})).data.version,3);
   assert.equal((await api(`/admin/branches/${warehouseBranch}/revise`,adminUser,{name:'Warehouse branch',active:false,expectedVersion:1,reason:'Deactivate empty hierarchy'})).data.version,2);
   assert.equal((await api(`/admin/warehouses/${warehouseId}/revise`,adminUser,{...input,expectedVersion:3})).status,422);
   assert.equal((await api('/admin/warehouses/branch-options?q=WH-CONFIG',adminUser)).data.total,0);
   assert.equal((await api(`/admin/branches/${warehouseBranch}/revise`,adminUser,{name:'Warehouse branch',active:true,expectedVersion:2,reason:'Reopen hierarchy for testing'})).data.version,3);
   assert.equal((await api(`/admin/warehouses/${warehouseId}/revise`,adminUser,{...input,expectedVersion:3})).data.version,4);
   const row=(await owner.query('SELECT * FROM warehouses WHERE id=$1',[warehouseId])).rows[0];assert.equal(row.created_by,adminId);assert.equal(row.location_type,'QUARANTINE');assert.equal(row.branch_id,warehouseBranch);
  });
  await t.test('operational references conservatively block warehouse closure without exposing domain tables',async()=>{
   await owner.query("INSERT INTO valuation_policies(company_id,created_by,method,effective_from,warehouse_id) VALUES($1,$2,'WEIGHTED_AVERAGE','2026-01-01',$3)",[C1,adminId,warehouseId]);
   const result=await api(`/admin/warehouses/${warehouseId}/revise`,adminUser,{name:'Referenced warehouse',active:false,expectedVersion:4,reason:'Attempt deactivation with dependency'});assert.equal(result.data.code,'WAREHOUSE_IN_USE');
   const runtime=app.get(Db),ctx={companyId:C1,userId:adminId};
   assert.equal((await runtime.transaction(ctx,c=>c.query('SELECT warehouse_has_dependencies($1) AS used',[warehouseId]))).rows[0].used,true);
   await assert.rejects(()=>runtime.transaction({companyId:C2,userId:adminId},c=>c.query('SELECT warehouse_has_dependencies($1)',[warehouseId])),/scope|permission/i);
   await assert.rejects(()=>runtime.transaction({companyId:C1,userId:ids[0]},c=>c.query('SELECT warehouse_has_dependencies($1)',[warehouseId])),/permission/i);
   assert.equal((await runtime.transaction(ctx,c=>c.query('SELECT * FROM inventory_balances'))).rowCount,0); // 018 releases scoped stock projections, not editable balances.
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query('SELECT * FROM valuation_policies')),/permission denied/i);
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query('INSERT INTO inventory_balances DEFAULT VALUES')),/permission denied/i);
   const definition=(await owner.query("SELECT pg_get_functiondef('warehouse_has_dependencies(uuid)'::regprocedure) AS sql")).rows[0].sql;
   const refs=(await owner.query("SELECT cl.relname, a.attname FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid JOIN LATERAL unnest(co.conkey) AS k(attnum) ON true JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attnum=k.attnum WHERE co.contype='f' AND co.confrelid='warehouses'::regclass AND a.attname<>'company_id'")).rows;
   for(const ref of refs){assert.ok(definition.includes('public.'+ref.relname),ref.relname);assert.ok(definition.includes(ref.attname),ref.attname);}
  });
  await t.test('inactive terminal references still block closure and dependency helper is not public',async()=>{
   const w=(await api('/admin/warehouses',adminUser,{branchId:warehouseBranch,code:'TERMINAL-REF',name:'Terminal reference test',locationType:'SELLABLE',reason:'Test conservative close boundary'})).data;
   await owner.query("INSERT INTO pos_terminals(company_id,created_by,code,name,active,branch_id,warehouse_id) VALUES($1,$2,'TEST-TERM','Owner-only unreleased fixture',false,$3,$4)",[C1,adminId,warehouseBranch,w.id]);
   assert.equal((await api(`/admin/warehouses/${w.id}/revise`,adminUser,{name:'Terminal reference test',active:false,expectedVersion:1,reason:'Attempt closing referenced warehouse'})).data.code,'WAREHOUSE_IN_USE');
   const proc=(await owner.query("SELECT prosecdef,proconfig,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS restricted FROM pg_proc WHERE oid='warehouse_has_dependencies(uuid)'::regprocedure")).rows[0];
   assert.equal(proc.prosecdef,true);assert.equal(proc.restricted,true);assert.ok(proc.proconfig.some((v:string)=>v.includes('search_path=pg_catalog, public')));
  });
  await t.test('concurrent warehouse revisions commit one version and one audit record',async()=>{
   const w=(await api('/admin/warehouses',adminUser,{branchId:warehouseBranch,code:'VERSION-RACE',name:'Warehouse version race',locationType:'RETURNS',reason:'Test optimistic update concurrency'})).data;
   const results=await Promise.all(['First change','Second change'].map(name=>api(`/admin/warehouses/${w.id}/revise`,adminUser,{name,active:true,expectedVersion:1,reason:'Concurrent revision attempt'})));
   assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await owner.query('SELECT version FROM warehouses WHERE id=$1',[w.id])).rows[0].version,2);
   assert.equal((await owner.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='WAREHOUSE_REVISE'",[w.id])).rows[0].n,1);
  });
  await t.test('company and warehouse runtime SQL changes require protected columns and atomic audit',async()=>{
   const runtime=app.get(Db),ctx={companyId:C1,userId:adminId};
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query("UPDATE companies SET base_currency='USD' WHERE id=$1",[C1])),/permission denied|immutable/i);
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query("UPDATE companies SET name='Unaudited',version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",[C1,adminId])),/audit/i);
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query("UPDATE warehouses SET location_type='SELLABLE' WHERE id=$1",[warehouseId])),/permission denied|immutable/i);
   await assert.rejects(()=>runtime.transaction(ctx,c=>c.query("UPDATE warehouses SET name='Unaudited',version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",[warehouseId,adminId])),/audit/i);
   assert.ok((await owner.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='WAREHOUSE_REVISE'",[warehouseId])).rowCount);
  });
  await t.test('concurrent branch deactivation and warehouse creation cannot orphan an active location',async()=>{
   const branch=(await api('/admin/branches',adminUser,{code:'WH-RACE',name:'Concurrent hierarchy test',reason:'Test hierarchy command locking'})).data.id;
   const results=await Promise.all([api('/admin/warehouses',adminUser,{branchId:branch,code:'WH-RACE',name:'Concurrent warehouse',locationType:'SELLABLE',reason:'Test concurrent location creation'}),api(`/admin/branches/${branch}/revise`,adminUser,{name:'Concurrent hierarchy test',active:false,expectedVersion:1,reason:'Test concurrent parent deactivation'})]);
   assert.deepEqual(results.map(r=>r.status).sort(),[201,422]);
   assert.equal((await owner.query('SELECT count(*)::int AS n FROM warehouses w JOIN branches b ON b.id=w.branch_id WHERE w.branch_id=$1 AND w.active AND NOT b.active',[branch])).rows[0].n,0);
  });
  await t.test('legacy sequence allocation metadata stays unknown rather than inventing a historical actor',async()=>{
   const branch=(await owner.query('SELECT id FROM branches WHERE company_id=$1 ORDER BY id LIMIT 1',[C2])).rows[0].id;
   await owner.query("INSERT INTO document_sequences(company_id,branch_id,document_type,financial_year,prefix,last_value,allocated_by) VALUES($1,$2,'MANUAL_JOURNAL',2000,'JDR',9,'00000000-0000-4000-8000-000000000001')",[C2,branch]);
   await owner.query(readFileSync('../../db/011-historical-allocation-metadata.sql','utf8'));
   const r=(await owner.query('SELECT * FROM document_sequences WHERE company_id=$1 AND branch_id=$2 AND financial_year=2000',[C2,branch])).rows[0];assert.equal(r.last_value,'9');assert.equal(r.prefix,'JDR');assert.equal(r.allocated_by,null);assert.equal(r.allocated_at,null);
  });
  await t.test('number formats come from the registry and existing sequences retain their original format',async()=>{
   const original=(await owner.query("SELECT * FROM document_numbering_defaults WHERE document_type='MANUAL_JOURNAL'")).rows[0];
   try{await owner.query("UPDATE document_numbering_defaults SET prefix='JX',padding=8 WHERE document_type='MANUAL_JOURNAL'");const r=await api('/journals/drafts',a,{...body,date:'2028-01-02'});assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.document_number,'JX-2028-00000001');const current=await api('/journals/drafts',a,body);assert.equal(current.status,201);assert.match(current.data.document_number,/^JDR-2026-\d{6}$/);}finally{await owner.query('UPDATE document_numbering_defaults SET prefix=$1,padding=$2 WHERE document_type=$3',[original.prefix,original.padding,'MANUAL_JOURNAL']);}
  });
  await t.test('parallel distinct drafts receive unique consecutive numbers and failed transactions consume none',async()=>{
   const before=(await owner.query("SELECT last_value FROM document_sequences WHERE company_id=$1 AND branch_id=$2 AND document_type='MANUAL_JOURNAL' AND financial_year=2026",[C1,B1])).rows[0].last_value;
   const results=await Promise.all(Array.from({length:6},()=>api('/journals/drafts',a,body)));assert.ok(results.every(r=>r.status===201));assert.equal(new Set(results.map(r=>r.data.document_number)).size,6);
   const db=app.get(Db);await assert.rejects(()=>db.transaction({userId:ids[0],companyId:C1},async c=>{await c.query("UPDATE document_sequences SET last_value=last_value+1 WHERE company_id=$1 AND branch_id=$2 AND document_type='MANUAL_JOURNAL' AND financial_year=2026",[C1,B1]);throw Error('intentional downstream failure');}),/intentional/);
   const after=(await owner.query("SELECT last_value FROM document_sequences WHERE company_id=$1 AND branch_id=$2 AND document_type='MANUAL_JOURNAL' AND financial_year=2026",[C1,B1])).rows[0].last_value;assert.equal(BigInt(after),BigInt(before)+6n);
  });
  await t.test('counter tampering and committed allocations without a source are rejected',async()=>{
   const db=app.get(Db);for(const change of ["prefix='FORGED'",'last_value=last_value-1','last_value=last_value+1'])await assert.rejects(()=>db.transaction({userId:ids[0],companyId:C1},c=>c.query("UPDATE document_sequences SET "+change+" WHERE company_id=$1 AND branch_id=$2 AND document_type='MANUAL_JOURNAL' AND financial_year=2026",[C1,B1])));
  });
  await t.test('dedicated mail worker cannot impersonate humans or read financial data',async()=>{
   const url=new URL(runtimeUrl.toString());url.username='erp_auth_worker';url.password=process.env.TEST_WORKER_PASSWORD??'';const worker=new Pool({connectionString:url.toString()});
   try{await assert.rejects(()=>worker.query('SELECT * FROM journal_entries'),/permission denied/);await worker.query('BEGIN');try{await assert.rejects(()=>worker.query("INSERT INTO security_events(actor_id,subject_user_id,action,outcome,request_id,details) VALUES($1,$1,'RESET_DELIVERY','SUCCESS',$2,'{}')",[ids[0],randomUUID()]),/worker|origin|actor/i);}finally{await worker.query('ROLLBACK');}}finally{await worker.end();}
  });
  await t.test('failed commands and security attempts persist without raw credentials/tokens',async()=>{
   const log=(await owner.query("SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='COMMAND_FAILED'",[C1])).rows[0].n;assert.ok(log>0);
   const security=(await owner.query('SELECT * FROM security_events')).rows;assert.ok(security.some(e=>e.action==='PASSWORD_RESET'&&e.outcome==='SUCCESS'));
   const serialized=JSON.stringify(security);assert.ok(!serialized.includes('Changed-User-Password-2026!'));assert.ok(!serialized.includes('csrfToken'));assert.ok(!serialized.includes('token_hash'));
   await assert.rejects(()=>owner.query("DELETE FROM security_events WHERE action='PASSWORD_RESET'"),/append-only/);
   assert.equal((await api('/admin/security-events',adminUser)).status,200);
  });
  await t.test('core integrity report does not pretend operational reconciliations exist',async()=>{const r=(await api('/reports/integrity',a)).data;assert.equal(r.coreJournalCheck,'PASS');assert.equal(r.operationalReconciliations,'NOT_IMPLEMENTED');});
  await t.test('deactivation and logout revoke effective access',async()=>{
   await owner.query('UPDATE users SET active=false WHERE id=$1',[ids[3]]);assert.equal((await api('/accounts',aud)).status,401);
   assert.equal((await api('/auth/logout',a,{})).status,201);assert.equal((await api('/accounts',a)).status,401);
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query(`DROP DATABASE ${dbname}`);await admin.end();}
});
