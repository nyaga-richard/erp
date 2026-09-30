import Decimal from 'decimal.js';
import {z} from 'zod';
import {deepFreeze} from './immutable';
const D=Decimal.clone({precision:64,rounding:Decimal.ROUND_HALF_UP});
const quantity=z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,6})?$/),money=z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/);
const schema=z.object({balance:z.object({quantity,baseValue:money}).strict(),original:z.object({id:z.string().uuid(),quantity:z.string().regex(/^-?(0|[1-9]\d{0,13})(\.\d{1,6})?$/),baseValue:z.string().regex(/^-?(0|[1-9]\d{0,17})(\.\d{1,2})?$/)}).strict(),quantityScale:z.number().int().min(0).max(6)}).strict();
// Internal original-cost arithmetic. Caller must load and lock the authentic original movement.
export function reverseValuedMovement(body:unknown){
 const v=schema.parse(body),beforeQ=new D(v.balance.quantity),beforeV=new D(v.balance.baseValue),q=new D(v.original.quantity),value=new D(v.original.baseValue),afterQ=beforeQ.sub(q),afterV=beforeV.sub(value);
 if(q.isZero()||value.isZero()||q.isNegative()!==value.isNegative()||q.decimalPlaces()>v.quantityScale||beforeQ.decimalPlaces()>v.quantityScale||(beforeQ.isZero()&&!beforeV.isZero()))throw new RangeError('Invalid original movement or base-unit state');
 if(afterQ.lt(0)||afterV.lt(0)||afterQ.gt('99999999999999.999999')||afterV.gt('999999999999999999.99')||(afterQ.isZero()&&!afterV.isZero()))throw new RangeError('Original-cost reversal would create negative/out-of-range stock or orphan value');
 const unitCost=value.div(q).toDecimalPlaces(6),average=afterQ.isZero()?new D(0):afterV.div(afterQ).toDecimalPlaces(6);if(unitCost.gt('99999999999999.999999')||average.gt('99999999999999.999999'))throw new RangeError('Reversal unit cost exceeds domain capacity');
 return deepFreeze({balance:{quantity:afterQ.toFixed(6),baseValue:afterV.toFixed(2)},movement:{quantity:q.neg().toFixed(6),baseValue:value.neg().toFixed(2),unitCost:unitCost.toFixed(6)},originalMovementId:v.original.id});
}
