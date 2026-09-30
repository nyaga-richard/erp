import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';

test('Controlled COA proposals integrate with the financial engine',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl});
 const name='erp_coa_'+Date.now();await admin.query(`CREATE DATABASE ${name}`);
 const ownerUrl=new URL(adminUrl);ownerUrl.pathname='/'+name;const owner=new Pool({connectionString:ownerUrl.toString()});
 let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));
  await seed(ownerUrl.toString(),'COA-Test-Only-Password-2026!');
  const runtimeUrl=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtimeUrl.pathname='/'+name;runtimeUrl.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtimeUrl.password=process.env.TEST_RUNTIME_PASSWORD??'';
  process.env.DATABASE_URL=runtimeUrl.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,u?:User,body?:unknown,opts:{key?:string;company?:string;csrf?:string}={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':opts.company??C1,'Idempotency-Key':opts.key??randomUUID(),...(u?{Cookie:u.cookie,'X-CSRF-Token':opts.csrf??u.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password:'COA-Test-Only-Password-2026!'});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),a=await login('amina@demo.local'),b=await login('brian@demo.local'),c=await login('carol@demo.local');
  const makerId='30000000-0000-4000-8000-000000000005',reviewerId='30000000-0000-4000-8000-000000000006';
  const parent=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND code='6000'",[C1])).rows[0].id;
  const proposal={kind:'CREATE',code:'6501',name:'Demo delivery expense',accountType:'EXPENSE',parentId:parent,postable:true,reason:'New expense classification for controlled test'};
  const decide={decision:'APPROVE',reason:'Independent review of account classification'};
  const submit=async(body:any=proposal)=>{const r=await call('/admin/account-changes',maker,body);assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const decision=(id:string,body:any=decide,actor:User=reviewer,key?:string)=>call('/admin/account-changes/'+id+'/decide',actor,body,{key});
  let requestId='',accountId='';
  await t.test('catalog scope, pagination and explicit proposal/approval permissions',async()=>{
   assert.equal((await call('/admin/accounts',maker)).status,200);
   assert.equal((await call('/admin/accounts')).status,401);
   assert.equal((await call('/admin/accounts',maker,undefined,{company:C2})).status,403);
   assert.equal((await call('/admin/accounts?limit=101',maker)).status,400);
   assert.equal((await call('/admin/account-changes',a,proposal)).status,403);
   assert.equal((await call('/admin/account-changes',maker,proposal,{csrf:'forged'})).status,403);
   assert.equal((await call('/admin/account-changes',maker,{...proposal,created_by:ids[0]})).status,400);
   assert.equal((await call('/admin/account-changes',maker,{...proposal,controlType:'CASH'})).status,400);
  });
  await t.test('proposal is immutable pending data, idempotent, and financially inert',async()=>{
   const key=randomUUID(),before=(await owner.query('SELECT count(*)::int n FROM accounts')).rows[0].n;
   const r=await call('/admin/account-changes',maker,proposal,{key});assert.equal(r.status,201,JSON.stringify(r.data));requestId=r.data.id;
   assert.equal((await call('/admin/account-changes',maker,proposal,{key})).data.id,requestId);
   assert.equal((await call('/admin/account-changes',maker,{...proposal,name:'Changed payload'},{key})).status,409);
   assert.equal((await owner.query('SELECT count(*)::int n FROM accounts')).rows[0].n,before);
   assert.equal((await owner.query('SELECT count(*)::int n FROM journal_entries')).rows[0].n,0);
   const list=(await call('/admin/account-changes?q=6501&state=PENDING&limit=1',maker)).data;assert.equal(list.total,1);assert.equal(list.data[0].created_by,makerId);
  });
  await t.test('parent must be same-company active non-posting and same classification',async()=>{
   const foreign=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND code='6000'",[C2])).rows[0].id;
   const leaf=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND code='6100'",[C1])).rows[0].id;
   for(const body of [{...proposal,parentId:foreign},{...proposal,parentId:leaf},{...proposal,accountType:'ASSET'}])assert.equal((await call('/admin/account-changes',maker,body)).status,422);
   const r=(await call('/admin/accounts/parents?accountType=EXPENSE&q=6000',maker)).data;assert.equal(r.total,1);assert.equal(r.data[0].id,parent);
  });
  await t.test('self review denied even if independently granted both permissions',async()=>{
   assert.equal((await decision(requestId,decide,maker)).status,403);
   const role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,makerId])).rows[0].role_id;
   await owner.query("INSERT INTO role_permissions VALUES($1,$2,'accounts:approve')",[C1,role]);
   try{assert.equal((await decision(requestId,decide,maker)).status,403);}finally{await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='accounts:approve'",[C1,role]);}
  });
  await t.test('independent apply creates account with proposer origin and reviewer audit',async()=>{
   const key=randomUUID(),r=await decision(requestId,decide,reviewer,key);assert.equal(r.status,201,JSON.stringify(r.data));accountId=r.data.accountId;
   assert.equal((await decision(requestId,decide,reviewer,key)).data.accountId,accountId);
   assert.equal((await decision(requestId)).status,409);
   const row=(await owner.query('SELECT * FROM accounts WHERE id=$1',[accountId])).rows[0];assert.equal(row.created_by,makerId);assert.equal(row.version,1);assert.equal(row.control_type,null);assert.equal(row.parent_id,parent);
   const req=(await owner.query('SELECT * FROM account_change_requests WHERE id=$1',[requestId])).rows[0];assert.equal(req.reviewed_by,reviewerId);assert.equal(req.state,'APPLIED');
   assert.equal((await owner.query("SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1 AND action='ACCOUNT_CHANGE_APPROVE'",[requestId])).rows[0].n,1);
   assert.equal((await owner.query('SELECT count(*)::int n FROM journal_entries')).rows[0].n,0);
  });
  await t.test('duplicate code approval rolls back; request may then be rejected',async()=>{
   // Pending proposals do not reserve a code.
   const p=await submit({...proposal,code:'6502'}),q=await submit({...proposal,code:'6502'});
   assert.equal((await decision(p)).status,201);assert.equal((await decision(q)).status,409);
   assert.equal((await owner.query('SELECT state FROM account_change_requests WHERE id=$1',[q])).rows[0].state,'PENDING');
   assert.equal((await decision(q,{decision:'REJECT',reason:'Duplicate account is already available'})).status,201);
   assert.equal((await decision(q)).status,409);
  });
  await t.test('concurrent reviews commit exactly one transition and account',async()=>{
   const p=await submit({...proposal,code:'6503'});const responses=await Promise.all([decision(p),decision(p)]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
   assert.equal((await owner.query("SELECT count(*)::int n FROM accounts WHERE company_id=$1 AND code='6503'",[C1])).rows[0].n,1);
  });
  await t.test('rename changes only label/version and competing snapshots cannot overwrite',async()=>{
   const input={kind:'RENAME',accountId,expectedVersion:1,name:'Delivery costs',reason:'Correct display name without reclassification'};
   const p=await submit(input),q=await submit({...input,name:'Stale delivery label'});
   assert.equal((await call('/admin/account-changes',maker,{...input,active:false})).status,400);
   assert.equal((await decision(p)).status,201);assert.equal((await decision(q)).status,409);
   const row=(await owner.query('SELECT * FROM accounts WHERE id=$1',[accountId])).rows[0];assert.equal(row.name,'Delivery costs');assert.equal(row.version,2);assert.equal(row.created_by,makerId);assert.equal(row.updated_by,reviewerId);assert.equal(row.code,'6501');assert.equal(row.account_type,'EXPENSE');
  });
  await t.test('approval rechecks parent eligibility after proposal',async()=>{
   const header=await submit({...proposal,code:'6600',postable:false,parentId:null});const applied=await decision(header);assert.equal(applied.status,201);const id=applied.data.accountId;
   const child=await submit({...proposal,code:'6601',parentId:id});await owner.query('UPDATE accounts SET active=false WHERE id=$1',[id]);
   assert.equal((await decision(child)).status,422);assert.equal((await owner.query('SELECT state FROM account_change_requests WHERE id=$1',[child])).rows[0].state,'PENDING');
  });
  await t.test('runtime cannot bypass approved request, immutable proposal or deferred audit',async()=>{
   const db=app.get(Db) as Db;
   await assert.rejects(()=>db.transaction({userId:reviewerId,companyId:C1},c=>c.query('UPDATE accounts SET name=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1',[accountId,'Bypass approval',reviewerId])),/approved|request|configuration/i);
   await assert.rejects(()=>db.transaction({userId:makerId,companyId:C1},c=>c.query('UPDATE account_change_requests SET name=$2 WHERE id=$1',[requestId,'Tampered proposal'])),/permission|immutable|terminal/i);
   await assert.rejects(()=>db.transaction({userId:makerId,companyId:C1},c=>c.query("INSERT INTO account_change_requests(company_id,kind,code,name,account_type,postable,new_account_id,reason,created_by) VALUES($1,'CREATE','6690','Unaudited','EXPENSE',true,$2,'Attempt audit bypass',$3)",[C1,randomUUID(),makerId])),/audit/i);
   await assert.rejects(()=>db.transaction({userId:reviewerId,companyId:C1},c=>c.query('DELETE FROM account_change_requests WHERE id=$1',[requestId])),/permission|deletion/i);
  });
  await t.test('approval requires the reviewer current grant and rejection has no ledger effect',async()=>{
   const p=await submit({...proposal,code:'6692'}),role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,reviewerId])).rows[0].role_id;
   await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='accounts:approve'",[C1,role]);
   try{assert.equal((await decision(p)).status,403);}finally{await owner.query("INSERT INTO role_permissions VALUES($1,$2,'accounts:approve')",[C1,role]);}
   assert.equal((await decision(p,{decision:'REJECT',reason:'Reject unused classification proposal'})).status,201);
   assert.equal((await owner.query("SELECT count(*)::int n FROM accounts WHERE company_id=$1 AND code='6692'",[C1])).rows[0].n,0);
  });
  await t.test('cross-company rename cannot disclose or mutate another tenant account',async()=>{
   const foreign=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND code='6100'",[C2])).rows[0].id;
   assert.equal((await call('/admin/account-changes',maker,{kind:'RENAME',accountId:foreign,expectedVersion:1,name:'Cross-tenant attempt',reason:'Test tenant isolation boundary'})).status,404);
  });
  await t.test('approved headings remain unavailable for journal posting',async()=>{
   const id=await submit({...proposal,code:'6700',postable:false});const applied=await decision(id);assert.equal(applied.status,201);
   const credit=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND code='6200'",[C1])).rows[0].id;
   const r=await call('/journals/drafts',a,{branchId:B1,date:'2026-09-26',currency:'KES',description:'Reject posting to a new heading',lines:[{accountId:applied.data.accountId,debit:'10',credit:'0'},{accountId:credit,debit:'0',credit:'10'}]});assert.equal(r.status,422);
  });
  await t.test('audit failure rolls back request approval and account creation together',async()=>{
   const p=await submit({...proposal,code:'6691'});
   await owner.query("CREATE FUNCTION coa_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ACCOUNT_CHANGE_APPROVE' THEN RAISE EXCEPTION 'test audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER coa_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION coa_test_audit_failure()");
   try{assert.equal((await decision(p)).status,500);}finally{await owner.query('DROP TRIGGER coa_test_audit_failure ON audit_logs; DROP FUNCTION coa_test_audit_failure()');}
   assert.equal((await owner.query('SELECT state FROM account_change_requests WHERE id=$1',[p])).rows[0].state,'PENDING');assert.equal((await owner.query("SELECT count(*)::int n FROM accounts WHERE company_id=$1 AND code='6691'",[C1])).rows[0].n,0);
  });
  await t.test('approved account participates in a balanced independently posted journal',async()=>{
   const credit=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND code='6200'",[C1])).rows[0].id;
   const r=await call('/journals/drafts',a,{branchId:B1,date:'2026-09-26',currency:'KES',description:'COA integration test reclassification',lines:[{accountId,debit:'123.45',credit:'0'},{accountId:credit,debit:'0',credit:'123.45'}]});assert.equal(r.status,201,JSON.stringify(r.data));
   const id=r.data.id;assert.equal((await call('/documents/'+id+'/submit',a,{})).status,201);assert.equal((await call('/documents/'+id+'/approve',b,{})).status,201);assert.equal((await call('/documents/'+id+'/post',c,{})).status,201);
   const tb=(await call('/reports/trial-balance',a)).data;assert.ok(tb.some((x:any)=>x.code==='6501'));
   const before=JSON.stringify((await owner.query('SELECT * FROM journal_lines ORDER BY id')).rows);
   const rename=await submit({kind:'RENAME',accountId,expectedVersion:2,name:'Delivery costs reviewed',reason:'Correct label on a historically used account'});assert.equal((await decision(rename)).status,201);
   assert.equal(JSON.stringify((await owner.query('SELECT * FROM journal_lines ORDER BY id')).rows),before);
   assert.equal((await call('/reports/integrity',a)).data.coreJournalCheck,'PASS');
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query(`DROP DATABASE ${name}`);await admin.end();}
});
