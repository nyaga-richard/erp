import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {CustomerInvoiceService} from '../src/customer-invoices';

const companyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',branchId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',customerId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',productId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',warehouseId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ctx:any={companyId,userId:'ffffffff-ffff-4fff-8fff-ffffffffffff',branches:[branchId],requestId:'11111111-1111-4111-8111-111111111111',sessionId:'22222222-2222-4222-8222-222222222222',ip:'127.0.0.1',device:'test',permissions:['customer-invoices:create']};
function fixture(){
 const calls:any[]=[];const client:any={query:async(sql:string,params:any[]=[])=>{const q=sql.replace(/\s+/g,' ').trim();calls.push({sql:q,params});
  if(q.startsWith('SELECT id,branch_id,location_type FROM warehouses'))return {rows:[{id:warehouseId,branch_id:branchId,location_type:'SELLABLE'}],rowCount:1};
  if(q.startsWith('SELECT cu.id,cu.number'))return {rows:[{id:customerId,number:'SVC-AR',customer_type:'REGISTERED',active:true,credit_hold:false,credit_limit:'1000.00',payment_terms_days:30,currency:'KES',version:1,control_account_id:'99999999-9999-4999-8999-999999999999',account_type:'ASSET',control_type:'AR',account_active:true,postable:true,has_children:false,base_currency:'KES'}],rowCount:1};
  if(q.startsWith('SELECT * FROM numbering_format'))return {rows:[{prefix:'SCI',padding:6}],rowCount:1};
  if(q.startsWith('INSERT INTO document_sequences'))return {rows:[{prefix:'SCI',padding:6,last_value:1}],rowCount:1};
  if(q.startsWith('INSERT INTO source_documents('))return {rows:[{id:'33333333-3333-4333-8333-333333333333',document_number:'SCI-2026-000001',status:'DRAFT',revision:1}],rowCount:1};
  if(q.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[],rowCount:1};
  if(q.startsWith('SELECT id FROM users')||q.startsWith('SELECT id FROM sessions')||q.startsWith('SELECT 1 FROM memberships'))return {rows:[{id:ctx.userId}],rowCount:1};
  if(q.startsWith('SELECT DISTINCT rp.permission_code'))return {rows:[{permission_code:'customer-invoices:create'}],rowCount:1};
  if(q.startsWith('SELECT s.branch_id FROM user_branch_scopes'))return {rows:[{branch_id}],rowCount:1};
  if(q.startsWith('INSERT INTO idempotency_keys'))return {rows:[],rowCount:1};
  if(q.startsWith('SELECT * FROM idempotency_keys'))return {rows:[{request_hash:'stub-hash',result:null}],rowCount:1};
  if(q.startsWith('UPDATE idempotency_keys'))return {rows:[],rowCount:1};
  if(q.startsWith('SELECT set_config'))return {rows:[],rowCount:1};
  if(q.startsWith('INSERT'))return {rows:[],rowCount:1};
  throw new Error('Unexpected draft command SQL: '+q);
 }};
 const commands:any={run:async(_ctx:any,_key:any,_command:any,_body:any,run:any,accessWrite:boolean)=>{assert.equal(accessWrite,true);return run(client);}};
 const products:any={resolveServiceInvoiceProduct:async(c:any,_ctx:any,id:string,body:any)=>{assert.equal(c,client);assert.equal(id,productId);assert.deepEqual(body,{date:'2026-09-30',quantity:'1.25'});return {productId:id,currency:'KES',taxResult:{calculation:{net:'100.00',tax:'17.50',gross:'117.50',snapshot:{input:{quantity:'1.250000',rates:[{outputAccountId:'88888888-8888-4888-8888-888888888888'}]}}}}};}};
 const service=new CustomerInvoiceService({} as any,commands,products,{} as any);return {service,calls,client};
}

