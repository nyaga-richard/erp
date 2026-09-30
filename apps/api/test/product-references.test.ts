import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';
test('Product reference masters: scoped immutable audited creation',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_product_refs_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));

  const password='Rules-Test-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),other=await login('amina@demo.local');
  const path='/admin/product-references';assert.equal((await call(path+'?kind=UNIT',maker)).status,200);
  const body={kind:'UNIT',code:'EA',name:'Each',quantityScale:0,reason:'Define indivisible base quantity unit'};let unit='',parent='';
  await t.test('Strict fields, permission and tenant boundary',async()=>{
   assert.equal((await call(path+'?kind=UNIT')).status,401);assert.equal((await call(path+'?kind=UNIT',other)).status,403);assert.equal((await call(path+'?kind=UNIT',maker,undefined,{'X-Company-ID':C2})).status,403);assert.equal((await call(path,maker,{...body,createdBy:ids[0]})).status,400);assert.equal((await call(path,maker,{...body,quantityScale:7})).status,400);assert.equal((await call(path,maker,body,{'X-CSRF-Token':'forged'})).status,403);assert.equal((await call(path+'?kind=UNIT&limit=101',maker)).status,400);
  });
  await t.test('Concurrent idempotency, exact audit and searchable catalog',async()=>{
   const key=randomUUID(),r=await Promise.all([call(path,maker,body,{'Idempotency-Key':key}),call(path,maker,body,{'Idempotency-Key':key})]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));unit=r[0].data.id;assert.equal(unit,r[1].data.id);const list=await call(path+'?kind=UNIT&q=EA&limit=1',maker);assert.equal(list.data.data[0].id,unit);assert.equal(list.data.data[0].quantity_scale,0);assert.equal((await call(path,maker,body)).status,409);
  });
  await t.test('Category hierarchy and brands; read permission is not creation authority',async()=>{
   const r=await call(path,maker,{kind:'CATEGORY',code:'FOOD',name:'Food',parentId:null,reason:'Root category for product classification'});assert.equal(r.status,201,JSON.stringify(r.data));parent=r.data.id;
   const child=await call(path,maker,{kind:'CATEGORY',code:'DRY',name:'Dry foods',parentId:parent,reason:'Child category linked to immutable parent'});assert.equal(child.status,201);assert.equal((await call(path+'?kind=CATEGORY&q=DRY',reviewer)).data.data[0].parent_name,'Food');
   assert.equal((await call(path,maker,{kind:'CATEGORY',code:'BAD',name:'Wrong parent',parentId:randomUUID(),reason:'Invalid scope parent test'})).status,422);
   assert.equal((await call(path,maker,{kind:'BRAND',name:'Demo brand',reason:'Testing attributable brand definition'})).status,201);assert.equal((await call(path,reviewer,body)).status,403);
  });
  await t.test('Hierarchy depth bounded and legacy/foreign parents not silently adopted',async()=>{
   let last=parent;for(let depth=2;depth<=20;depth++){const r=await call(path,maker,{kind:'CATEGORY',code:'D'+depth,name:'Depth '+depth,parentId:last,reason:'Testing bounded hierarchy ancestry'});assert.equal(r.status,201,JSON.stringify(r.data));last=r.data.id;}
   assert.equal((await call(path,maker,{kind:'CATEGORY',code:'TOODEEP',name:'Too deep',parentId:last,reason:'Depth twenty-one must be refused'})).status,422);
   const foreign=(await owner.query("INSERT INTO product_categories(company_id,created_by,code,name) VALUES($1,$2,'LEGACY','Legacy foreign parent') RETURNING id",[C2,ids[0]])).rows[0].id;assert.equal((await call(path,maker,{kind:'CATEGORY',code:'FOREIGN',name:'Foreign child',parentId:foreign,reason:'Cross-company parent must be refused'})).status,422);
  });
  await t.test('Conflicting creations serialize without duplicate metadata',async()=>{
   const b={kind:'BRAND',name:'Concurrent brand',reason:'Testing same-name creation race'};const r=await Promise.all([call(path,maker,b),call(path,maker,b)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
  });
  await t.test('No-audit direct runtime insertion cannot commit',async()=>{
   const db=app.get(Db),ctx={companyId:C1,userId:'30000000-0000-4000-8000-000000000005'};await assert.rejects(db.transaction(ctx,async(c:any)=>{await c.query("SELECT set_config('app.reason','Unaudited creation attempt',true)");await c.query("INSERT INTO units_of_measure(company_id,created_by,code,name,quantity_scale,catalog_version) VALUES($1,$2,'FORGED','No audit',0,1)",[C1,ctx.userId]);}));assert.equal((await owner.query("SELECT count(*) FROM units_of_measure WHERE code='FORGED'")).rows[0].count,'0');
  });
  await t.test('Audit corruption rolls back; retry after repair succeeds',async()=>{
   const b={kind:'BRAND',name:'Audit rollback brand',reason:'Test intentional audit publication failure'},key=randomUUID();await owner.query("CREATE FUNCTION corrupt_ref_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='PRODUCT_REFERENCE' THEN NEW.new_values=jsonb_set(NEW.new_values,'{after}','{}'); END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_ref_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_ref_test()");try{assert.equal((await call(path,maker,b,{'Idempotency-Key':key})).status,422);assert.equal((await owner.query("SELECT count(*) FROM brands WHERE name='Audit rollback brand'")).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER corrupt_ref_test ON audit_logs; DROP FUNCTION corrupt_ref_test()');}assert.equal((await call(path,maker,b,{'Idempotency-Key':key})).status,201);
  });
  await t.test('Unit and hierarchy immutable; no stock, product or financial side effect',async()=>{
   const db=app.get(Db),ctx={companyId:C1,userId:'30000000-0000-4000-8000-000000000005'};await assert.rejects(db.transaction(ctx,(c:any)=>c.query('UPDATE units_of_measure SET quantity_scale=6 WHERE id=$1',[unit])));await assert.rejects(owner.query('UPDATE product_categories SET parent_id=id WHERE id=$1',[parent]));
   for(const table of ['products','inventory_movements','inventory_balances','journal_entries','source_documents'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0');
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
