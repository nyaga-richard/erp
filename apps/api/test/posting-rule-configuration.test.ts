import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';
test('Posting-rule configuration: reviewed publication, immutable evidence and retirement',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_rules_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));
  if(existsSync('../../db/drafts/014-controlled-posting-rules.sql'))await owner.query(readFileSync('../../db/drafts/014-controlled-posting-rules.sql','utf8'));
  const password='Rules-Test-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),other=await login('amina@demo.local');
  assert.equal((await call('/admin/posting-rules/contracts',maker)).status,200);
  const accounts=(await owner.query('SELECT id,code,control_type FROM accounts WHERE company_id=$1',[C1])).rows;
  const stock=accounts.find(a=>a.control_type==='INVENTORY').id,loss=accounts.find(a=>a.code==='6100').id;
  const proposal={kind:'CREATE',eventType:'STOCK_LOSS',contractVersion:1,validFrom:'2026-01-01',validTo:null,priority:0,branchId:null,warehouseId:null,legs:[{legCode:'INVENTORY',accountId:stock},{legCode:'LOSS',accountId:loss}],reason:'Reviewed stock loss accounting mapping'};
  const propose=async(body:any=proposal)=>{const r=await call('/admin/posting-rule-changes',maker,body);assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const decide=(id:string,decision='APPROVE',user=reviewer,key=randomUUID())=>call('/admin/posting-rule-changes/'+id+'/decide',user,{decision,reason:'Independently reviewed account policy'}, {'Idempotency-Key':key});
  const effective=(date='2026-10-01')=>call(`/admin/posting-rules/effective?eventType=STOCK_LOSS&date=${date}&branchId=${B1}`,maker);
  let request='',rule='';
  await t.test('Authentication, permission, tenant, CSRF and strict schemas',async()=>{
   assert.equal((await call('/admin/posting-rules/contracts')).status,401);assert.equal((await call('/admin/posting-rules/contracts',other)).status,403);assert.equal((await call('/admin/posting-rules',maker,undefined,{'X-Company-ID':C2})).status,403);
   assert.equal((await call('/admin/posting-rule-changes',maker,proposal,{'X-CSRF-Token':'forged'})).status,403);assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,createdBy:ids[0]})).status,400);assert.equal((await call('/admin/posting-rules?limit=101',maker)).status,400);
  });
  await t.test('Contract-derived searchable accounts and scope validation',async()=>{
   const r=await call('/admin/posting-rules/accounts?eventType=STOCK_LOSS&contractVersion=1&legCode=INVENTORY&q=&limit=1',maker);assert.equal(r.status,200);assert.equal(r.data.data.length,1);assert.equal(r.data.data[0].control_type,'INVENTORY');
   assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,legs:[proposal.legs[0]]})).status,400);
   assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,legs:[proposal.legs[0],{legCode:'LOSS',accountId:stock}]})).status,422);
   const foreign=(await owner.query('SELECT id FROM accounts WHERE company_id=$1 LIMIT 1',[C2])).rows[0].id;assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,legs:[proposal.legs[0],{legCode:'LOSS',accountId:foreign}]})).status,422);
   const w=(await owner.query('SELECT id FROM warehouses WHERE company_id=$1 LIMIT 1',[C1])).rows[0].id;assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,warehouseId:w})).status,400);
  });
  await t.test('Pending requests are idempotent and financially inert',async()=>{
   const key=randomUUID(),a=await call('/admin/posting-rule-changes',maker,proposal,{'Idempotency-Key':key}),b=await call('/admin/posting-rule-changes',maker,proposal,{'Idempotency-Key':key});assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(a.data.id,b.data.id);request=a.data.id;
   assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,priority:2},{'Idempotency-Key':key})).status,409);assert.equal((await effective()).data.match,false);assert.equal((await owner.query('SELECT count(*) FROM accounting_rule_sets')).rows[0].count,'0');
  });
  await t.test('Independent review remains mandatory even with both permissions',async()=>{
   const makerId='30000000-0000-4000-8000-000000000005',role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2 LIMIT 1',[C1,makerId])).rows[0].role_id;await owner.query("INSERT INTO role_permissions VALUES($1,$2,'rules:approve')",[C1,role]);try{assert.equal((await decide(request,'APPROVE',maker)).status,403);}finally{await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='rules:approve'",[C1,role]);}
  });
  await t.test('Concurrent replay publishes once and effective lookup uses real resolver',async()=>{
   const key=randomUUID(),r=await Promise.all([decide(request,'APPROVE',reviewer,key),decide(request,'APPROVE',reviewer,key)]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));assert.equal(r[0].data.ruleId,r[1].data.ruleId);rule=r[0].data.ruleId;
   const e=await effective();assert.equal(e.data.match,true);assert.equal(e.data.selection.rule.id,rule);assert.equal(e.data.selection.rule.createdBy,'30000000-0000-4000-8000-000000000005');assert.equal(e.data.selection.rule.approvedBy,'30000000-0000-4000-8000-000000000006');
  });
  await t.test('Warehouse specificity and currency/scope eligibility are enforced against current records',async()=>{
   const wh=(await owner.query('SELECT id FROM warehouses WHERE company_id=$1 AND branch_id=$2 AND active LIMIT 1',[C1,B1])).rows[0].id;
   const options=await call('/admin/posting-rules/scope-options?kind=WAREHOUSE&branchId='+B1,maker);assert.equal(options.status,200);assert.ok(options.data.data.some((r:any)=>r.id===wh));
   const foreignBranch=(await owner.query('SELECT id FROM branches WHERE company_id=$1 LIMIT 1',[C2])).rows[0].id;assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,priority:16,branchId:foreignBranch,warehouseId:wh})).status,422);
   await owner.query("UPDATE accounts SET currency='USD' WHERE id=$1",[loss]);try{assert.equal((await call('/admin/posting-rule-changes',maker,{...proposal,priority:16})).status,422);}finally{await owner.query('UPDATE accounts SET currency=NULL WHERE id=$1',[loss]);}
   const id=await propose({...proposal,priority:16,branchId:B1,warehouseId:wh});assert.equal((await decide(id)).status,201);
   const e=await call(`/admin/posting-rules/effective?eventType=STOCK_LOSS&date=2026-10-01&branchId=${B1}&warehouseId=${wh}`,maker);assert.equal(e.data.selection.rule.priority,16);assert.equal(e.data.selection.specificity,2);assert.equal((await effective()).data.selection.rule.priority,0);
  });
  await t.test('Equal rank overlap is rejected but explicit higher priority is allowed',async()=>{
   assert.equal((await call('/admin/posting-rule-changes',maker,proposal)).status,422);
   const id=await propose({...proposal,priority:2,validFrom:'2027-01-01'});assert.equal((await decide(id,'REJECT')).status,201);
  });
  await t.test('Accounts are revalidated at approval; rejection remains possible',async()=>{
   const id=await propose({...proposal,priority:3});await owner.query('UPDATE accounts SET active=false WHERE id=$1',[loss]);try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query('SELECT state FROM posting_rule_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');assert.equal((await decide(id,'REJECT')).status,201);}finally{await owner.query('UPDATE accounts SET active=true WHERE id=$1',[loss]);}
  });
  await t.test('Publication race cannot introduce equally ranked overlaps',async()=>{
   const a=await propose({...proposal,priority:4}),b=await propose({...proposal,priority:4});const r=await Promise.all([decide(a),decide(b)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,422]);
  });
  await t.test('Exact prior audit corruption rolls back request and mapping',async()=>{
   const id=await propose({...proposal,priority:6});await owner.query("CREATE FUNCTION corrupt_rule_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='POSTING_RULE_CONFIGURATION' AND NEW.action='RULE_CHANGE_APPROVE' THEN NEW.new_values=jsonb_set(NEW.new_values,'{before}','{}'); END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_rule_audit_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_rule_audit_test()");
   try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query('SELECT state FROM posting_rule_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');assert.equal((await owner.query('SELECT count(*) FROM accounting_rule_sets WHERE priority=6')).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER corrupt_rule_audit_test ON audit_logs; DROP FUNCTION corrupt_rule_audit_test()');}
   assert.equal((await decide(id,'REJECT')).status,201);
  });
  await t.test('Intentional line insertion failure rolls back everything; same-key retry succeeds',async()=>{
   const id=await propose({...proposal,priority:8}),key=randomUUID();await owner.query("CREATE FUNCTION fail_rule_leg_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional mapping failure'; END $$; CREATE TRIGGER fail_rule_leg_test BEFORE INSERT ON accounting_rule_legs FOR EACH ROW EXECUTE FUNCTION fail_rule_leg_test()");
   try{assert.equal((await decide(id,'APPROVE',reviewer,key)).status,500);assert.equal((await owner.query('SELECT state FROM posting_rule_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');assert.equal((await owner.query('SELECT count(*) FROM accounting_rule_sets WHERE priority=8')).rows[0].count,'0');assert.equal((await owner.query("SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action='RULE_CHANGE_APPROVE'",[id])).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER fail_rule_leg_test ON accounting_rule_legs; DROP FUNCTION fail_rule_leg_test()');}
   assert.equal((await decide(id,'APPROVE',reviewer,key)).status,201);
  });
  await t.test('Forged publication snapshot and proposal leg audit are refused',async()=>{
   for(const field of ['ruleAfter','after']){
    const id=await propose({...proposal,priority:field==='after'?12:11});await owner.query("CREATE FUNCTION corrupt_rule_snapshot_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='POSTING_RULE_CONFIGURATION' AND NEW.action='RULE_CHANGE_APPROVE' THEN NEW.new_values=jsonb_set(NEW.new_values,ARRAY['"+field+"'],'{}'); END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_rule_snapshot_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_rule_snapshot_test()");
    try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query('SELECT state FROM posting_rule_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');}finally{await owner.query('DROP TRIGGER corrupt_rule_snapshot_test ON audit_logs; DROP FUNCTION corrupt_rule_snapshot_test()');}
    assert.equal((await decide(id,'REJECT')).status,201);
   }
  });
  await t.test('Rules-only observer gets configuration, not journal balances or mutation rights',async()=>{
   const user=ids[3],role=randomUUID();await owner.query('INSERT INTO roles(id,company_id,name,created_by) VALUES($1,$2,$3,$4)',[role,C1,'Rules-only observer fixture',ids[0]]);await owner.query("INSERT INTO role_permissions VALUES($1,$2,'rules:view'),($1,$2,'workspace:view')",[C1,role]);await owner.query('DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,user]);await owner.query('INSERT INTO user_roles VALUES($1,$2,$3)',[C1,user,role]);const viewer=await login('auditor@demo.local');
   assert.equal((await call('/admin/posting-rules',viewer)).status,200);assert.equal((await call('/admin/posting-rules/accounts?eventType=STOCK_LOSS&contractVersion=1&legCode=LOSS',viewer)).status,200);assert.equal((await call('/journals',viewer)).status,403);assert.equal((await call('/admin/posting-rule-changes',viewer,proposal)).status,403);
  });
  await t.test('Prospective retirement is append-only, versioned and cannot resurrect',async()=>{
   const body={kind:'RETIRE',ruleId:rule,expectedVersion:0,effectiveThrough:'2027-12-31',reason:'Prospective replacement of original accounting mapping'},a=await propose(body),b=await propose(body);assert.equal((await decide(a)).status,201);assert.equal((await decide(b)).status,409);assert.equal((await decide(b,'REJECT')).status,201);
   assert.equal((await call('/admin/posting-rule-changes',maker,{...body,expectedVersion:1,effectiveThrough:'2028-12-31'})).status,422);assert.equal((await owner.query('SELECT valid_to FROM accounting_rule_sets WHERE id=$1',[rule])).rows[0].valid_to,null);
   assert.equal((await owner.query('SELECT count(*) FROM accounting_rule_retirements WHERE rule_set_id=$1',[rule])).rows[0].count,'1');
   for(const priority of [4,8]){const target=(await owner.query('SELECT id FROM accounting_rule_sets WHERE priority=$1',[priority])).rows[0].id;const id=await propose({...body,ruleId:target});assert.equal((await decide(id)).status,201);}
   assert.equal((await effective('2027-12-31')).data.selection.rule.priority,8);assert.equal((await effective('2028-01-01')).data.match,false);

  });
  await t.test('Runtime cannot change published definitions or append unauthorized legs',async()=>{
   const db=app.get(Db),ctx={userId:'30000000-0000-4000-8000-000000000006',companyId:C1};await assert.rejects(db.transaction(ctx,(c:any)=>c.query('UPDATE accounting_rule_sets SET priority=99 WHERE id=$1',[rule])));await assert.rejects(db.transaction(ctx,(c:any)=>c.query('DELETE FROM accounting_rule_legs WHERE rule_set_id=$1',[rule])));
   await assert.rejects(db.transaction(ctx,(c:any)=>c.query("INSERT INTO accounting_rule_legs(company_id,created_by,leg_code,side,amount_key,rule_set_id,account_id) VALUES($1,$2,'EXTRA','DEBIT','stockValue',$3,$4)",[C1,ctx.userId,rule,loss])));
   assert.equal((await owner.query('SELECT count(*) FROM journal_entries')).rows[0].count,'0');assert.equal((await owner.query('SELECT count(*) FROM source_documents')).rows[0].count,'0');
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