test('service credit invoice draft is inert, idempotency-commanded and stores only user inputs',async()=>{
 const {service,calls}=fixture();
 const result=await service.createDraft(ctx,'invoice-draft-key-1',{warehouseId,customerId,productId,quantity:'1.25',date:'2026-09-30',reason:'Test service invoice draft'});
 assert.equal(result.status,'DRAFT');assert.equal(result.documentNumber,'SCI-2026-000001');assert.deepEqual(result.amountPreview,{currency:'KES',net:'100.00',tax:'17.50',gross:'117.50',dueDate:'2026-10-30'});
 const source=calls.find(x=>x.sql.startsWith('INSERT INTO source_documents('));assert.ok(source);
 const payload=JSON.parse(source.params[6]);assert.deepEqual(payload,{warehouseId,customerId,productId,quantity:'1.250000'});
 assert.ok(!Object.keys(payload).some(k=>/price|tax|amount|account|paid|creditLimit/i.test(k)));
 assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO document_events(')));assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO audit_logs(')));
 assert.ok(!calls.some(x=>/INSERT INTO (sales|sale_lines|customer_transactions|tax_transactions|journal_entries|journal_lines|inventory_movements)\b/.test(x.sql)));
});

test('strict source draft rejects client price, tax, balance, actor and override fields before command',async()=>{
 const {service,calls}=fixture();
 for(const extra of [{unitPrice:'1'},{taxRate:'0'},{balance:'0'},{paidAmount:'1'},{accountId:warehouseId},{createdBy:ctx.userId},{creditOverride:true}]){
  await assert.rejects(service.createDraft(ctx,'invoice-draft-key-2',{warehouseId,customerId,productId,quantity:'1.25',date:'2026-09-30',reason:'Test service invoice draft',...extra}));
 }
 assert.equal(calls.length,0);
});

