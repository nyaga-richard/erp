import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';
test('Customer registration: independent inert-to-published audited masters',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_customers_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));

  const password='Rules-Test-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),other=await login('amina@demo.local');
  await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT company_id,role_id,'customers:approve' FROM user_roles WHERE company_id=$1 AND user_id='30000000-0000-4000-8000-000000000005' ON CONFLICT DO NOTHING",[C1]);
  const path='/customers/changes';assert.equal((await call('/customers',maker)).status,200);
  const account=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND control_type='AR'",[C1])).rows[0].id;
  const body={number:'CUST-001',name:'Customer acceptance fixture',customerType:'REGISTERED',creditLimit:'9999999999999999.99',paymentTermsDays:30,controlAccountId:account,reason:'Reviewed initial customer credit policy'};let requestId='',customerId='';
  await t.test('Strict request, permissions, company and CSRF boundary',async()=>{
   assert.equal((await call('/customers')).status,401);assert.equal((await call('/customers',other)).status,403);assert.equal((await call('/customers',maker,undefined,{'X-Company-ID':C2})).status,403);
   for(const extra of [{createdBy:ids[0]},{balance:'100.00'},{currency:'USD'},{approvedBy:ids[1]},{creditLimit:'1.001'},{customerType:'WALK_IN'}])assert.equal((await call(path,maker,{...body,...extra})).status,400);
   assert.equal((await call(path,maker,body,{'X-CSRF-Token':'forged'})).status,403);assert.equal((await call(path,reviewer,body)).status,403);
  });
  await t.test('Proposal is inert, exact and idempotent; creator cannot approve',async()=>{
   const key=randomUUID(),r=await Promise.all([call(path,maker,body,{'Idempotency-Key':key}),call(path,maker,body,{'Idempotency-Key':key})]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));requestId=r[0].data.id;assert.equal(requestId,r[1].data.id);assert.equal((await owner.query('SELECT count(*) FROM customers')).rows[0].count,'0');assert.equal((await call(path,maker,{...body,name:'Changed'},{'Idempotency-Key':key})).status,409);
   assert.equal((await call(path+'/'+requestId+'/decide',maker,{decision:'APPROVE',reason:'Maker cannot self approve'})).status,403);
   const list=await call(path,maker);assert.equal(list.data.data[0].credit_limit,body.creditLimit);
  });
  await t.test('Independent publication is exact, attributable and creates only the AR binding',async()=>{
   const b={decision:'APPROVE',reason:'Independent review of customer and credit policy'},key=randomUUID(),results=await Promise.all([call(path+'/'+requestId+'/decide',reviewer,b,{'Idempotency-Key':key}),call(path+'/'+requestId+'/decide',reviewer,b,{'Idempotency-Key':key})]);assert.ok(results.every(r=>r.status===201),JSON.stringify(results));customerId=results[0].data.customerId;assert.equal(customerId,results[1].data.customerId);
   const detail=await call('/customers/'+customerId,maker);assert.equal(detail.status,200);assert.equal(detail.data.credit_limit,body.creditLimit);assert.equal(detail.data.control_account_id,account);assert.notEqual(detail.data.created_by,detail.data.approved_by);assert.equal((await call('/customers?q=CUST-001&limit=1',reviewer)).data.total,1);
   assert.equal((await call(path+'/'+requestId+'/decide',reviewer,b)).status,409);
  });
  await t.test('Duplicate customer and walk-in races do not publish twice',async()=>{
   const a=await call(path,maker,{...body,number:'RACE'}),b=await call(path,maker,{...body,number:'RACE'});assert.equal(a.status,201);assert.equal(b.status,201);const r=await Promise.all([a,b].map(x=>call(path+'/'+x.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent duplicate race review'})));assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
   const walk={number:'WALK1',name:'Anonymous walk-in',customerType:'WALK_IN',creditLimit:'0.00',paymentTermsDays:0,controlAccountId:null,reason:'Company cash walk-in classification'};const w1=await call(path,maker,walk),w2=await call(path,maker,{...walk,number:'WALK2'});assert.equal(w1.status,201);assert.equal(w2.status,201);const rr=await Promise.all([w1,w2].map(x=>call(path+'/'+x.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent walk-in review'})));assert.deepEqual(rr.map(x=>x.status).sort(),[201,409]);
   assert.equal((await owner.query("SELECT count(*) FROM customer_accounts a JOIN customers c ON c.id=a.customer_id WHERE c.customer_type='WALK_IN'")).rows[0].count,'0');
  });
  await t.test('Current reference eligibility, rejection and exact audit rollback',async()=>{
   assert.equal((await call(path,maker,{...body,number:'BADREF',controlAccountId:randomUUID()})).status,422);
   const p=await call(path,maker,{...body,number:'REJECT'});assert.equal((await call(path+'/'+p.data.id+'/decide',reviewer,{decision:'REJECT',reason:'Independent rejection retains proposal history'})).status,201);assert.equal((await owner.query("SELECT count(*) FROM customers WHERE number='REJECT'")).rows[0].count,'0');
   const pending=await call(path,maker,{...body,number:'ROLLBACK'}),key=randomUUID(),decision={decision:'APPROVE',reason:'Test atomic publication and audit failure'};
   await owner.query("CREATE FUNCTION corrupt_customer_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='CUSTOMER_CONFIGURATION' THEN NEW.new_values='{}'; END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_customer_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_customer_test()");try{assert.equal((await call(path+'/'+pending.data.id+'/decide',reviewer,decision,{'Idempotency-Key':key})).status,422);assert.equal((await owner.query("SELECT count(*) FROM customers WHERE number='ROLLBACK'")).rows[0].count,'0');assert.equal((await owner.query('SELECT state FROM customer_change_requests WHERE id=$1',[pending.data.id])).rows[0].state,'PENDING');}finally{await owner.query('DROP TRIGGER corrupt_customer_test ON audit_logs; DROP FUNCTION corrupt_customer_test()');}assert.equal((await call(path+'/'+pending.data.id+'/decide',reviewer,decision,{'Idempotency-Key':key})).status,201);
  });
  await t.test('Stale AR eligibility fails; rejected requests need no live account',async()=>{
   const pending=await call(path,maker,{...body,number:'STALE'});assert.equal(pending.status,201);
   await owner.query('UPDATE accounts SET active=false WHERE id=$1',[account]);try{assert.equal((await call(path+'/'+pending.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Stale inactive account must fail'})).status,422);assert.equal((await call(path+'/'+pending.data.id+'/decide',reviewer,{decision:'REJECT',reason:'Reject unavailable account binding'})).status,201);}finally{await owner.query('UPDATE accounts SET active=true WHERE id=$1',[account]);}
  });
  await t.test('Native final-row guard rejects post-guard publication corruption; retry works',async()=>{
   const pending=await call(path,maker,{...body,number:'FORGEDPUB'}),key=randomUUID(),decision={decision:'APPROVE',reason:'Deliberate forged publication rollback test'};
   await owner.query("CREATE FUNCTION corrupt_customer_pub_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.credit_limit=0; RETURN NEW; END $$; CREATE TRIGGER zzz_corrupt_customer_pub_test BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION corrupt_customer_pub_test()");try{assert.equal((await call(path+'/'+pending.data.id+'/decide',reviewer,decision,{'Idempotency-Key':key})).status,422);assert.equal((await owner.query("SELECT count(*) FROM customers WHERE number='FORGEDPUB'")).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER zzz_corrupt_customer_pub_test ON customers; DROP FUNCTION corrupt_customer_pub_test()');}assert.equal((await call(path+'/'+pending.data.id+'/decide',reviewer,decision,{'Idempotency-Key':key})).status,201);
  });
  await t.test('Direct runtime insertion without complete exact audit cannot commit',async()=>{
   const db=app.get(Db),ctx={companyId:C1,userId:'30000000-0000-4000-8000-000000000005'};
   await assert.rejects(db.transaction(ctx,async(c:any)=>{await c.query("SELECT set_config('app.reason','No audit must not publish',true)");await c.query("INSERT INTO customer_change_requests(company_id,created_by,number,name,customer_type,credit_limit,payment_terms_days,currency,control_account_id,reason) VALUES($1,$2,'NOAUDIT','No audit fixture','REGISTERED',0,0,'KES',$3,'No audit must not publish')",[C1,ctx.userId,account]);}));
   assert.equal((await owner.query("SELECT count(*) FROM customer_change_requests WHERE number='NOAUDIT'")).rows[0].count,'0');
  });
  await t.test('Native immutable records and audit privacy; no operational effects',async()=>{
   await assert.rejects(owner.query("UPDATE customers SET credit_limit=0 WHERE id=$1",[customerId]));await assert.rejects(owner.query('DELETE FROM customer_accounts WHERE customer_id=$1',[customerId]));await assert.rejects(owner.query("UPDATE customer_change_requests SET name='Forged' WHERE id=$1",[requestId]));
   const events=(await call('/audit',other)).data.filter((r:any)=>r.entity_type==='CUSTOMER_CONFIGURATION');assert.ok(events.length);assert.ok(events.every((r:any)=>r.new_values.redacted));
   const exact=(await owner.query("SELECT new_values->'published'->>'credit_limit' AS value FROM audit_logs WHERE entity_id=$1 AND action='CUSTOMER_CHANGE_APPROVE'",[requestId])).rows[0];assert.equal(exact.value,body.creditLimit);
   for(const table of ['customer_transactions','inventory_movements','inventory_balances','journal_entries','source_documents'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0');
  });

 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
