import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolvePostingRule} from '../src/posting-rule-resolver';
const id=(n:number)=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
const context=()=>({companyId:id(1),eventType:'GOODS_RECEIVED',date:'2026-09-26',branchId:id(2),warehouseId:id(3),productId:id(4),categoryId:id(5),taxCategoryId:null,paymentMethodId:null});
const rule=(n=10,extra:Record<string,unknown>={})=>({id:id(n),companyId:id(1),eventType:'GOODS_RECEIVED',version:n,validFrom:'2026-01-01',validTo:null,priority:0,active:true,createdBy:id(6),approvedBy:id(7),approvedAt:'2026-01-01T10:00:00Z',branchId:null,warehouseId:null,productId:null,categoryId:null,taxCategoryId:null,paymentMethodId:null,legs:[{legCode:'INVENTORY',side:'DEBIT',amountKey:'stockValue',accountId:id(8)},{legCode:'GRNI',side:'CREDIT',amountKey:'stockValue',accountId:id(9)}],...extra});

test('Posting rule chooses reviewed company default and records selection semantics',()=>{
 const r=resolvePostingRule(context(),[rule()]);assert.equal(r.rule.id,id(10));assert.equal(r.specificity,0);assert.equal(r.engine,'SCOPED_POSTING_RULE');assert.equal(r.engineVersion,1);assert.equal(r.ranking,'PRIORITY_DESC_THEN_SPECIFICITY_DESC_UNIQUE');assert.equal(r.context.companyId,id(1));
});
test('Posting rule specificity resolves equal priority; explicit priority ranks first',()=>{
 const specific=rule(11,{branchId:id(2),warehouseId:id(3)}),general=rule();assert.equal(resolvePostingRule(context(),[general,specific]).rule.id,id(11));assert.equal(resolvePostingRule(context(),[specific,rule(12,{priority:1})]).rule.id,id(12));
});
test('Posting rule highest-rank ambiguity is never broken by version, ID or input order',()=>{
 for(const candidates of [[rule(),rule(99)],[rule(99),rule()]])assert.throws(()=>resolvePostingRule(context(),candidates),(e:any)=>e.code==='RULE_AMBIGUOUS');
 assert.throws(()=>resolvePostingRule(context(),[rule(10,{branchId:id(2)}),rule(11,{productId:id(4)})]),(e:any)=>e.code==='RULE_AMBIGUOUS');
});
test('Posting rule absence fails closed',()=>{assert.throws(()=>resolvePostingRule(context(),[]),(e:any)=>e.code==='RULE_MISSING');});
test('Posting rule company, event and every constrained selector must match',()=>{
 const foreign=[rule(11,{companyId:id(90),priority:100}),rule(12,{eventType:'OTHER_EVENT',priority:100}),rule(13,{branchId:id(90),priority:100}),rule(14,{warehouseId:id(90),priority:100}),rule(15,{productId:id(90),priority:100}),rule(16,{categoryId:id(90),priority:100})];assert.equal(resolvePostingRule(context(),[...foreign,rule()]).rule.id,id(10));assert.throws(()=>resolvePostingRule(context(),foreign),(e:any)=>e.code==='RULE_MISSING');
});
test('Posting rule missing context selectors never match constrained tax/payment rules',()=>{
 assert.equal(resolvePostingRule(context(),[rule(),rule(11,{taxCategoryId:id(30),priority:100}),rule(12,{paymentMethodId:id(31),priority:100})]).rule.id,id(10));
 const c={...context(),taxCategoryId:id(30),paymentMethodId:id(31)};assert.equal(resolvePostingRule(c,[rule(),rule(11,{taxCategoryId:id(30),paymentMethodId:id(31)})]).specificity,2);
});
test('Posting rule date bounds are inclusive and expired/future rules do not apply',()=>{
 const r=rule(11,{validFrom:'2026-09-26',validTo:'2026-09-26'});assert.equal(resolvePostingRule(context(),[r]).rule.id,id(11));for(const date of ['2026-09-25','2026-09-27'])assert.throws(()=>resolvePostingRule({...context(),date},[r]),(e:any)=>e.code==='RULE_MISSING');
});
test('Posting rule inactive definitions are ignored; active publication requires independent review',()=>{
 assert.equal(resolvePostingRule(context(),[rule(),rule(11,{active:false,approvedBy:null,approvedAt:null,priority:100})]).rule.id,id(10));
 for(const change of [{approvedBy:null},{approvedAt:null},{approvedBy:id(6)}])assert.throws(()=>resolvePostingRule(context(),[rule(10,change)]));
});
test('Posting rule rejects invalid dates, selectors, bounds, amounts-as-expressions and unknown fields',()=>{
 for(const date of ['2026-02-29','0000-01-01','2026-9-26'])assert.throws(()=>resolvePostingRule({...context(),date},[rule()]));
 assert.throws(()=>resolvePostingRule({...context(),companyId:'wrong'},[rule()]));assert.throws(()=>resolvePostingRule({...context(),actorId:id(7)},[rule()]));
 assert.throws(()=>resolvePostingRule(context(),[rule(10,{validTo:'2025-12-31'})]));assert.throws(()=>resolvePostingRule(context(),[rule(10,{priority:0.5})]));
 const r=rule();r.legs[0].amountKey='stockValue * 1.16';assert.throws(()=>resolvePostingRule(context(),[r]));
});
test('Posting rule duplicate identities and symbolic legs are rejected',()=>{
 assert.throws(()=>resolvePostingRule(context(),[rule(),rule()]));assert.throws(()=>resolvePostingRule(context(),[rule(),rule(11,{version:10})]));const r=rule();r.legs[1].legCode=r.legs[0].legCode;assert.throws(()=>resolvePostingRule(context(),[r]));
});
test('Posting rule snapshot is deeply frozen and detached from mutable caller data',()=>{
 const c=context(),r=rule(),selected=resolvePostingRule(c,[r]);r.legs[0].accountId=id(99);c.productId=id(90);assert.equal(selected.rule.legs.find(l=>l.legCode==='INVENTORY')!.accountId,id(8));assert.equal(selected.context.productId,id(4));assert.ok(Object.isFrozen(selected));assert.ok(Object.isFrozen(selected.rule.legs));assert.ok(Object.isFrozen(selected.rule.legs[0]));assert.equal(Reflect.set(selected.rule,'priority',999),false);assert.equal(selected.rule.priority,0);assert.equal(Reflect.set(selected.rule.legs[0],'accountId',id(99)),false);
});
test('Posting rule selection and canonical leg snapshots are permutation invariant',()=>{
 const candidates=[rule(),rule(11,{branchId:id(2)}),rule(12,{branchId:id(2),warehouseId:id(3)}),rule(13,{priority:-1,productId:id(4)})],expected=resolvePostingRule(context(),candidates);let seed=913;
 for(let i=0;i<300;i++){const input=structuredClone(candidates);for(let j=input.length-1;j>0;j--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const k=seed%(j+1);[input[j],input[k]]=[input[k],input[j]];}if(i%2)for(const r of input)r.legs.reverse();assert.deepEqual(resolvePostingRule(context(),input),expected);}
});
