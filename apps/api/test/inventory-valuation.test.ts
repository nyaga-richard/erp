import {reverseValuedMovement} from '../src/inventory-reversal';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import {valueInventoryMovement} from '../src/inventory-valuation';
const D=Decimal.clone({precision:64,rounding:Decimal.ROUND_HALF_UP});
const base={currency:'KES',scale:2,quantityScale:0,balance:{quantity:'0',baseValue:'0'}};
const receive=(quantity:string,baseValue:string,balance=base.balance,quantityScale=0)=>valueInventoryMovement({...base,operation:'RECEIVE',quantity,baseValue,balance,quantityScale});
const issue=(quantity:string,balance:{quantity:string;baseValue:string},quantityScale=0)=>valueInventoryMovement({...base,operation:'ISSUE',quantity,balance,quantityScale});
test('Inventory: receipts use trusted value and issues use the full moving weighted average',()=>{
 const a=receive('10','100'),b=receive('10','200',a.balance),c=issue('5',b.balance);assert.deepEqual(b.balance,{quantity:'20.000000',baseValue:'300.00'});assert.equal(b.averageCost,'15.000000');assert.deepEqual(c.movement,{quantity:'-5.000000',baseValue:'-75.00',unitCost:'15.000000'});assert.deepEqual(c.balance,{quantity:'15.000000',baseValue:'225.00'});
});
test('Inventory: rounding residual is retained in stock and final depletion consumes it',()=>{
 let b=receive('3','0.01').balance;const costs=[];for(let i=0;i<3;i++){const r=issue('1',b);costs.push(r.movement.baseValue);b=r.balance;}assert.deepEqual(costs,['0.00','-0.01','0.00']);assert.deepEqual(b,{quantity:'0.000000',baseValue:'0.00'});
 const last=issue('7',receive('7','23.99').balance);assert.equal(last.movement.baseValue,'-23.99');assert.equal(last.balance.baseValue,'0.00');
});
test('Inventory: never multiply a six-place rounded average to get issue value',()=>{
 const r=issue('1000000',{quantity:'3000000',baseValue:'1.00'});assert.equal(r.movement.baseValue,'-0.33');assert.equal(r.balance.baseValue,'0.67');assert.equal(r.averageCost,'0.000000');
});
test('Inventory: fractional units and configured precision are enforced on state and movement',()=>{
 const b=receive('1.250','12.50',base.balance,3).balance,r=issue('0.125',b,3);assert.equal(r.movement.baseValue,'-1.25');assert.equal(r.balance.quantity,'1.125000');assert.throws(()=>issue('0.125',b,2));assert.throws(()=>issue('1',{quantity:'1.5',baseValue:'10'},0));assert.equal(receive('1.000000','0').balance.quantity,'1.000000');
});
test('Inventory: large cents remain exact without a JavaScript Number roundtrip',()=>{
 const r=issue('1',{quantity:'10',baseValue:'90071992547409.99'});assert.equal(r.movement.baseValue,'-9007199254741.00');assert.equal(r.balance.baseValue,'81064793292668.99');assert.equal(r.movement.unitCost,'9007199254741.000000');
});
test('Inventory: zero-valued stock is mathematical, not a zero-journal authorization',()=>{
 const r=receive('3','0');assert.equal(r.averageCost,'0.000000');assert.equal(issue('3',r.balance).balance.baseValue,'0.00');assert.throws(()=>issue('1',base.balance));assert.throws(()=>receive('1','1',{quantity:'0',baseValue:'0.01'}));
});
test('Inventory: negative stock, zero movement and invalid money are refused',()=>{
 assert.throws(()=>issue('2',{quantity:'1',baseValue:'1'}));for(const q of ['0','-1','1e2','.1','01','1.0000001'])assert.throws(()=>receive(q,'1'));for(const v of ['-1','1.001','1e2','','01'])assert.throws(()=>receive('1',v));assert.throws(()=>receive('1','1',{quantity:'-1',baseValue:'1'}));
});
test('Inventory: quantities, values and unit costs must fit domain capacities',()=>{
 assert.throws(()=>receive('0.000001','0',{quantity:'99999999999999.999999',baseValue:'0'},6));assert.throws(()=>receive('1','0.01',{quantity:'1000000',baseValue:'999999999999999999.99'}));assert.throws(()=>receive('1','100000000000000.00'));const r=receive('99999999999999.999999','999999999999999999.99',base.balance,6);assert.equal(r.balance.baseValue,'999999999999999999.99');assert.equal(r.balance.quantity,'99999999999999.999999');
});
test('Inventory: strict trusted-input boundary rejects extra fields and unsupported policies',()=>{
 const v={...base,operation:'RECEIVE',quantity:'1',baseValue:'1'};for(const patch of [{quantity:1},{baseValue:1},{actorId:'x'},{balance:{quantity:'0',baseValue:'0',averageCost:'1'}},{currency:'kes'},{scale:3},{quantityScale:7},{operation:'RETURN'}])assert.throws(()=>valueInventoryMovement({...v,...patch}));assert.throws(()=>valueInventoryMovement({...v,operation:'ISSUE'}));
});
test('Inventory: snapshot is detached, deeply immutable and exactly replayable',()=>{
 const input={...base,balance:{...base.balance},operation:'RECEIVE',quantity:'2',baseValue:'10'};const r=valueInventoryMovement(input);input.balance.quantity='9';assert.equal(r.snapshot.input.balance.quantity,'0.000000');assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.snapshot.input.balance)&&Object.isFrozen(r.balance));assert.equal(Reflect.set(r.balance,'baseValue','999'),false);assert.equal(r.balance.baseValue,'10.00');const replay=valueInventoryMovement(JSON.parse(JSON.stringify(r.snapshot.input)));assert.deepEqual(replay,r);assert.equal(r.snapshot.version,1);
});
test('Inventory: local rounding policy does not mutate global Decimal configuration',()=>{
 const precision=Decimal.precision,rounding=Decimal.rounding;receive('3','0.01');assert.equal(Decimal.precision,precision);assert.equal(Decimal.rounding,rounding);
});
test('Inventory: depletion matrix conserves every quantity and cent across 3000 states',()=>{
 for(let q=1;q<=30;q++)for(let cents=0;cents<100;cents++){
  const initial=new D(cents).div(100);let b=receive(String(q),initial.toFixed(2)).balance,total=new D(0);for(let i=0;i<q;i++){const r=issue('1',b);assert.equal(new D(r.balance.quantity).add(1).eq(b.quantity),true);assert.equal(new D(r.balance.baseValue).sub(r.movement.baseValue).eq(b.baseValue),true);assert.ok(new D(r.balance.baseValue).gte(0));total=total.sub(r.movement.baseValue);b=r.balance;}assert.equal(total.eq(initial),true);assert.equal(b.quantity,'0.000000');assert.equal(b.baseValue,'0.00');
 }
});

test('Inventory: original-cost reversal never revalues the original loss at current average',()=>{
 const original={id:'90000000-0000-4000-8000-000000000001',quantity:'-5',baseValue:'-75.00'},r=reverseValuedMovement({balance:{quantity:'2',baseValue:'10'},original,quantityScale:0});assert.deepEqual(r.balance,{quantity:'7.000000',baseValue:'85.00'});assert.equal(r.movement.baseValue,'75.00');assert.ok(Object.isFrozen(r.balance));assert.throws(()=>reverseValuedMovement({balance:{quantity:'1',baseValue:'10'},original:{...original,quantity:'5',baseValue:'75'},quantityScale:0}));assert.throws(()=>reverseValuedMovement({balance:{quantity:'5',baseValue:'80'},original:{...original,quantity:'5',baseValue:'75'},quantityScale:0}));
});
