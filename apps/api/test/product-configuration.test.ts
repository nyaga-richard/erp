import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';
test('Product registration: independent review, exact prices and dated tax profiles',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_products_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));

  const password='Rules-Test-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),other=await login('amina@demo.local');
  assert.equal((await call('/admin/products',maker)).status,200);
  const ref=async(body:any)=>{const r=await call('/admin/product-references',maker,{...body,reason:'Governed product reference fixture'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const taxCreate=async(body:any)=>{const r=await call('/admin/tax-changes',maker,{...body,basis:'Test only, not statutory activation',reason:'Product tax dependency fixture'});assert.equal(r.status,201,JSON.stringify(r.data));const d=await call('/admin/tax-changes/'+r.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent fixture review'});assert.equal(d.status,201,JSON.stringify(d.data));return d.data.recordId;};
  const unit=await ref({kind:'UNIT',code:'EA',name:'Each',quantityScale:0}),category=await ref({kind:'CATEGORY',code:'GOODS',name:'Goods'}),brand=await ref({kind:'BRAND',name:'Test brand'});
  const exempt=await taxCreate({kind:'CATEGORY',code:'EXEMPT',name:'Exempt test',classification:'EXEMPT'}),taxCategory=await taxCreate({kind:'CATEGORY',code:'STANDARD',name:'Taxable test',classification:'TAXABLE'}),tax=await taxCreate({kind:'TAX',code:'TESTVAT',name:'Test VAT',taxType:'VAT'});
  const ia=(await call('/admin/tax-accounts?direction=INPUT',maker)).data.data[0].id,oa=(await call('/admin/tax-accounts?direction=OUTPUT',maker)).data.data[0].id;
  const rate={kind:'RATE',taxId:tax,categoryId:taxCategory,validFrom:'2026-01-01',validTo:'2026-06-30',rate:'0.16',inclusive:false,recoverableFraction:'1',inputAccountId:ia,outputAccountId:oa};await taxCreate(rate);await taxCreate({...rate,validFrom:'2026-07-01',validTo:'2026-12-31',rate:'0.17'});
  const body={sku:'SKU-001',productCode:'ITEM-001',name:'Registered product',description:'Exact initial registration',itemType:'STOCK',categoryId:category,brandId:brand,uomId:unit,purchasePrice:'50.123456',sellingPrice:'100.000001',priceMode:'EXCLUSIVE',taxCategoryId:taxCategory,validFrom:'2026-01-01',validTo:'2026-12-31',taxIds:[tax],barcodes:['0001234567890','ALT-001'],reason:'Initial product registration with reviewed taxes'};
  const propose=async(b:any=body,key=randomUUID())=>{const r=await call('/admin/product-changes',maker,b,{'Idempotency-Key':key});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const decide=(id:string,decision='APPROVE',user=reviewer,key=randomUUID())=>call('/admin/product-changes/'+id+'/decide',user,{decision,reason:'Independent product review'},{'Idempotency-Key':key});
  let req='',product='';
  await t.test('RBAC, tenant, CSRF and strict balances/tracking/price fields',async()=>{
   assert.equal((await call('/admin/products')).status,401);assert.equal((await call('/admin/products',other)).status,403);assert.equal((await call('/admin/products',maker,undefined,{'X-Company-ID':C2})).status,403);
   for(const patch of [{quantity:'1'},{createdBy:ids[0]},{serialized:true},{purchasePrice:50.1},{purchasePrice:'1.1234567'},{sellingPrice:'100000000000000'},{validFrom:'0000-01-01'},{barcodes:['01','01']}])assert.equal((await call('/admin/product-changes',maker,{...body,...patch})).status,400,JSON.stringify(patch));
   assert.equal((await call('/admin/product-changes',maker,body,{'X-CSRF-Token':'bad'})).status,403);
  });
  await t.test('Governed reference, tax coverage and coherent mode validation',async()=>{
   for(const patch of [{categoryId:randomUUID()},{uomId:randomUUID()},{validTo:'2027-01-01'},{priceMode:'INCLUSIVE'},{taxIds:[]},{taxCategoryId:exempt}])assert.equal((await call('/admin/product-changes',maker,{...body,...patch})).status,422,JSON.stringify(patch));
   const legacy=(await owner.query("INSERT INTO units_of_measure(company_id,created_by,code,name,quantity_scale) VALUES($1,$2,'LEGACY','Legacy unit',0) RETURNING id",[C1,ids[0]])).rows[0].id;assert.equal((await call('/admin/product-changes',maker,{...body,uomId:legacy})).status,422);
  });
  await t.test('Tax schedule gaps cannot hide behind matching interval endpoints',async()=>{
   const gapTax=await taxCreate({kind:'TAX',code:'GAP',name:'Gap tax fixture',taxType:'OTHER'});await taxCreate({...rate,taxId:gapTax,validTo:'2026-01-31'});await taxCreate({...rate,taxId:gapTax,validFrom:'2026-03-01',validTo:'2026-12-31'});
   assert.equal((await call('/admin/product-changes',maker,{...body,taxIds:[gapTax]})).status,422);
  });
  await t.test('Proposal inert, idempotent and maker cannot review',async()=>{
   const key=randomUUID();req=await propose(body,key);assert.equal(await propose(body,key),req);assert.equal((await owner.query('SELECT count(*) FROM products')).rows[0].count,'0');
   const role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2 LIMIT 1',[C1,'30000000-0000-4000-8000-000000000005'])).rows[0].role_id;await owner.query("INSERT INTO role_permissions VALUES($1,$2,'products:approve')",[C1,role]);try{assert.equal((await decide(req,'APPROVE',maker)).status,403);}finally{await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='products:approve'",[C1,role]);}
  });
  await t.test('Independent concurrent replay publishes complete metadata once',async()=>{
   const key=randomUUID(),r=await Promise.all([decide(req,'APPROVE',reviewer,key),decide(req,'APPROVE',reviewer,key)]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));product=r[0].data.productId;assert.equal(product,r[1].data.productId);
   const row=(await call('/admin/products/'+product,maker)).data;assert.equal(row.purchase_price,'50.123456');assert.equal(row.selling_price,'100.000001');assert.equal(row.barcodes[0].barcode,'0001234567890');assert.equal(row.tax_profile.tax_category_id,taxCategory);assert.equal(row.tax_profile.tax_ids[0],tax);
   const scan=await call('/admin/products/lookup?barcode=0001234567890',maker);assert.equal(scan.data.id,product);assert.equal((await call('/admin/products/lookup?barcode=1234567890',maker)).status,404);
  });
  await t.test('Authoritative product-price preview follows dates and unit precision',async()=>{
   const b={date:'2026-06-30',quantity:'1',discount:'0'};const a=await call('/admin/products/'+product+'/tax-preview',maker,b);assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(a.data.calculation.tax,'16.00');assert.equal(a.data.calculation.snapshot.input.unitPrice,'100.000001');
   assert.equal((await call('/admin/products/'+product+'/tax-preview',maker,{...b,date:'2026-07-01'})).data.calculation.tax,'17.00');assert.equal((await call('/admin/products/'+product+'/tax-preview',maker,{...b,date:'2027-01-01'})).status,422);assert.equal((await call('/admin/products/'+product+'/tax-preview',maker,{...b,unitPrice:'1'})).status,400);assert.equal((await call('/admin/products/'+product+'/tax-preview',maker,{...b,quantity:'0.5'})).status,422);
  });
  await t.test('Maximum six-place decimal survives native audit and publication exactly',async()=>{
   const id=await propose({...body,sku:'MAX',productCode:'MAX',taxCategoryId:exempt,taxIds:[],barcodes:[],purchasePrice:'99999999999999.999999',sellingPrice:'99999999999999.999999'});const r=await decide(id);assert.equal(r.status,201,JSON.stringify(r.data));const row=(await call('/admin/products/'+r.data.productId,maker)).data;assert.equal(row.purchase_price,'99999999999999.999999');const audit=(await call('/audit',maker)).data.find((e:any)=>e.entity_id===id&&e.action==='PRODUCT_CHANGE_APPROVE');assert.equal(audit.new_values.published.purchase_price,'99999999999999.999999');assert.equal(audit.new_values.before.selling_price,'99999999999999.999999');assert.equal((await owner.query("SELECT new_values->'published'->>'purchase_price' AS price FROM audit_logs WHERE entity_id=$1 AND action='PRODUCT_CHANGE_APPROVE'",[id])).rows[0].price,'99999999999999.999999');
  });
  await t.test('Concurrent duplicate barcodes fail without partially publishing products',async()=>{
   const a=await propose({...body,sku:'RACE1',productCode:'RACE1',barcodes:['RACE']}),b=await propose({...body,sku:'RACE2',productCode:'RACE2',barcodes:['RACE']});const r=await Promise.all([decide(a),decide(b)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,422]);assert.equal((await owner.query("SELECT count(*) FROM products WHERE sku IN ('RACE1','RACE2')")).rows[0].count,'1');
   assert.equal((await call('/admin/product-changes',maker,{...body,barcodes:[]})).status,422);
  });
  await t.test('Approval requires current cost visibility, not just an approval grant',async()=>{
   const id=await propose({...body,sku:'COST',productCode:'COST',barcodes:[]}),role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2 LIMIT 1',[C1,'30000000-0000-4000-8000-000000000006'])).rows[0].role_id;
   await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='products:cost:view'",[C1,role]);try{assert.equal((await decide(id)).status,403);assert.equal((await call('/admin/products/'+product,reviewer)).data.purchase_price,null);}finally{await owner.query("INSERT INTO role_permissions VALUES($1,$2,'products:cost:view')",[C1,role]);}assert.equal((await decide(id,'REJECT')).status,201);
  });
  await t.test('Publication cannot change reviewed prices even before audit insertion',async()=>{
   const id=await propose({...body,sku:'FORGE',productCode:'FORGE',barcodes:[]});await owner.query("CREATE FUNCTION corrupt_product_price_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.purchase_price=1; RETURN NEW; END $$; CREATE TRIGGER aa_corrupt_product_price_test BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION corrupt_product_price_test()");try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query("SELECT count(*) FROM products WHERE sku='FORGE'")).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER aa_corrupt_product_price_test ON products; DROP FUNCTION corrupt_product_price_test()');}assert.equal((await decide(id,'REJECT')).status,201);
  });
  await t.test('Current tax accounts revalidated before approval; rejection remains possible',async()=>{
   const id=await propose({...body,sku:'STALE',productCode:'STALE',barcodes:[]});await owner.query('UPDATE accounts SET active=false WHERE id=$1',[ia]);try{assert.equal((await decide(id)).status,422);assert.equal((await decide(id,'REJECT')).status,201);}finally{await owner.query('UPDATE accounts SET active=true WHERE id=$1',[ia]);}
  });
  await t.test('Intentional child failure rolls back header/audit; same-key retry succeeds',async()=>{
   const id=await propose({...body,sku:'ROLL',productCode:'ROLL',barcodes:['ROLL']}),key=randomUUID();await owner.query("CREATE FUNCTION fail_product_child_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional child failure'; END $$; CREATE TRIGGER fail_product_child_test BEFORE INSERT ON product_barcodes FOR EACH ROW EXECUTE FUNCTION fail_product_child_test()");try{assert.equal((await decide(id,'APPROVE',reviewer,key)).status,500);assert.equal((await owner.query("SELECT count(*) FROM products WHERE sku='ROLL'")).rows[0].count,'0');assert.equal((await owner.query('SELECT state FROM product_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');}finally{await owner.query('DROP TRIGGER fail_product_child_test ON product_barcodes; DROP FUNCTION fail_product_child_test()');}assert.equal((await decide(id,'APPROVE',reviewer,key)).status,201);
  });
  await t.test('Forged publication audit rolls back every local effect',async()=>{
   const id=await propose({...body,sku:'AUDIT',productCode:'AUDIT',barcodes:[]});await owner.query("CREATE FUNCTION corrupt_product_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='PRODUCT_CONFIGURATION' AND NEW.action='PRODUCT_CHANGE_APPROVE' THEN NEW.new_values=jsonb_set(NEW.new_values,'{published}','{}'); END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_product_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_product_test()");try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query("SELECT count(*) FROM products WHERE sku='AUDIT'")).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER corrupt_product_test ON audit_logs; DROP FUNCTION corrupt_product_test()');}assert.equal((await decide(id,'REJECT')).status,201);
  });
  await t.test('Product-only observer gets no purchase costs, ledger or mutation power',async()=>{
   const role=randomUUID();await owner.query('INSERT INTO roles(id,company_id,name,created_by) VALUES($1,$2,$3,$4)',[role,C1,'Product-only fixture',ids[0]]);await owner.query("INSERT INTO role_permissions VALUES($1,$2,'products:view'),($1,$2,'workspace:view')",[C1,role]);await owner.query('DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,ids[3]]);await owner.query('INSERT INTO user_roles VALUES($1,$2,$3)',[C1,ids[3],role]);const viewer=await login('auditor@demo.local');assert.equal((await call('/admin/products/'+product,viewer)).data.purchase_price,null);assert.ok((await call('/admin/product-changes',viewer)).data.data.every((r:any)=>r.purchase_price===null));assert.equal((await call('/accounts',viewer)).status,403);assert.equal((await call('/admin/product-changes',viewer,body)).status,403);
  });
  await t.test('Audit permission alone cannot reveal product purchase-price snapshots',async()=>{
   const role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2',[C1,ids[3]])).rows[0].role_id;await owner.query("INSERT INTO role_permissions VALUES($1,$2,'audit:view')",[C1,role]);const viewer=await login('auditor@demo.local');const r=await call('/audit',viewer);assert.equal(r.status,200);const events=r.data.filter((e:any)=>e.entity_type==='PRODUCT_CONFIGURATION');assert.ok(events.length);assert.ok(events.every((e:any)=>e.new_values.redacted===true));assert.ok(events.every((e:any)=>e.actor&&e.action&&e.entity_id));assert.equal(JSON.stringify(events).includes('50.123456'),false);
  });
  await t.test('Published headers/children immutable and no inventory or accounting side effect',async()=>{
   const db=app.get(Db),ctx={companyId:C1,userId:'30000000-0000-4000-8000-000000000006'};await assert.rejects(db.transaction(ctx,(c:any)=>c.query('UPDATE products SET selling_price=1 WHERE id=$1',[product])));await assert.rejects(db.transaction(ctx,(c:any)=>c.query('DELETE FROM product_barcodes WHERE product_id=$1',[product])));await assert.rejects(db.transaction(ctx,(c:any)=>c.query("INSERT INTO product_barcodes(company_id,created_by,barcode,product_id,uom_id) VALUES($1,$2,'EXTRA',$3,$4)",[C1,ctx.userId,product,unit])));
   for(const table of ['source_documents','journal_entries','inventory_movements','inventory_balances','tax_transactions'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0');
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
