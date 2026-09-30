import Decimal from 'decimal.js';
import {z} from 'zod';
import {deepFreeze} from './immutable';
// Internal arithmetic only. No route, database mutation, stock authority or journal authorization.
const D=Decimal.clone({precision:64,rounding:Decimal.ROUND_HALF_UP});
const quantity=z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,6})?$/);
const money=z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/);
const balance=z.object({quantity,baseValue:money}).strict();
const common={currency:z.string().regex(/^[A-Z]{3}$/),scale:z.literal(2),quantityScale:z.number().int().min(0).max(6),balance,quantity};
const input=z.discriminatedUnion('operation',[
 z.object({...common,operation:z.literal('RECEIVE'),baseValue:money}).strict(),
 z.object({...common,operation:z.literal('ISSUE')}).strict(),
]);
const maxQuantity=new D('99999999999999.999999'),maxMoney=new D('999999999999999999.99');
function unitCost(value:Decimal,qty:Decimal){
 const cost=qty.isZero()?new D(0):value.div(qty).toDecimalPlaces(6);
 if(cost.gt(maxQuantity))throw new RangeError('Derived unit cost exceeds numeric(20,6) capacity');
 return cost.toFixed(6);
}
export function valueInventoryMovement(body:unknown){
 const v=input.parse(body),beforeQ=new D(v.balance.quantity),beforeV=new D(v.balance.baseValue),q=new D(v.quantity);
 if(q.lte(0))throw new RangeError('A stock movement requires a positive base-unit quantity');
 if(beforeQ.decimalPlaces()>v.quantityScale||q.decimalPlaces()>v.quantityScale)throw new RangeError('Quantity exceeds the governed base-unit precision');
 if(beforeQ.isZero()&&!beforeV.isZero())throw new RangeError('Zero quantity cannot retain stock value');
 unitCost(beforeV,beforeQ); // Reject an unrepresentable starting state rather than silently clipping cost.
 if(v.operation==='ISSUE'&&q.gt(beforeQ))throw new RangeError('Insufficient stock; negative quantities are forbidden');
 const value=v.operation==='RECEIVE'?new D(v.baseValue):q.eq(beforeQ)?beforeV:beforeV.mul(q).div(beforeQ).toDecimalPlaces(2);
 const deltaQ=v.operation==='RECEIVE'?q:q.neg(),deltaV=v.operation==='RECEIVE'?value:value.neg(),afterQ=beforeQ.add(deltaQ),afterV=beforeV.add(deltaV);
 if(afterQ.lt(0)||afterV.lt(0)||afterQ.gt(maxQuantity)||afterV.gt(maxMoney))throw new RangeError('Stock projection exceeds nonnegative quantity/value capacities');
 if(afterQ.isZero()&&!afterV.isZero())throw new RangeError('Depletion cannot leave residual stock value');
 const after={quantity:afterQ.toFixed(6),baseValue:afterV.toFixed(2)},movement={quantity:deltaQ.toFixed(6),baseValue:deltaV.isZero()?'0.00':deltaV.toFixed(2),unitCost:unitCost(value,q)},averageCost=unitCost(afterV,afterQ);
 const normalized={...v,balance:{quantity:beforeQ.toFixed(6),baseValue:beforeV.toFixed(2)},quantity:q.toFixed(6),...(v.operation==='RECEIVE'?{baseValue:value.toFixed(2)}:{})};
 return deepFreeze({balance:after,movement,averageCost,snapshot:{engine:'MOVING_WEIGHTED_AVERAGE',version:1,rounding:'HALF_UP_CURRENCY_2',issueBasis:'EXACT_POOL_VALUE_RATIO_WITH_FINAL_DEPLETION_RESIDUAL',input:normalized,output:{balance:after,movement,averageCost}}});
}
