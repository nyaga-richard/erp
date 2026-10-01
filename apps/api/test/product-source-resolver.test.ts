import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProductConfigurationService} from '../src/product-configuration';

const companyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',productId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ctx:any={companyId,userId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const product={sku:'SERVICE-1',product_code:'SVC-1',name:'Consulting hour',item_type:'SERVICE',category_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',brand_id:null,uom_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',price:'80.00',price_mode:'EXCLUSIVE',currency:'KES',quantity_scale:2};
const profile={id:'ffffffff-ffff-4fff-8fff-ffffffffffff',tax_category_id:'99999999-9999-4999-8999-999999999999'};
function service(itemType='SERVICE'){
 const calls:any[]=[];const calculation={configurationOnly:true,categoryId:profile.tax_category_id,calculation:{net:'100.00',tax:'17.50',gross:'117.50',snapshot:{priceMode:'EXCLUSIVE',input:{currency:'KES'}}}};
 const client:any={query:async(sql:string,args:any[]=[])=>{calls.push({sql:sql.replace(/\s+/g,' ').trim(),args});const q=sql.replace(/\s+/g,' ').trim();
  if(q.startsWith('SELECT pg_advisory_xact_lock_shared'))return {rows:[],rowCount:1};
  if(q.startsWith('SELECT p.sku'))return {rows:[{...product,item_type:itemType}],rowCount:1};
  if(q.startsWith('SELECT * FROM product_tax_profiles'))return {rows:[profile],rowCount:1};
  if(q.startsWith('SELECT tax_id FROM product_taxes'))return {rows:[{tax_id:'12121212-1212-4121-8121-121212121212'}],rowCount:1};
  throw new Error('Unexpected query '+q);
 }};
 const taxes:any={calculateConfigured:async(_c:any,_ctx:any,body:any)=>{calls.push({taxBody:body});return calculation;}};
 const instance=new ProductConfigurationService({} as any,{} as any,taxes);
 return {instance,client,calls,taxBody:calculation};
}

test('service invoice resolver serializes immutable published price/profile/tax inputs in the caller transaction',async()=>{
 const {instance,client,calls,taxBody}=service();
 const result=await instance.resolveServiceInvoiceProduct(client,ctx,productId,{date:'2026-09-30',quantity:'1.25'});
 assert.equal(calls[0].sql.startsWith('SELECT pg_advisory_xact_lock_shared'),true);
 assert.equal(calls[1].sql.includes('FOR SHARE OF p'),false);assert.ok(calls[0].sql.startsWith('SELECT pg_advisory_xact_lock_shared'));
 assert.equal(calls[1].args[0],companyId);assert.equal(calls[1].args[1],productId);
 assert.deepEqual(calls.at(-1).taxBody,{categoryId:profile.tax_category_id,taxIds:['12121212-1212-4121-8121-121212121212'],date:'2026-09-30',quantity:'1.25',unitPrice:'80.00',discount:'0'});
 assert.equal(result.itemType,'SERVICE');assert.equal(result.unitPrice,'80.00');assert.equal(result.profileId,profile.id);assert.equal(result.taxResult,taxBody);
});

test('service invoice resolver rejects non-SERVICE products and invalid/over-precision quantities',async()=>{
 const stock=service('STOCK');await assert.rejects(stock.instance.resolveServiceInvoiceProduct(stock.client,ctx,productId,{date:'2026-09-30',quantity:'1'}),/SERVICE products only/);
 const badQty=service();await assert.rejects(badQty.instance.resolveServiceInvoiceProduct(badQty.client,ctx,productId,{date:'2026-09-30',quantity:'1.001'}),/base-unit precision/);
 const extra=service();await assert.rejects(extra.instance.resolveServiceInvoiceProduct(extra.client,ctx,productId,{date:'2026-09-30',quantity:'1',unitPrice:'1'}),/Unrecognized key/);
});

test('existing standalone tax-preview response shape is preserved',async()=>{
 const {instance,client}=service();(instance as any).db={transaction:async(_ctx:any,run:any)=>run(client)};
 const response=await instance.preview(ctx,productId,{date:'2026-09-30',quantity:'1.25',discount:'0'});
 assert.deepEqual(Object.keys(response).sort(),['calculation','categoryId','configurationOnly','productId','profileId']);
 assert.equal(response.configurationOnly,true);assert.equal(response.calculation.gross,'117.50');
});