test('submit re-resolves governed inputs and atomically freezes a typed valuation without ledger effects',async()=>{
 const calls:any[]=[],source={id:'33333333-3333-4333-8333-333333333333',company_id:companyId,branch_id:branchId,document_type:'SERVICE_CREDIT_INVOICE',document_number:'SCI-2026-000001',business_date:'2026-09-30',currency:'KES',description:'Test service invoice',payload:{warehouseId,customerId,productId,quantity:'1.250000'},status:'DRAFT',revision:1,created_by:ctx.userId,approval_snapshot:null};
 const client:any={query:async(sql:string,params:any[]=[])=>{const q=sql.trim();calls.push({q,params});
  if(q.startsWith('SELECT * FROM source_documents'))return {rows:[source],rowCount:1};
  if(q.startsWith('SELECT id,branch_id,location_type FROM warehouses'))return {rows:[{id:warehouseId,branch_id:branchId,location_type:'SELLABLE'}],rowCount:1};
  if(q.startsWith('SELECT cu.id,cu.number,cu.name'))return {rows:[{id:customerId,number:'SVC-AR',name:'Service customer',customer_type:'REGISTERED',active:true,credit_hold:false,credit_limit:'1000.00',payment_terms_days:30,currency:'KES',version:1,control_account_id:'99999999-9999-4999-8999-999999999999',account_type:'ASSET',control_type:'AR',account_active:true,postable:true,has_children:false,base_currency:'KES'}],rowCount:1};
  if(q.startsWith('SELECT id FROM financial_periods'))return {rows:[{id:'77777777-7777-4777-8777-777777777777'}],rowCount:1};
  if(q.startsWith('INSERT INTO customer_invoice_valuations'))return {rows:[{id:'44444444-4444-4444-8444-444444444444'}],rowCount:1};
  return {rows:[],rowCount:1};
 }};
 const commands:any={run:async(_c:any,key:any,command:any,_body:any,fn:any,accessWrite:boolean)=>{assert.equal(key,'invoice-submit-key');assert.equal(command,'customer-invoice.submit.'+source.id);assert.equal(accessWrite,true);return fn(client);}};
 const taxSnapshot={engine:'SAME_BASE_TAX',version:1,rounding:'HALF_UP_CURRENCY_2',inclusiveAllocation:'LARGEST_REMAINDER_TAX_ID',priceMode:'EXCLUSIVE',input:{quantity:'1.250000',unitPrice:'80.000000',discount:'0.00',currency:'KES',scale:2,date:'2026-09-30',classification:'TAXABLE',rates:[{taxId:'55555555-5555-4555-8555-555555555555',rateId:'66666666-6666-4666-8666-666666666666',rate:'0.175',validFrom:'2026-01-01',validTo:'2026-12-31',inclusive:false,recoverableFraction:'1',inputAccountId:null,outputAccountId:'88888888-8888-4888-8888-888888888888'}]},totals:{net:'100.00',tax:'17.50',gross:'117.50'},components:[{taxId:'55555555-5555-4555-8555-555555555555',rateId:'66666666-6666-4666-8666-666666666666',tax:'17.50',recoverable:'17.50',nonrecoverable:'0.00'}]};
 const products:any={resolveServiceInvoiceProduct:async(_c:any,_ctx:any,pid:string,iv:any)=>{assert.equal(pid,productId);assert.deepEqual(iv,{date:'2026-09-30',quantity:'1.250000'});return {productId:pid,sku:'SERVICE',productCode:'SERVICE',name:'Service',itemType:'SERVICE',categoryId:'aaaaaaaa-1111-4111-8111-111111111111',brandId:null,uomId:'aaaaaaaa-2222-4222-8222-222222222222',quantityScale:2,currency:'KES',unitPrice:'80.000000',priceMode:'EXCLUSIVE',profileId:'aaaaaaaa-3333-4333-8333-333333333333',taxResult:{calculation:{...taxSnapshot,net:'100.00',tax:'17.50',gross:'117.50',snapshot:taxSnapshot}}};}};
 const workflow:any={snapshot:async(_c:any,_ctx:any,s:any,total:string,fallback:string)=>{assert.equal(s.document_type,'SERVICE_CREDIT_INVOICE');assert.equal(total,'117.50');assert.equal(fallback,'customer-invoices:approve');return {origin:'COMPANY_BASELINE',steps:[{number:1,permission:fallback,minimumApprovers:1}]};}};
 const service=new CustomerInvoiceService({} as any,commands,products,workflow);
 const result=await service.submitDraft(ctx,'invoice-submit-key',source.id,{expectedRevision:1,reason:'Submit service invoice for review'});
 assert.deepEqual(result,{id:source.id,documentNumber:source.document_number,status:'PENDING_APPROVAL',revision:1,valuation:{currency:'KES',net:'100.00',tax:'17.50',gross:'117.50',dueDate:'2026-10-30'}});
 const insert=calls.find(x=>x.q.startsWith('INSERT INTO customer_invoice_valuations'));assert.ok(insert);assert.equal(insert.params[21],'1.250000');assert.equal(insert.params[22],'80.000000');assert.equal(insert.params[23],'EXCLUSIVE');assert.equal(insert.params[24],'100.00');assert.deepEqual(JSON.parse(insert.params[29]),taxSnapshot);
 const update=calls.find(x=>x.q.startsWith('UPDATE source_documents'));assert.ok(update);assert.equal(update.params[2],JSON.stringify({origin:'COMPANY_BASELINE',steps:[{number:1,permission:'customer-invoices:approve',minimumApprovers:1}]}));
 assert.ok(calls.some(x=>x.q.startsWith('INSERT INTO document_events(')));assert.ok(calls.some(x=>x.q.startsWith('INSERT INTO audit_logs(')));
 assert.ok(!calls.some(x=>['INSERT INTO sales','INSERT INTO sale_lines','INSERT INTO customer_transactions','INSERT INTO tax_transactions','INSERT INTO journal_entries','INSERT INTO journal_lines','INSERT INTO inventory_movements'].some(prefix=>x.q.startsWith(prefix))));
});

test('submission body rejects client-supplied valuation authority fields before command',async()=>{
 const {service,calls}=fixture();
 await assert.rejects(service.submitDraft(ctx,'invoice-submit-key','33333333-3333-4333-8333-333333333333',{expectedRevision:1,reason:'Submit service invoice',net:'1'}));assert.equal(calls.length,0);
});

