// NEXT SOURCE ACCEPTANCE: the inert draft slice is implemented; end-to-end
// acceptance remains RED until the full transactional source is complete. Kept
// outside test/*.test.ts so unreleased work cannot masquerade as a green suite.
// Run from apps/api: tsx --test acceptance/*.test.ts.
// Disposable database only. No live demo state, passwords or rate buckets change.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,B1,ids} from '../src/seed';

test('NEXT service credit invoice: inert draft and atomic source/AR/tax/journal acceptance',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_invoice_acceptance_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const u=new URL(adminUrl);u.pathname='/'+name;const owner=new Pool({connectionString:u.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));
  const password='Isolated-Acceptance-Only-Password-2026!';await seed(u.toString(),password);
  const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  type User={cookie:string;csrf:string};
  const call=async(path:string,user?:User,body?:any,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':C1,'Idempotency-Key':randomUUID(),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),creator=await login('amina@demo.local'),approver=await login('brian@demo.local'),poster=await login('carol@demo.local');
  const reference=async(body:any)=>{const r=await call('/admin/product-references',maker,{...body,reason:'Service invoice governed reference fixture'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const taxCreate=async(body:any)=>{const r=await call('/admin/tax-changes',maker,{...body,basis:'Synthetic acceptance fixture, not statutory activation',reason:'Service invoice tax dependency fixture'});assert.equal(r.status,201,JSON.stringify(r.data));const d=await call('/admin/tax-changes/'+r.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent synthetic fixture review'});assert.equal(d.status,201,JSON.stringify(d.data));return d.data.recordId;};
  const unit=await reference({kind:'UNIT',code:'HOUR',name:'Service hour',quantityScale:2}),category=await reference({kind:'CATEGORY',code:'SERVICE',name:'Services'});
  const taxCategory=await taxCreate({kind:'CATEGORY',code:'SYNTH',name:'Synthetic taxable fixture',classification:'TAXABLE'}),tax=await taxCreate({kind:'TAX',code:'SYNTHVAT',name:'Synthetic VAT fixture',taxType:'VAT'});
  const ia=(await call('/admin/tax-accounts?direction=INPUT',maker)).data.data[0].id,oa=(await call('/admin/tax-accounts?direction=OUTPUT',maker)).data.data[0].id;
  await taxCreate({kind:'RATE',taxId:tax,categoryId:taxCategory,validFrom:'2026-01-01',validTo:'2026-12-31',rate:'0.175',inclusive:false,recoverableFraction:'1',inputAccountId:ia,outputAccountId:oa});
  const productRequest=await call('/admin/product-changes',maker,{sku:'SERVICE-ACCEPT',productCode:'SERVICE-ACCEPT',name:'Synthetic service invoice fixture',itemType:'SERVICE',categoryId:category,brandId:null,uomId:unit,purchasePrice:'0',sellingPrice:'80.00',priceMode:'EXCLUSIVE',taxCategoryId:taxCategory,validFrom:'2026-01-01',validTo:'2026-12-31',taxIds:[tax],barcodes:[],reason:'Controlled service fixture'});assert.equal(productRequest.status,201,JSON.stringify(productRequest.data));const published=await call('/admin/product-changes/'+productRequest.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent service product review'});assert.equal(published.status,201);const productId=published.data.productId;
  const ar=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND control_type='AR' AND active AND postable ORDER BY id LIMIT 1",[C1])).rows[0].id;
  const customerRequest=await call('/customers/changes',maker,{number:'SVC-AR',name:'Synthetic invoice customer',customerType:'REGISTERED',creditLimit:'1000.00',paymentTermsDays:30,controlAccountId:ar,reason:'Governed service invoice credit fixture'});assert.equal(customerRequest.status,201,JSON.stringify(customerRequest.data));const customer=await call('/customers/changes/'+customerRequest.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent customer review'});assert.equal(customer.status,201);const customerId=customer.data.customerId;
  const warehouseId=(await owner.query("SELECT id FROM warehouses WHERE company_id=$1 AND branch_id=$2 AND active AND location_type='SELLABLE' ORDER BY id LIMIT 1",[C1,B1])).rows[0].id;
  // Only grants already registered by a future reviewed migration can be added.
  // This is disposable fixture setup, never a production role-name bypass.
  for(const [actor,actions] of [[ids[0],['view','create','submit','cancel','reverse']],[ids[1],['view','approve']],[ids[2],['view','post']]] as Array<[string,string[]]>)await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT ur.company_id,ur.role_id,p.code FROM user_roles ur CROSS JOIN permissions p WHERE ur.company_id=$1 AND ur.user_id=$2 AND p.code=ANY($3::text[]) ON CONFLICT DO NOTHING",[C1,actor,actions.map(a=>'customer-invoices:'+a)]);
  let invoiceId='';
  const body={warehouseId,customerId,productId,quantity:'1.25',date:'2026-09-30',reason:'Synthetic reviewed service credit invoice'};
  await t.test('Authenticated registered service source accepts only an inert governed draft',async()=>{
   const key=randomUUID();
   const r=await call('/customer-invoices',creator,body,{'Idempotency-Key':key});assert.equal(r.status,201,'The inert governed draft route must exist; '+JSON.stringify(r.data));
   invoiceId=r.data.id;assert.equal(r.data.status,'DRAFT');assert.equal((await call('/customer-invoices',creator,body,{'Idempotency-Key':key})).data.id,r.data.id);
   for(const extra of [{unitPrice:'1'},{taxRate:'0'},{balance:'0'},{postedOutstanding:'0'},{accountId:ar},{createdBy:ids[0]},{paidAmount:'100'},{creditOverride:true}])assert.equal((await call('/customer-invoices',creator,{...body,...extra})).status,400);
   for(const table of ['journal_entries','customer_transactions','tax_transactions','inventory_movements'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0',table+' must remain inert before posting');
  });
  // The source lifecycle assertions remain outside the released suite and are
  // expected to fail until submit/review/post/reversal and native controls exist.
  if(invoiceId){
   const cmd=(id:string,action:string,user:User,revision=1,key=randomUUID())=>call('/customer-invoices/'+id+'/'+action,user,{expectedRevision:revision,reason:'Synthetic independent invoice action'},{'Idempotency-Key':key});
   await t.test('Governed mapping and independent review retain exact server-derived totals',async()=>{
    const revenue=(await owner.query("SELECT id FROM accounts WHERE company_id=$1 AND account_type='REVENUE' AND control_type IS NULL AND active AND postable ORDER BY id LIMIT 1",[C1])).rows[0].id;
    const mapping=await call('/admin/posting-rule-changes',maker,{kind:'CREATE',eventType:'SERVICE_CREDIT_INVOICE',contractVersion:1,validFrom:'2026-01-01',validTo:'2026-12-31',priority:0,branchId:null,warehouseId:null,legs:[{legCode:'AR',accountId:ar},{legCode:'REVENUE',accountId:revenue},{legCode:'OUTPUT_TAX',accountId:oa}],reason:'Synthetic reviewed invoice mapping'});assert.equal(mapping.status,201,JSON.stringify(mapping.data));assert.equal((await call('/admin/posting-rule-changes/'+mapping.data.id+'/decide',reviewer,{decision:'APPROVE',reason:'Independent invoice mapping review'})).status,201);
    const submitted=await cmd(invoiceId,'submit',creator);assert.equal(submitted.status,201,JSON.stringify(submitted.data));
    // Test maker segregation even when they hold approval authority.
    await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT company_id,role_id,'customer-invoices:approve' FROM user_roles WHERE company_id=$1 AND user_id=$2 ON CONFLICT DO NOTHING",[C1,ids[0]]);
    assert.equal((await cmd(invoiceId,'approve',creator)).status,403);assert.equal((await cmd(invoiceId,'approve',approver)).status,201);
    const source=(await owner.query('SELECT status,approval_snapshot FROM source_documents WHERE id=$1',[invoiceId])).rows[0];assert.equal(source.status,'APPROVED');assert.equal(source.approval_snapshot.baseAmount,'117.50');
    assert.equal((await owner.query('SELECT count(*) FROM customer_transactions')).rows[0].count,'0');
   });
   await t.test('Late subledger forgery rolls back journal, tax, AR, source and idempotency; retry posts exactly once',async()=>{
    const key=randomUUID();await owner.query("CREATE FUNCTION sabotage_invoice_ar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.debit=NEW.debit+0.01; RETURN NEW; END $$; CREATE TRIGGER zzz_sabotage_invoice_ar BEFORE INSERT ON customer_transactions FOR EACH ROW EXECUTE FUNCTION sabotage_invoice_ar()");
    try{const bad=await cmd(invoiceId,'post',poster,1,key);assert.equal(bad.status,422,JSON.stringify(bad.data));for(const table of ['journal_entries','customer_transactions','tax_transactions','inventory_movements'])assert.equal((await owner.query('SELECT count(*) FROM '+table)).rows[0].count,'0');assert.equal((await owner.query('SELECT status FROM source_documents WHERE id=$1',[invoiceId])).rows[0].status,'APPROVED');}finally{await owner.query('DROP TRIGGER zzz_sabotage_invoice_ar ON customer_transactions;DROP FUNCTION sabotage_invoice_ar()');}
    const results=await Promise.all([cmd(invoiceId,'post',poster,1,key),cmd(invoiceId,'post',poster,1,key)]);assert.ok(results.every(r=>r.status===201),JSON.stringify(results));assert.equal(results[0].data.journalId,results[1].data.journalId);
    const arRow=(await owner.query('SELECT customer_id,control_account_id,debit::text,credit::text,due_date::text FROM customer_transactions WHERE source_id=$1',[invoiceId])).rows;assert.deepEqual(arRow,[{customer_id:customerId,control_account_id:ar,debit:'117.50',credit:'0.00',due_date:'2026-10-30'}]);
    const sales=(await owner.query('SELECT net::text,tax::text,gross::text FROM sales WHERE source_id=$1',[invoiceId])).rows;assert.deepEqual(sales,[{net:'100.00',tax:'17.50',gross:'117.50'}]);
    const taxRows=(await owner.query('SELECT taxable_base::text,tax_amount::text,account_id,journal_line_id FROM tax_transactions WHERE source_id=$1',[invoiceId])).rows;assert.equal(taxRows.length,1);assert.equal(taxRows[0].taxable_base,'100.00');assert.equal(taxRows[0].tax_amount,'17.50');assert.equal(taxRows[0].account_id,oa);assert.ok(taxRows[0].journal_line_id);
    const lines=(await owner.query('SELECT l.account_id,l.debit::text,l.credit::text FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id WHERE j.source_id=$1 ORDER BY l.line_no',[invoiceId])).rows;assert.equal(lines.length,3);assert.ok(lines.some(l=>l.account_id===ar&&l.debit==='117.50'&&l.credit==='0.00'));assert.ok(lines.some(l=>l.account_id===oa&&l.debit==='0.00'&&l.credit==='17.50'));
    assert.equal((await owner.query('SELECT count(*) FROM inventory_movements')).rows[0].count,'0');
   });
   await t.test('Linked original-value full reversal returns AR/tax/revenue to zero without stock effects',async()=>{
    const r=await call('/customer-invoices/'+invoiceId+'/reversal-drafts',creator,{date:'2026-10-01',reason:'Full original-value synthetic invoice reversal'});assert.equal(r.status,201,JSON.stringify(r.data));const reversal=r.data.id;
    assert.equal((await cmd(reversal,'submit',creator)).status,201);assert.equal((await cmd(reversal,'approve',approver)).status,201);assert.equal((await cmd(reversal,'post',poster)).status,201);
    assert.equal((await owner.query('SELECT sum(debit-credit)::text n FROM customer_transactions WHERE customer_id=$1',[customerId])).rows[0].n,'0.00');
    assert.equal((await owner.query('SELECT sum(tax_amount)::text n FROM tax_transactions WHERE source_id=ANY($1::uuid[])',[[invoiceId,reversal]])).rows[0].n,'0.00');
    assert.equal((await owner.query('SELECT l.account_id FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id WHERE j.source_id=ANY($1::uuid[]) GROUP BY l.account_id HAVING sum(l.debit-l.credit)<>0',[[invoiceId,reversal]])).rowCount,0);
    assert.equal((await owner.query('SELECT count(*) FROM inventory_movements')).rows[0].count,'0');assert.equal((await call('/customer-invoices/'+invoiceId+'/reversal-drafts',creator,{date:'2026-10-01',reason:'Duplicate original reversal forbidden'})).status,409);
   });
   await t.test('Two reviewed invoices cannot spend the same unlocked credit headroom',async()=>{
    const drafts=await Promise.all([call('/customer-invoices',creator,{...body,quantity:'6.00'}),call('/customer-invoices',creator,{...body,quantity:'6.00'})]);assert.ok(drafts.every(r=>r.status===201),JSON.stringify(drafts));
    for(const r of drafts){assert.equal((await cmd(r.data.id,'submit',creator)).status,201);assert.equal((await cmd(r.data.id,'approve',approver)).status,201);}
    const posted=await Promise.all(drafts.map(r=>cmd(r.data.id,'post',poster)));assert.deepEqual(posted.map(r=>r.status).sort(),[201,409]);
    assert.equal((await owner.query('SELECT sum(debit-credit)::text n FROM customer_transactions WHERE customer_id=$1',[customerId])).rows[0].n,'564.00');
    const loser=drafts[posted[0].status===409?0:1].data.id;assert.equal((await owner.query('SELECT count(*) FROM journal_entries WHERE source_id=$1',[loser])).rows[0].count,'0');assert.equal((await cmd(loser,'cancel',creator)).status,201);
   });

  }
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
