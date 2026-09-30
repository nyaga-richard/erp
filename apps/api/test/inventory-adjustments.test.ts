import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';
test('Stock adjustments: atomic source, valuation, movement and GL',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_stock_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));

  const password='Rules-Test-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  assert.equal((await call('/inventory/adjustments')).status,401);
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),other=await login('amina@demo.local');
  assert.equal((await call('/admin/products',maker)).status,200);
  const ref=async(body:any)=>{const r=await call('/admin/product-references',maker,{...body,reason:'Governed product reference fixture'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const taxCreate=async(body:any)=>{const r=await call('/admin/tax-changes',maker,{...body,basis:'Test only, not statutory activation',reason:'Product tax dependency fixture'});assert.equal(r.status,201,JSON.stringify(r.data));const d=await call('/admin/tax-changes/'+r.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent fixture review'});assert.equal(d.status,201,JSON.stringify(d.data));return d.data.recordId;};
  const unit=await ref({kind:'UNIT',code:'EA',name:'Each',quantityScale:0}),category=await ref({kind:'CATEGORY',code:'GOODS',name:'Goods'}),brand=await ref({kind:'BRAND',name:'Test brand'});
  const exempt=await taxCreate({kind:'CATEGORY',code:'EXEMPT',name:'Exempt test',classification:'EXEMPT'}),taxCategory=await taxCreate({kind:'CATEGORY',code:'STANDARD',name:'Taxable test',classification:'TAXABLE'}),tax=await taxCreate({kind:'TAX',code:'TESTVAT',name:'Test VAT',taxType:'VAT'});
  const ia=(await call('/admin/tax-accounts?direction=INPUT',maker)).data.data[0].id,oa=(await call('/admin/tax-accounts?direction=OUTPUT',maker)).data.data[0].id;
  const rate={kind:'RATE',taxId:tax,categoryId:taxCategory,validFrom:'2026-01-01',validTo:'2026-06-30',rate:'0.16',inclusive:false,recoverableFraction:'1',inputAccountId:ia,outputAccountId:oa};await taxCreate(rate);await taxCreate({...rate,validFrom:'2026-07-01',validTo:'2026-12-31',rate:'0.17'});
  const productRequest=await call('/admin/product-changes',maker,{sku:'STOCK01',productCode:'STOCK01',name:'Governed stock fixture',itemType:'STOCK',categoryId:category,brandId:brand,uomId:unit,purchasePrice:'999',sellingPrice:'1234',priceMode:'EXCLUSIVE',taxCategoryId:exempt,validFrom:'2026-01-01',validTo:'2026-12-31',taxIds:[],barcodes:[],reason:'Controlled stock fixture'});assert.equal(productRequest.status,201,JSON.stringify(productRequest.data));const published=await call('/admin/product-changes/'+productRequest.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent product review'});assert.equal(published.status,201);const productId=published.data.productId;
  const role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,ids[0]])).rows[0].role_id;await owner.query("INSERT INTO role_permissions SELECT $1,$2,code FROM permissions WHERE code LIKE 'inventory:%' ON CONFLICT DO NOTHING",[C1,role]);
  const creator=other,approver=await login('brian@demo.local'),poster=await login('carol@demo.local'),observer=await login('auditor@demo.local');
  const warehouseId=(await owner.query('SELECT id FROM warehouses WHERE company_id=$1 AND branch_id=$2 ORDER BY id LIMIT 1',[C1,B1])).rows[0].id;
  const accounts=(await owner.query('SELECT id,code FROM accounts WHERE company_id=$1',[C1])).rows,account=(code:string)=>accounts.find(a=>a.code===code).id;
  for(const eventType of ['STOCK_GAIN','STOCK_LOSS']){const r=await call('/admin/posting-rule-changes',maker,{kind:'CREATE',eventType,contractVersion:1,validFrom:'2026-01-01',validTo:'2026-12-31',priority:0,branchId:null,warehouseId:null,legs:[{legCode:'INVENTORY',accountId:account('1400')},{legCode:eventType==='STOCK_GAIN'?'GAIN':'LOSS',accountId:account(eventType==='STOCK_GAIN'?'4000':'5100')}],reason:'Reviewed test stock mapping'});assert.equal(r.status,201,JSON.stringify(r.data));assert.equal((await call('/admin/posting-rule-changes/'+r.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent mapping review'})).status,201);}
  const gain={kind:'STOCK_GAIN',warehouseId,productId,quantity:'10',value:'100.00',date:'2026-09-01',reason:'DEMO independently reviewed stock gain'};
  const create=async(patch:any={},user=creator)=>{const r=await call('/inventory/adjustments',user,{...gain,...patch});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const cmd=(id:string,action:string,user=creator,revision=1,key=randomUUID())=>call('/inventory/adjustments/'+id+'/'+action,user,{expectedRevision:revision,reason:'Reviewed inventory test action'},{'Idempotency-Key':key});
  const prepare=async(patch:any={})=>{const id=await create(patch);assert.equal((await cmd(id,'submit')).status,201);assert.equal((await cmd(id,'approve',approver)).status,201);return id;};
  const position=async()=>{const r=await call('/inventory/balances',creator);assert.equal(r.status,200);return r.data.data.find((x:any)=>x.product_id===productId);};
  let first='',loss='';
  await t.test('Strict inputs, permissions, scope and no proposal side effects',async()=>{
   assert.equal((await call('/inventory/adjustments',observer)).status,403);for(const patch of [{actorId:ids[0]},{balance:'100'},{accountId:account('1400')},{quantity:10},{value:'0'},{quantity:'0.5'}])assert.ok([400,422].includes((await call('/inventory/adjustments',creator,{...gain,...patch})).status));assert.equal((await call('/inventory/adjustments',creator,gain,{'X-CSRF-Token':'bad'})).status,403);
   first=await create();for(const table of ['inventory_balances','inventory_movements','journal_entries'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0');
  });
  await t.test('Valued submission, independent review/post and same-key atomic publication',async()=>{
   assert.equal((await cmd(first,'submit')).status,201);assert.equal((await cmd(first,'approve')).status,403);assert.equal((await cmd(first,'approve',approver)).status,201);assert.equal((await cmd(first,'post',approver)).status,403);const key=randomUUID(),r=await Promise.all([cmd(first,'post',poster,1,key),cmd(first,'post',poster,1,key)]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));assert.equal(r[0].data.journalId,r[1].data.journalId);const b=await position();assert.equal(b.quantity,'10.000000');assert.equal(b.base_value,'100.00');assert.equal((await call('/documents/'+first,creator)).status,404);
  });
  await t.test('Loss derives weighted value, not product reference price or caller price',async()=>{
   const id=await prepare({quantity:'10',value:'200'});assert.equal((await cmd(id,'post',poster)).status,201);
   const bad={...gain,kind:'STOCK_LOSS'};assert.equal((await call('/inventory/adjustments',creator,bad)).status,400);
   loss=await prepare({kind:'STOCK_LOSS',quantity:'5',value:undefined});assert.equal((await cmd(loss,'post',poster)).status,201);const b=await position();assert.equal(b.quantity,'15.000000');assert.equal(b.base_value,'225.00');const m=(await owner.query('SELECT base_value::text FROM inventory_movements WHERE source_id=$1',[loss])).rows[0];assert.equal(m.base_value,'-75.00');
  });
  await t.test('Concurrent approved issues serialize; stale valuation needs renewed approval',async()=>{
   const a=await prepare({kind:'STOCK_LOSS',quantity:'10',value:undefined}),b=await prepare({kind:'STOCK_LOSS',quantity:'10',value:undefined});const r=await Promise.all([cmd(a,'post',poster),cmd(b,'post',poster)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal((await position()).quantity,'5.000000');const stale=r[0].status===409?a:b;assert.equal((await cmd(stale,'refresh')).status,201);assert.equal((await cmd(stale,'submit',creator,2)).status,422);
  });
  await t.test('Later dates and zero-cent postings fail closed',async()=>{
   const future=await prepare({date:'2026-09-10',quantity:'1',value:'10'});assert.equal((await cmd(future,'post',poster)).status,201);const old=await create({date:'2026-09-09'});assert.equal((await cmd(old,'submit')).status,422);
  });
  await t.test('Deliberate movement failure rolls back GL, numbering, projection and same-key result',async()=>{
   const id=await prepare({date:'2026-09-10',quantity:'1',value:'11'}),before=await position(),count=(await owner.query('SELECT count(*) FROM journal_entries')).rows[0].count,key=randomUUID();await owner.query("CREATE FUNCTION fail_stock_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback' USING ERRCODE='23514'; END $$; CREATE TRIGGER z_test_stock_failure BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION fail_stock_test()");try{assert.equal((await cmd(id,'post',poster,1,key)).status,422);assert.equal((await position()).base_value,before.base_value);assert.equal((await owner.query('SELECT count(*) FROM journal_entries')).rows[0].count,count);}finally{await owner.query('DROP TRIGGER z_test_stock_failure ON inventory_movements; DROP FUNCTION fail_stock_test()');}assert.equal((await cmd(id,'post',poster,1,key)).status,201);
  });
  await t.test('Full linked reversal restores original loss cost, not today’s average',async()=>{
   const before=await position(),r=await call('/inventory/adjustments/'+loss+'/reversal-drafts',creator,{date:'2026-09-10',reason:'Correct original stock loss at original cost'});assert.equal(r.status,201,JSON.stringify(r.data));const id=r.data.id;assert.equal((await call('/inventory/adjustments/'+loss+'/reversal-drafts',creator,{date:'2026-09-10',reason:'Duplicate full reversal request'})).status,409);assert.equal((await cmd(id,'submit')).status,201);assert.equal((await cmd(id,'approve',approver)).status,201);assert.equal((await cmd(id,'post',poster)).status,201);assert.equal((await owner.query('SELECT base_value::text FROM inventory_movements WHERE source_id=$1',[id])).rows[0].base_value,'75.00');assert.equal((await position()).base_value,'171.00');const link=(await owner.query('SELECT reversal_of FROM journal_entries WHERE source_id=$1',[id])).rows[0];assert.ok(link.reversal_of);assert.equal((await call('/inventory/adjustments/'+id+'/reversal-drafts',creator,{date:'2026-09-10',reason:'Forbidden reversal chain'})).status,422);
  });
  await t.test('Cost permission remains required even with stock and audit authority',async()=>{
   await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='inventory:cost:view'",[C1,role]);try{assert.equal((await call('/inventory/adjustments',creator)).status,403);assert.equal((await call('/inventory/adjustments',creator,gain)).status,403);const events=(await call('/audit',creator)).data.filter((e:any)=>e.entity_type==='INVENTORY_SOURCE');assert.ok(events.length);assert.ok(events.every((e:any)=>e.new_values.redacted===true));}finally{await owner.query("INSERT INTO role_permissions VALUES($1,$2,'inventory:cost:view')",[C1,role]);}
  });
  await t.test('Inactive accounts and closed periods revalidated without partial posting',async()=>{
   const id=await prepare({date:'2026-09-10',quantity:'1',value:'5'});await owner.query('UPDATE accounts SET active=false WHERE id=$1',[account('1400')]);try{assert.equal((await cmd(id,'post',poster)).status,422);}finally{await owner.query('UPDATE accounts SET active=true WHERE id=$1',[account('1400')]);}
   await owner.query("UPDATE financial_periods SET status='CLOSED' WHERE company_id=$1",[C1]);try{assert.equal((await cmd(id,'post',poster)).status,422);}finally{await owner.query("UPDATE financial_periods SET status='OPEN' WHERE company_id=$1",[C1]);}assert.equal((await cmd(id,'cancel')).status,201);
  });
  await t.test('Balanced but wrong GL account and forged exact audit both roll back',async()=>{
   const id=await prepare({date:'2026-09-10',quantity:'1',value:'5'}),before=await position();
   await owner.query(`CREATE FUNCTION stock_wrong_account_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='${account('1400')}' THEN NEW.account_id='${account('6100')}'; END IF;RETURN NEW;END $$; CREATE TRIGGER z_stock_wrong_account BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION stock_wrong_account_test()`);try{assert.equal((await cmd(id,'post',poster)).status,422);assert.equal((await position()).base_value,before.base_value);}finally{await owner.query('DROP TRIGGER z_stock_wrong_account ON journal_lines; DROP FUNCTION stock_wrong_account_test()');}
   await owner.query("CREATE FUNCTION stock_bad_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='INVENTORY_SOURCE' AND NEW.action='POST' THEN NEW.new_values='{}'; END IF;RETURN NEW;END $$;CREATE TRIGGER z_stock_bad_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION stock_bad_audit_test()");try{assert.equal((await cmd(id,'post',poster)).status,422);assert.equal((await position()).base_value,before.base_value);}finally{await owner.query('DROP TRIGGER z_stock_bad_audit ON audit_logs; DROP FUNCTION stock_bad_audit_test()');}assert.equal((await cmd(id,'cancel')).status,201);
  });
  await t.test('Full gain reversal removes exact original value with linked immutable history',async()=>{
   const r=await call('/inventory/adjustments/'+first+'/reversal-drafts',creator,{date:'2026-09-10',reason:'Reverse first gain at its original cost'});assert.equal(r.status,201);const id=r.data.id;assert.equal((await cmd(id,'submit')).status,201);assert.equal((await cmd(id,'approve',approver)).status,201);assert.equal((await cmd(id,'post',poster)).status,201);const b=await position();assert.equal(b.quantity,'2.000000');assert.equal(b.base_value,'71.00');
  });
  await t.test('Reconciliation shows a missing projection instead of silently accepting it',async()=>{
   const saved=(await owner.query('SELECT * FROM inventory_balances WHERE company_id=$1 AND product_id=$2',[C1,productId])).rows[0];await owner.query('DELETE FROM inventory_balances WHERE id=$1',[saved.id]);try{const r=await call('/inventory/reconciliation',creator);assert.equal(r.data.status,'FAIL');assert.equal(r.data.exceptions[0].kind,'PROJECTION');}finally{await owner.query('INSERT INTO inventory_balances SELECT * FROM json_populate_record(NULL::inventory_balances,$1::json)',[JSON.stringify(saved)]);}
  });
  await t.test('Published stock threshold policy retains ordered distinct approval quorum',async()=>{
   const rr=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,'30000000-0000-4000-8000-000000000006'])).rows[0].role_id;await owner.query("INSERT INTO role_permissions SELECT $1,$2,code FROM permissions WHERE code IN ('inventory:approve','inventory:cost:view','inventory:view') ON CONFLICT DO NOTHING",[C1,rr]);
   const policy=await call('/admin/approval-policies',maker,{eventType:'STOCK_GAIN',threshold:'10',independentCreator:true,independentPoster:true,steps:[{permission:'inventory:approve',minimumApprovers:2}],reason:'Independent stock threshold policy'});assert.equal(policy.status,201,JSON.stringify(policy.data));assert.equal((await call('/admin/approval-policies/'+policy.data.id+'/publish',reviewer,{reason:'Independent policy publication'})).status,201);
   const id=await create({date:'2026-09-10',quantity:'1',value:'20'});assert.equal((await cmd(id,'submit')).status,201);const firstVote=await cmd(id,'approve',approver);assert.equal(firstVote.status,201,JSON.stringify(firstVote.data));assert.equal(firstVote.data.status,'PENDING_APPROVAL');assert.equal((await cmd(id,'post',poster)).status,409);assert.equal((await cmd(id,'approve',reviewer)).data.status,'APPROVED');assert.equal((await cmd(id,'post',poster)).status,201);
  });
  await t.test('Projection/movements are not editable and full stock/GL reconciliation is exact',async()=>{
   const db=app.get(Db),ctx={companyId:C1,userId:ids[2]};await assert.rejects(db.transaction(ctx,(c:any)=>c.query("UPDATE inventory_balances SET base_value=999")));await assert.rejects(db.transaction(ctx,(c:any)=>c.query('DELETE FROM inventory_movements')));await assert.rejects(db.transaction(ctx,(c:any)=>c.query('UPDATE inventory_movements SET quantity=1')));
   const r=await call('/inventory/reconciliation',creator);assert.equal(r.status,200);assert.equal(r.data.status,'PASS',JSON.stringify(r.data));assert.deepEqual(r.data.exceptions,[]);
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