test('submission fails closed on stale source revision before resolving valuation',async()=>{
 const calls:any[]=[],id='33333333-3333-4333-8333-333333333333',source={id,document_type:'SERVICE_CREDIT_INVOICE',branch_id:branchId,created_by:ctx.userId,status:'DRAFT',revision:2};
 const client:any={query:async(sql:string)=>{calls.push(sql);return {rows:[source],rowCount:1};}};
 const commands:any={run:async(_ctx:any,key:any,_cmd:any,_body:any,fn:any,write:boolean)=>{assert.equal(key,'invoice-stale-key');assert.equal(write,true);return fn(client);}};
 const service=new CustomerInvoiceService({} as any,commands,{} as any,{} as any);
 await assert.rejects(service.submitDraft(ctx,'invoice-stale-key',id,{expectedRevision:1,reason:'Submit stale invoice'}),/Invoice draft changed/);
 assert.equal(calls.length,1);
});

test('draft list and detail are read-only, branch-scoped source projections',async()=>{
 const queries:any[]=[];const row={id:'33333333-3333-4333-8333-333333333333',branch_id:branchId,document_number:'SCI-2026-000001',status:'DRAFT',revision:1,business_date:'2026-09-30',currency:'KES',description:'Test draft',payload:{warehouseId,customerId,productId,quantity:'1.250000'}};
 const db:any={transaction:async(_ctx:any,run:any)=>run({query:async(sql:string,params:any[])=>{queries.push({sql,params});return {rows:sql.includes('count(*)')?[{n:1}]:[row],rowCount:1};}})};
 const service=new CustomerInvoiceService(db,{} as any,{} as any,{} as any);
 const result=await service.list(ctx,{});assert.equal(result.total,1);assert.equal(result.data[0].document_number,'SCI-2026-000001');
 assert.ok(queries[0].sql.includes('branch_id=ANY($2::uuid[])'));assert.deepEqual(queries[0].params[1],[branchId]);
 const detail=await service.detail(ctx,row.id);assert.deepEqual(detail.payload,row.payload);assert.ok(!('customerName' in detail));assert.equal(queries.at(-1).params[3],false);assert.ok(queries.at(-1).sql.includes('creditPolicySnapshot'));
 await service.detail({...ctx,permissions:['customer-invoices:view','customer-invoices:credit:view']},row.id);assert.equal(queries.at(-1).params[3],true);
 await assert.rejects(service.detail(ctx,'not-a-uuid'));
});

test('migrations seal future posting legs and immutable submit valuation; OpenAPI exposes submit only',()=>{
 const migration=readFileSync(path.resolve(__dirname,'../../../db/024-service-credit-invoice-foundation.sql'),'utf8');
 const valuationMigration=readFileSync(path.resolve(__dirname,'../../../db/025-service-credit-invoice-submission.sql'),'utf8');
 const spec=JSON.parse(readFileSync(path.resolve(__dirname,'../../../docs/openapi.json'),'utf8'));
 assert.match(migration,/SERVICE_CREDIT_INVOICE/);assert.match(migration,/customer-invoices:credit:view/);assert.match(migration,/VALUES\('SERVICE_CREDIT_INVOICE','SCI',6\)/);
 assert.ok(migration.includes("('SERVICE_CREDIT_INVOICE',1,'AR','DEBIT','gross')"));assert.ok(migration.includes("('SERVICE_CREDIT_INVOICE',1,'REVENUE','CREDIT','net')"));assert.ok(migration.includes("('SERVICE_CREDIT_INVOICE',1,'OUTPUT_TAX','CREDIT','tax')"));
 assert.match(valuationMigration,/CREATE TABLE customer_invoice_valuations/);assert.match(valuationMigration,/service_invoice_valuation_guard/);assert.match(valuationMigration,/service_invoice_source_guard/);assert.match(valuationMigration,/reproducible/);
 assert.ok(spec.paths['/customer-invoices']?.post);assert.ok(spec.paths['/customer-invoices/{id}/submit']?.post);assert.equal(spec.paths['/customer-invoices/{id}/approve'],undefined);assert.equal(spec.paths['/customer-invoices/{id}/post'],undefined);
 assert.equal(spec.paths['/customer-invoices'].post.requestBody.content['application/json'].schema.$ref,'#/components/schemas/ServiceCreditInvoiceDraft');
 assert.equal(spec.paths['/customer-invoices/{id}/submit'].post.requestBody.content['application/json'].schema.$ref,'#/components/schemas/ServiceCreditInvoiceSubmit');
});
