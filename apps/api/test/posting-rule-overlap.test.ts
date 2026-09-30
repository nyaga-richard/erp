import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ZodError} from 'zod';
import {postingRuleScopesConflict,resolvePostingRule} from '../src/posting-rule-resolver';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dimensions=['branchId','warehouseId','productId','categoryId','taxCategoryId','paymentMethodId'] as const;
const scope=(changes:Record<string,unknown>={})=>({companyId:id(1),eventType:'GOODS_RECEIVED',validFrom:'2026-01-01',validTo:null,priority:0,branchId:null,warehouseId:null,productId:null,categoryId:null,taxCategoryId:null,paymentMethodId:null,...changes});
test('Identical scopes conflict symmetrically without mutating input',()=>{const a=scope(),b=scope();const before=JSON.stringify([a,b]);assert.equal(postingRuleScopesConflict(a,b),true);assert.equal(postingRuleScopesConflict(b,a),true);assert.equal(JSON.stringify([a,b]),before);});
test('Tenant/event separation and unequal ranks cannot tie',()=>{for(const patch of [{companyId:id(2)},{eventType:'STOCK_LOSS'},{priority:1},{branchId:id(10)}])assert.equal(postingRuleScopesConflict(scope(),scope(patch)),false);});
test('Date intersection is inclusive and supports open ends and extreme Gregorian years',()=>{assert.equal(postingRuleScopesConflict(scope({validTo:'2026-02-01'}),scope({validFrom:'2026-02-01'})),true);assert.equal(postingRuleScopesConflict(scope({validTo:'2026-01-31'}),scope({validFrom:'2026-02-01'})),false);assert.equal(postingRuleScopesConflict(scope({validFrom:'0001-01-01'}),scope({validFrom:'9999-12-31',validTo:'9999-12-31'})),true);});
test('Each selector independently establishes disjointness',()=>{for(const key of dimensions){assert.equal(postingRuleScopesConflict(scope({[key]:id(20)}),scope({[key]:id(21)})),false,key);assert.equal(postingRuleScopesConflict(scope({[key]:id(20)}),scope({[key]:id(20)})),true,key);}});
test('Different constrained dimensions may still tie; no hierarchy or masking shortcut',()=>{assert.equal(postingRuleScopesConflict(scope({productId:id(30)}),scope({categoryId:id(31)})),true);assert.equal(postingRuleScopesConflict(scope({branchId:id(30)}),scope({warehouseId:id(31)})),true);});
test('Malformed applicability and reversed intervals fail closed',()=>{for(const patch of [{validFrom:'2026-02-30'},{validFrom:'0000-01-01'},{validTo:'2025-12-31'},{priority:0.5},{companyId:'other'},{branchId:'bad'},{active:true},{contractVersion:2}])assert.throws(()=>postingRuleScopesConflict(scope(patch),scope()),ZodError);});
test('Exhaustive three-dimension scopes agree with resolver ambiguity witnesses',()=>{
 const shapes:Array<Record<string,unknown>>=[];
 for(const branchId of [null,id(10),id(11)])for(const warehouseId of [null,id(20),id(21)])for(const productId of [null,id(30),id(31)])shapes.push(scope({branchId,warehouseId,productId}));
 const asRule=(s:Record<string,unknown>,n:number)=>({...s,id:id(100+n),version:n,contractVersion:n,active:true,createdBy:id(90),approvedBy:id(91),approvedAt:'2026-01-01T00:00:00Z',legs:[{legCode:'INVENTORY',side:'DEBIT',amountKey:'stockValue',accountId:id(80)},{legCode:'GRNI',side:'CREDIT',amountKey:'stockValue',accountId:id(81)}]});
 let pairs=0;
 for(const a of shapes)for(const b of shapes){
  const conflict=postingRuleScopesConflict(a,b);assert.equal(conflict,postingRuleScopesConflict(b,a));let witness=false;
  for(const branchId of [id(10),id(11)])for(const warehouseId of [id(20),id(21)])for(const productId of [id(30),id(31)]){
   try{resolvePostingRule({companyId:id(1),eventType:'GOODS_RECEIVED',date:'2026-06-01',branchId,warehouseId,productId},[asRule(a,1),asRule(b,2)]);}catch(e:any){if(e.code==='RULE_AMBIGUOUS')witness=true;else assert.equal(e.code,'RULE_MISSING');}
  }
  assert.equal(conflict,witness,JSON.stringify([a,b]));pairs++;
 }
 assert.equal(pairs,729);
});
