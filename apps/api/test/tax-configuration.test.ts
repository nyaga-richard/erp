import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';
test('Tax configuration: independently reviewed masters and effective schedules',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_tax_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));
  if(existsSync('../../db/drafts/015-controlled-tax-configuration.sql'))await owner.query(readFileSync('../../db/drafts/015-controlled-tax-configuration.sql','utf8'));
  const password='Rules-Test-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),other=await login('amina@demo.local');
  assert.equal((await call('/admin/tax-configuration?kind=TAX',maker)).status,200);
  const propose=async(body:any,key=randomUUID())=>{const r=await call('/admin/tax-changes',maker,body,{'Idempotency-Key':key});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const decide=(id:string,decision='APPROVE',user=reviewer,key=randomUUID())=>call('/admin/tax-changes/'+id+'/decide',user,{decision,reason:'Independent review of tax configuration'},{'Idempotency-Key':key});
  const baseTax={kind:'TAX',code:'TESTVAT',name:'Test VAT definition',taxType:'VAT',basis:'Test only; not statutory activation',reason:'Testing reviewed tax configuration'};
  let tax='',category='',zero='',exempt='',rateBody:any,rateId='';
  await t.test('RBAC, tenant, strict body and bounded search',async()=>{
   assert.equal((await call('/admin/tax-configuration?kind=TAX')).status,401);assert.equal((await call('/admin/tax-configuration?kind=TAX',other)).status,403);assert.equal((await call('/admin/tax-configuration?kind=TAX',maker,undefined,{'X-Company-ID':C2})).status,403);
   assert.equal((await call('/admin/tax-changes',maker,{...baseTax,createdBy:ids[0]})).status,400);assert.equal((await call('/admin/tax-configuration?kind=TAX&limit=101',maker)).status,400);
  });
  await t.test('Inert idempotent proposal, independent approval and immutable published master',async()=>{
   const key=randomUUID(),id=await propose(baseTax,key);assert.equal(await propose(baseTax,key),id);assert.equal((await owner.query('SELECT count(*) FROM taxes')).rows[0].count,'0');
   const role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2 LIMIT 1',[C1,'30000000-0000-4000-8000-000000000005'])).rows[0].role_id;
   await owner.query("INSERT INTO role_permissions VALUES($1,$2,'taxes:approve')",[C1,role]);try{assert.equal((await decide(id,'APPROVE',maker)).status,403);}finally{await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='taxes:approve'",[C1,role]);}
   const k=randomUUID(),results=await Promise.all([decide(id,'APPROVE',reviewer,k),decide(id,'APPROVE',reviewer,k)]);assert.ok(results.every(r=>r.status===201),JSON.stringify(results));tax=results[0].data.recordId;assert.equal(tax,results[1].data.recordId);
   assert.equal((await decide(id)).status,409);assert.equal((await call('/admin/tax-changes',maker,baseTax)).status,422);
  });
  await t.test('Classified categories and eligible TAX accounts',async()=>{
   for(const [code,classification] of [['STD','TAXABLE'],['ZERO','ZERO_RATED'],['EXEMPT','EXEMPT']]){const id=await propose({kind:'CATEGORY',code,name:code,classification,basis:baseTax.basis,reason:baseTax.reason});const r=await decide(id);assert.equal(r.status,201,JSON.stringify(r.data));if(code==='STD')category=r.data.recordId;else if(code==='ZERO')zero=r.data.recordId;else exempt=r.data.recordId;}
   const input=await call('/admin/tax-accounts?direction=INPUT&limit=1',maker),output=await call('/admin/tax-accounts?direction=OUTPUT',maker);assert.equal(input.data.data[0].control_type,'TAX');assert.equal(input.data.data[0].account_type,'ASSET');assert.equal(output.data.data[0].account_type,'LIABILITY');
   rateBody={kind:'RATE',taxId:tax,categoryId:category,validFrom:'2026-01-01',validTo:'2026-12-31',rate:'0.16',inclusive:false,recoverableFraction:'0.5',inputAccountId:input.data.data[0].id,outputAccountId:output.data.data[0].id,basis:baseTax.basis,reason:baseTax.reason};
  });
  await t.test('Exact factors, real Gregorian dates, category, scope and account constraints',async()=>{
   for(const patch of [{rate:0.16},{rate:'0.12345678912'},{validFrom:'0000-01-01'},{validFrom:'2026-02-30'},{validTo:'2025-12-31'}])assert.equal((await call('/admin/tax-changes',maker,{...rateBody,...patch})).status,400);
   for(const patch of [{categoryId:exempt},{categoryId:zero},{rate:'0'},{inputAccountId:rateBody.outputAccountId},{recoverableFraction:'1.1'}])assert.ok([400,422].includes((await call('/admin/tax-changes',maker,{...rateBody,...patch})).status));
   const foreign=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND control_type='TAX' LIMIT 1",[C2])).rows[0].id;assert.equal((await call('/admin/tax-changes',maker,{...rateBody,inputAccountId:foreign})).status,422);
  });
  await t.test('Account revalidation at approval and rejection without publication',async()=>{
   const id=await propose(rateBody);await owner.query('UPDATE accounts SET active=false WHERE id=$1',[rateBody.inputAccountId]);try{assert.equal((await decide(id)).status,422);assert.equal((await decide(id,'REJECT')).status,201);}finally{await owner.query('UPDATE accounts SET active=true WHERE id=$1',[rateBody.inputAccountId]);}
  });
  await t.test('Currency revalidation, bounded account search and CSRF protection',async()=>{
   const id=await propose(rateBody);await owner.query("UPDATE accounts SET currency='USD' WHERE id=$1",[rateBody.inputAccountId]);try{assert.equal((await decide(id)).status,422);assert.equal((await call('/admin/tax-accounts?direction=INPUT',maker)).data.total,0);}finally{await owner.query('UPDATE accounts SET currency=NULL WHERE id=$1',[rateBody.inputAccountId]);}
   assert.equal((await decide(id,'REJECT')).status,201);assert.equal((await call('/admin/tax-changes',maker,baseTax,{'X-CSRF-Token':'forged'})).status,403);
  });
  await t.test('Concurrent overlap prevented; adjacent schedule allowed',async()=>{
   const a=await propose(rateBody),b=await propose(rateBody);const r=await Promise.all([decide(a),decide(b)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,422]);rateId=r.find(x=>x.status===201)!.data.recordId;
   const id=await propose({...rateBody,validFrom:'2027-01-01',validTo:'2027-12-31',rate:'0.17'});assert.equal((await decide(id)).status,201);
  });
  await t.test('ID-based preview resolves dates and exact arithmetic; caller factors rejected',async()=>{
   const body={categoryId:category,taxIds:[tax],date:'2026-12-31',quantity:'1',unitPrice:'100',discount:'0'};
   const r=await call('/admin/tax-preview',maker,body);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.calculation.tax,'16.00');assert.equal(r.data.calculation.components[0].recoverable,'8.00');assert.equal(r.data.calculation.snapshot.input.rates[0].rateId,rateId);assert.equal(r.data.configurationOnly,true);
   assert.equal((await call('/admin/tax-preview',maker,{...body,date:'2027-01-01'})).data.calculation.tax,'17.00');assert.equal((await call('/admin/tax-preview',maker,{...body,date:'2028-01-01'})).status,422);
   assert.equal((await call('/admin/tax-preview',maker,{...body,rates:[]})).status,400);assert.equal((await call('/admin/tax-preview',maker,{...body,taxIds:[]})).status,422);
   assert.equal((await call('/admin/tax-preview',maker,{...body,categoryId:exempt,taxIds:[]})).data.calculation.tax,'0.00');
   const id=await propose({...rateBody,categoryId:zero,rate:'0',recoverableFraction:'0'});assert.equal((await decide(id)).status,201);assert.equal((await call('/admin/tax-preview',maker,{...body,categoryId:zero})).data.calculation.snapshot.input.classification,'ZERO_RATED');
  });
  await t.test('Publication failure rolls back and same key can retry',async()=>{
   const id=await propose({...baseTax,code:'ROLLBACK'}),key=randomUUID();await owner.query("CREATE FUNCTION fail_tax_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional tax failure'; END $$; CREATE TRIGGER fail_tax_test BEFORE INSERT ON taxes FOR EACH ROW EXECUTE FUNCTION fail_tax_test()");try{assert.equal((await decide(id,'APPROVE',reviewer,key)).status,500);assert.equal((await owner.query('SELECT state FROM tax_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');}finally{await owner.query('DROP TRIGGER fail_tax_test ON taxes; DROP FUNCTION fail_tax_test()');}assert.equal((await decide(id,'APPROVE',reviewer,key)).status,201);
  });
  await t.test('Forged audit snapshot refuses publication atomically',async()=>{
   const id=await propose({...baseTax,code:'AUDIT'});await owner.query("CREATE FUNCTION corrupt_tax_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='TAX_CONFIGURATION' AND NEW.action='TAX_CHANGE_APPROVE' THEN NEW.new_values=jsonb_set(NEW.new_values,'{before}','{}'); END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_tax_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_tax_test()");try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query('SELECT state FROM tax_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');}finally{await owner.query('DROP TRIGGER corrupt_tax_test ON audit_logs; DROP FUNCTION corrupt_tax_test()');}assert.equal((await decide(id,'REJECT')).status,201);
  });
  await t.test('Exact publication audit and direct runtime insertion are guarded',async()=>{
   const id=await propose({...baseTax,code:'SNAPSHOT'});await owner.query("CREATE FUNCTION corrupt_tax_published_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='TAX_CONFIGURATION' AND NEW.action='TAX_CHANGE_APPROVE' THEN NEW.new_values=jsonb_set(NEW.new_values,'{published}','{}'); END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_tax_published_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_tax_published_test()");try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query("SELECT count(*) FROM taxes WHERE code='SNAPSHOT'")).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER corrupt_tax_published_test ON audit_logs; DROP FUNCTION corrupt_tax_published_test()');}assert.equal((await decide(id,'REJECT')).status,201);
   const db=app.get(Db),ctx={userId:'30000000-0000-4000-8000-000000000006',companyId:C1};await assert.rejects(db.transaction(ctx,(c:any)=>c.query("INSERT INTO taxes(company_id,created_by,code,name,tax_type) VALUES($1,$2,'FORGED','Forged master','VAT')",[C1,ctx.userId])));
  });
  await t.test('Tax-only reader cannot see balances or propose configuration',async()=>{
   const user=ids[3],role=randomUUID();await owner.query('INSERT INTO roles(id,company_id,name,created_by) VALUES($1,$2,$3,$4)',[role,C1,'Tax-only fixture',ids[0]]);await owner.query("INSERT INTO role_permissions VALUES($1,$2,'taxes:view'),($1,$2,'workspace:view')",[C1,role]);await owner.query('DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,user]);await owner.query('INSERT INTO user_roles VALUES($1,$2,$3)',[C1,user,role]);const viewer=await login('auditor@demo.local');assert.equal((await call('/admin/tax-configuration?kind=RATE',viewer)).status,200);assert.equal((await call('/admin/tax-accounts?direction=INPUT',viewer)).status,200);assert.equal((await call('/journals',viewer)).status,403);assert.equal((await call('/admin/tax-changes',viewer,baseTax)).status,403);
  });
  await t.test('Runtime mutation denied and configuration has no operational effects',async()=>{
   const db=app.get(Db),ctx={userId:'30000000-0000-4000-8000-000000000006',companyId:C1};for(const [table,id] of [['taxes',tax],['tax_categories',category],['tax_rates',rateId]]){await assert.rejects(db.transaction(ctx,(c:any)=>c.query(`DELETE FROM ${table} WHERE id=$1`,[id])));}
   await assert.rejects(db.transaction(ctx,(c:any)=>c.query('UPDATE tax_rates SET rate=0.2 WHERE id=$1',[rateId])));
   for(const table of ['source_documents','journal_entries','tax_transactions','inventory_movements'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0');
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
