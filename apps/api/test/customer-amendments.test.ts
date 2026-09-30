import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';
test('Customer amendments: versioned profile/credit policy with immutable history',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_customer_amend_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));

  const password='Rules-Test-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),other=await login('amina@demo.local');
  const account=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND control_type='AR'",[C1])).rows[0].id;
  const initial=await call('/customers/changes',maker,{number:'AMEND-001',name:'Original customer',customerType:'REGISTERED',creditLimit:'100.00',paymentTermsDays:30,controlAccountId:account,reason:'Create reviewed customer amendment fixture'});assert.equal(initial.status,201);
  const approved=await call('/customers/changes/'+initial.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independently publish amendment fixture'});assert.equal(approved.status,201);const id=approved.data.customerId,path='/customers/'+id+'/amendments';
  assert.equal((await call(path,maker)).status,200); // genuine missing-route RED
  const body={expectedVersion:1,name:'Revised customer',phone:null,email:'reviewed@example.test',address:null,creditLimit:'9999999999999999.99',paymentTermsDays:45,creditHold:true,reason:'Review changed customer profile and credit policy'};let amendment='';
  const decision={decision:'APPROVE',reason:'Independent approval of exact customer policy'};
  const original=(await owner.query('SELECT customer_publication_snapshot($1) AS s',[initial.data.id])).rows[0].s;
  await t.test('Strict fields, scope, CSRF and granular amendment permission',async()=>{
   assert.equal((await call(path)).status,401);assert.equal((await call(path,other)).status,403);assert.equal((await call(path,maker,undefined,{'X-Company-ID':C2})).status,403);
   for(const extra of [{createdBy:ids[0]},{balance:'100.00'},{currency:'USD'},{active:false},{controlAccountId:account},{taxPin:'A123456789B'},{expectedVersion:0},{creditLimit:'1.001'}])assert.equal((await call(path,maker,{...body,...extra})).status,400);
   assert.equal((await call(path,maker,body,{'X-CSRF-Token':'wrong'})).status,403);assert.equal((await call(path,reviewer,body)).status,403);
  });
  await t.test('Inert exact idempotent proposal and maker denial with both grants',async()=>{
   const key=randomUUID(),results=await Promise.all([call(path,maker,body,{'Idempotency-Key':key}),call(path,maker,body,{'Idempotency-Key':key})]);assert.ok(results.every(r=>r.status===201),JSON.stringify(results));amendment=results[0].data.id;assert.equal(amendment,results[1].data.id);assert.equal((await call('/customers/'+id,maker)).data.version,1);assert.equal((await call(path,maker)).data.data[0].credit_limit,body.creditLimit);
   assert.equal((await call(path,maker,{...body,name:'Different'},{'Idempotency-Key':key})).status,409);
   await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT ur.company_id,ur.role_id,p.code FROM user_roles ur CROSS JOIN permissions p WHERE ur.company_id=$1 AND ur.user_id='30000000-0000-4000-8000-000000000005' AND p.code IN ('customers:amend:approve','customers:credit:approve') ON CONFLICT DO NOTHING",[C1]);
   assert.equal((await call('/customers/amendments/'+amendment+'/decide',maker,decision)).status,403);
  });
  await t.test('Independent update preserves original identity/publication and exact immutable audit',async()=>{
   const key=randomUUID(),r=await Promise.all([call('/customers/amendments/'+amendment+'/decide',reviewer,decision,{'Idempotency-Key':key}),call('/customers/amendments/'+amendment+'/decide',reviewer,decision,{'Idempotency-Key':key})]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));
   const c=(await call('/customers/'+id,maker)).data;assert.equal(c.version,2);assert.equal(c.credit_limit,body.creditLimit);assert.equal(c.name,body.name);assert.equal(c.credit_hold,true);assert.equal(c.created_by,original.created_by);assert.equal(c.approved_by,original.approved_by);assert.equal(c.control_account_id,account);
   assert.deepEqual((await owner.query('SELECT customer_publication_snapshot($1) AS s',[initial.data.id])).rows[0].s,original);
   const audit=(await owner.query("SELECT new_values->'after' AS a FROM audit_logs WHERE entity_id=$1 AND action='CUSTOMER_AMEND_APPROVE'",[amendment])).rows[0].a;assert.equal(audit.credit_limit,body.creditLimit);assert.equal(audit.version,2);
   assert.equal((await call(path,maker,body)).status,409);
  });
  await t.test('Two proposals against one version cannot both apply; stale request can be rejected',async()=>{
   const a=await call(path,maker,{...body,expectedVersion:2,name:'Race A'}),b=await call(path,maker,{...body,expectedVersion:2,name:'Race B'});assert.equal(a.status,201);assert.equal(b.status,201);
   const r=await Promise.all([a,b].map(x=>call('/customers/amendments/'+x.data.id+'/decide',reviewer,decision)));assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);const loser=r[0].status===409?a:b;
   assert.equal((await call('/customers/amendments/'+loser.data.id+'/decide',reviewer,{decision:'REJECT',reason:'Reject stale competing policy proposal'})).status,201);assert.equal((await call('/customers/'+id,maker)).data.version,3);
  });
  await t.test('Credit permission is independently rechecked; profile-only changes need no credit grant',async()=>{
   const role=(await owner.query("SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id='30000000-0000-4000-8000-000000000006'",[C1])).rows[0].role_id;
   const pending=await call(path,maker,{...body,expectedVersion:3,name:'Credit revocation',creditHold:false});assert.equal(pending.status,201);await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='customers:credit:approve'",[C1,role]);try{
    assert.equal((await call('/customers/amendments/'+pending.data.id+'/decide',reviewer,decision)).status,403);
    const profile=await call(path,maker,{...body,expectedVersion:3,name:'Profile-only approved'});assert.equal(profile.status,201);assert.equal((await call('/customers/amendments/'+profile.data.id+'/decide',reviewer,decision)).status,201);
   }finally{await owner.query("INSERT INTO role_permissions VALUES($1,$2,'customers:credit:approve')",[C1,role]);}
  });
  await t.test('Forged late master row and corrupt audit both roll back with retry',async()=>{
   for(const kind of ['master','request','audit']){
    const version=(await call('/customers/'+id,maker)).data.version,pending=await call(path,maker,{...body,expectedVersion:version,name:'Rollback '+kind}),key=randomUUID();assert.equal(pending.status,201);
    const table=kind==='master'?'customers':kind==='request'?'customer_amendment_requests':'audit_logs';await owner.query(`CREATE FUNCTION corrupt_amend_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${kind!=='audit'?"NEW.name='FORGED';":"IF NEW.entity_type='CUSTOMER_AMENDMENT' THEN NEW.new_values='{}'; END IF;"} RETURN NEW; END $$; CREATE TRIGGER zzz_corrupt_amend_test BEFORE ${kind!=='audit'?'UPDATE':'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION corrupt_amend_test()`);
    try{assert.equal((await call('/customers/amendments/'+pending.data.id+'/decide',reviewer,decision,{'Idempotency-Key':key})).status,422);assert.equal((await call('/customers/'+id,maker)).data.version,version);assert.equal((await owner.query('SELECT state FROM customer_amendment_requests WHERE id=$1',[pending.data.id])).rows[0].state,'PENDING');}finally{await owner.query(`DROP TRIGGER zzz_corrupt_amend_test ON ${table}; DROP FUNCTION corrupt_amend_test()`);}
    assert.equal((await call('/customers/amendments/'+pending.data.id+'/decide',reviewer,decision,{'Idempotency-Key':key})).status,201);
   }
  });
  await t.test('Operational references block credit changes, including new dependency types',async()=>{
   const current=(await call('/customers/'+id,maker)).data,pending=await call(path,maker,{...body,expectedVersion:current.version,name:'Blocked dependency',creditHold:false});assert.equal(pending.status,201);
   await owner.query('CREATE TABLE customer_operation_probe(company_id uuid NOT NULL,customer_id uuid NOT NULL,FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id))');
   try{await owner.query('INSERT INTO customer_operation_probe VALUES($1,$2)',[C1,id]);assert.equal((await call('/customers/amendments/'+pending.data.id+'/decide',reviewer,decision)).status,422);assert.equal((await call(path,maker,{...body,expectedVersion:current.version,name:'Blocked proposal',creditHold:false})).status,422);assert.equal((await call('/customers/'+id,maker)).data.version,current.version);
    const profile=await call(path,maker,{...body,expectedVersion:current.version,name:'Profile-only with dependency'});assert.equal(profile.status,201);assert.equal((await call('/customers/amendments/'+profile.data.id+'/decide',reviewer,decision)).status,201);
    const db=app.get(Db);await assert.rejects(db.pool.query('SELECT * FROM customer_operation_probe'));
   }finally{await owner.query('DROP TABLE customer_operation_probe');}
  });
  await t.test('No-op, forged preimage and missing audit cannot commit',async()=>{
   const c=(await call('/customers/'+id,maker)).data;assert.equal((await call(path,maker,{...body,expectedVersion:c.version,name:c.name})).status,422);
   const db=app.get(Db),ctx={companyId:C1,userId:'30000000-0000-4000-8000-000000000005'};
   for(const forged of [false,true])await assert.rejects(db.transaction(ctx,async(q:any)=>{await q.query("SELECT set_config('app.reason','Native unaudited amendment test',true)");await q.query(`INSERT INTO customer_amendment_requests(company_id,customer_id,expected_version,name,phone,email,address,credit_limit,payment_terms_days,credit_hold,before_snapshot,credit_changed,created_by,reason) SELECT company_id,id,version,'Unaudited profile',phone,email,address,credit_limit,payment_terms_days,credit_hold,${forged?"jsonb_set(customer_current_snapshot(id),'{name}','\"FORGED\"')":"customer_current_snapshot(id)"},false,$2,'Native unaudited amendment test' FROM customers WHERE id=$1`,[id,ctx.userId]);}));
   assert.equal((await owner.query("SELECT count(*) FROM customer_amendment_requests WHERE name='Unaudited profile'")).rows[0].count,'0');
  });
  await t.test('WALK_IN amendments preserve anonymity and zero credit while allowing a reviewed label',async()=>{
   const proposed=await call('/customers/changes',maker,{number:'WALK-AMEND',name:'Anonymous cash customer',customerType:'WALK_IN',creditLimit:'0.00',paymentTermsDays:0,controlAccountId:null,reason:'Create anonymous walk-in amendment fixture'});assert.equal(proposed.status,201);
   const published=await call('/customers/changes/'+proposed.data.id+'/decide',reviewer,decision);assert.equal(published.status,201);const wid=published.data.customerId,wp='/customers/'+wid+'/amendments';
   const b={...body,expectedVersion:1,name:'Revised anonymous cash label',email:null,creditLimit:'0.00',paymentTermsDays:0,creditHold:false};
   for(const extra of [{creditLimit:'0.01'},{paymentTermsDays:1},{creditHold:true},{phone:'0712345678'},{email:'private@example.test'},{address:'Personal address'}])assert.equal((await call(wp,maker,{...b,...extra})).status,422);
   const changed=await call(wp,maker,b);assert.equal(changed.status,201);assert.equal((await call('/customers/amendments/'+changed.data.id+'/decide',reviewer,decision)).status,201);
   const current=(await call('/customers/'+wid,maker)).data;assert.equal(current.version,2);assert.equal(current.credit_limit,'0.00');assert.equal(current.credit_hold,false);assert.equal(current.name,b.name);assert.equal(current.control_account_id,null);assert.equal(current.phone,null);assert.equal(current.email,null);
  });
  await t.test('No direct mutation, history rewriting, audit leak or financial/stock effect',async()=>{
   await assert.rejects(owner.query("UPDATE customers SET name='FORGED' WHERE id=$1",[id]));await assert.rejects(owner.query('DELETE FROM customer_amendment_requests WHERE id=$1',[amendment]));await assert.rejects(owner.query("UPDATE customer_amendment_requests SET name='FORGED' WHERE id=$1",[amendment]));
   const events=(await call('/audit',other)).data.filter((x:any)=>x.entity_type==='CUSTOMER_AMENDMENT');assert.ok(events.length);assert.ok(events.every((x:any)=>x.new_values.redacted));
   assert.deepEqual((await owner.query('SELECT customer_publication_snapshot($1) AS s',[initial.data.id])).rows[0].s,original);
   for(const table of ['customer_transactions','inventory_movements','journal_entries','source_documents'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0');
  });

 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
