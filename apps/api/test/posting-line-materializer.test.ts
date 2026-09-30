import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolvePostingRule} from '../src/posting-rule-resolver';
import {materializePostingLines} from '../src/posting-line-materializer';
const id=(n:number)=>'b0000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(){
 const context={companyId:id(1),eventType:'GOODS_RECEIVED',date:'2026-09-29',branchId:id(2)};
 const rule={id:id(3),companyId:id(1),eventType:'GOODS_RECEIVED',version:1,validFrom:'2026-01-01',validTo:null,priority:0,active:true,createdBy:id(4),approvedBy:id(5),approvedAt:'2026-01-01T12:00:00Z',legs:[{legCode:'INVENTORY',side:'DEBIT',amountKey:'stockValue',accountId:id(6)},{legCode:'GRNI',side:'CREDIT',amountKey:'stockValue',accountId:id(7)}]};
 return {selection:resolvePostingRule(context,[rule]),contract:{eventType:'GOODS_RECEIVED',version:1,legs:[{legCode:'INVENTORY',side:'DEBIT',amountKey:'stockValue',eligible:[{accountType:'ASSET',controlType:'INVENTORY'}]},{legCode:'GRNI',side:'CREDIT',amountKey:'stockValue',eligible:[{accountType:'LIABILITY',controlType:'GRNI'}]}]},accounts:[{id:id(6),companyId:id(1),code:'CONFIGURED-STOCK',name:'Inventory',accountType:'ASSET',controlType:'INVENTORY',currency:null,active:true,postable:true},{id:id(7),companyId:id(1),code:'CONFIGURED-GRNI',name:'Receipt clearing',accountType:'LIABILITY',controlType:'GRNI',currency:'KES',active:true,postable:true}],amounts:{stockValue:'123.45'},currency:'KES',functionalCurrency:'KES'};
}

test('Rule materialization uses configured control accounts and the shared journal validator',()=>{
 const r=materializePostingLines(fixture());assert.deepEqual(r.totals,{debit:'123.45',credit:'123.45'});assert.equal(r.noFinancialEffect,false);assert.equal(r.lines.find(l=>l.legCode==='INVENTORY')!.accountId,id(6));assert.equal(r.lines.find(l=>l.legCode==='GRNI')!.credit,'123.45');assert.equal(r.snapshot.selection.rule.createdBy,id(4));
});
test('Mapping version and registered contract version are separate identities',()=>{
 const f=fixture(),r=JSON.parse(JSON.stringify(f.selection.rule));r.version=17;
 const result=materializePostingLines({...f,selection:resolvePostingRule(f.selection.context,[r])});assert.equal(result.snapshot.selection.rule.version,17);assert.equal(result.snapshot.contract.version,1);assert.equal(result.totals.debit,'123.45');
});
test('Rule materialization preserves maximum per-line cents exactly',()=>{
 const v=fixture();v.amounts.stockValue='9999999999999999.99';const r=materializePostingLines(v);assert.equal(r.totals.debit,v.amounts.stockValue);assert.equal(r.totals.credit,v.amounts.stockValue);
});
test('Rule materialization rejects floats, signs, overprecision, exponents and unsupported FX',()=>{
 for(const value of [0.1,'-1.00','1.001','1e3','10000000000000000.00',NaN,Infinity])assert.throws(()=>materializePostingLines({...fixture(),amounts:{stockValue:value}}));
 assert.throws(()=>materializePostingLines({...fixture(),currency:'USD'}));
});
test('Rule materialization rejects missing, duplicate, cross-company or ineligible accounts',()=>{
 assert.throws(()=>materializePostingLines({...fixture(),accounts:[]}));const duplicated=fixture();duplicated.accounts.push({...duplicated.accounts[0]});assert.throws(()=>materializePostingLines(duplicated));
 for(const change of [{companyId:id(99)},{active:false},{postable:false},{currency:'USD'},{controlType:null},{accountType:'EXPENSE'}]){const v=fixture();Object.assign(v.accounts[0],change);assert.throws(()=>materializePostingLines(v));}
});
test('Rule materialization requires exact contract event, version, legs and semantics',()=>{
 const v=fixture();assert.throws(()=>materializePostingLines({...v,contract:{...v.contract,eventType:'OTHER_EVENT'}}));assert.throws(()=>materializePostingLines({...v,contract:{...v.contract,version:2}}));
 for(const change of [{side:'CREDIT'},{amountKey:'untrustedTotal'},{legCode:'OTHER_LEG'}]){const f=fixture();Object.assign(f.contract.legs[0],change);assert.throws(()=>materializePostingLines(f));}
 const duplicate=fixture();duplicate.contract.legs.push({...duplicate.contract.legs[0]});assert.throws(()=>materializePostingLines(duplicate));
});
test('Rule materialization rejects missing and unexpected amount keys',()=>{
 assert.throws(()=>materializePostingLines({...fixture(),amounts:{}}));assert.throws(()=>materializePostingLines({...fixture(),amounts:{stockValue:'1.00',extra:'10.00'}}));
});
test('Rule materialization cannot produce an unbalanced journal',()=>{
 const f=fixture(),r=structuredClone(f.selection.rule);r.legs.find(l=>l.legCode==='GRNI')!.amountKey='clearingValue';f.contract.legs.find(l=>l.legCode==='GRNI')!.amountKey='clearingValue';
 assert.throws(()=>materializePostingLines({...f,selection:resolvePostingRule(f.selection.context,[r]),amounts:{stockValue:'10.00',clearingValue:'9.99'}}),(e:any)=>e.code==='UNBALANCED');
});
test('Rule materialization marks zero financial effect explicitly without zero-sided lines',()=>{
 const r=materializePostingLines({...fixture(),amounts:{stockValue:'0'}});assert.deepEqual(r.lines,[]);assert.deepEqual(r.totals,{debit:'0.00',credit:'0.00'});assert.equal(r.noFinancialEffect,true);assert.equal(r.snapshot.amounts.stockValue,'0.00');
});
test('Rule materialization snapshots are canonical, immutable and detached',()=>{
 const f=fixture(),r=materializePostingLines(f);f.accounts[0].name='Changed later';f.amounts.stockValue='500.00';assert.equal(r.snapshot.accounts.find(a=>a.id===id(6))!.name,'Inventory');assert.equal(r.snapshot.amounts.stockValue,'123.45');assert.equal(Reflect.set(r.lines[0],'debit','999.00'),false);
 const reversed=fixture();reversed.accounts.reverse();reversed.contract.legs.reverse();assert.deepEqual(materializePostingLines(reversed),r);
});
