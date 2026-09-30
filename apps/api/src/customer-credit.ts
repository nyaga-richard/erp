import Decimal from 'decimal.js';
import {z} from 'zod';
import {deepFreeze} from './immutable';
// Internal arithmetic only: not an endpoint, approval, reservation or posting
// authority. A future transactional caller must lock the company/customer,
// derive current debt/commitments and validate replacement source ownership.
const D=Decimal.clone({precision:64,rounding:Decimal.ROUND_HALF_UP});
const money=z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/),limit=z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/);
const schema=z.object({currency:z.string().regex(/^[A-Z]{3}$/),scale:z.literal(2),customerId:z.string().uuid(),policyVersion:z.number().int().min(1).max(2147483647),customerType:z.enum(['REGISTERED','WALK_IN']),active:z.boolean(),creditHold:z.boolean(),creditLimit:limit,postedOutstanding:money,activeCommitments:money,replacedCommitment:money,requestedCredit:money}).strict();
const capacity=new D('999999999999999999.99');
export function evaluateCustomerCredit(body:unknown){
 const v=schema.parse(body),creditLimit=new D(v.creditLimit),debt=new D(v.postedOutstanding),commitments=new D(v.activeCommitments),replacement=new D(v.replacedCommitment),request=new D(v.requestedCredit);
 if(request.lte(0))throw new RangeError('Credit eligibility requires a positive requested credit portion; cash-only sources do not use this gate.');
 if(replacement.gt(commitments))throw new RangeError('Replacement exceeds authoritative active commitments.');
 const before=debt.plus(commitments).minus(replacement),after=before.plus(request);
 if(before.gt(capacity)||after.gt(capacity))throw new RangeError('Credit exposure exceeds numeric(20,2) capacity; fail closed.');
 const available=D.max(0,creditLimit.minus(before)),excess=D.max(0,after.minus(creditLimit)),reasons:string[]=[];
 if(!v.active)reasons.push('CUSTOMER_INACTIVE');
 if(v.customerType==='WALK_IN')reasons.push('WALK_IN_CREDIT_FORBIDDEN');
 if(v.creditHold)reasons.push('CREDIT_HOLD');
 if(after.gt(creditLimit))reasons.push('LIMIT_EXCEEDED');
 const normalized={...v,creditLimit:creditLimit.toFixed(2),postedOutstanding:debt.toFixed(2),activeCommitments:commitments.toFixed(2),replacedCommitment:replacement.toFixed(2),requestedCredit:request.toFixed(2)};
 const output={allowed:reasons.length===0,reasons,beforeExposure:before.toFixed(2),afterExposure:after.toFixed(2),availableCredit:available.toFixed(2),excess:excess.toFixed(2)};
 return deepFreeze({...output,snapshot:{engine:'CUSTOMER_CREDIT_ELIGIBILITY',version:1,scope:'ARITHMETIC_ONLY_NOT_POSTING_AUTHORITY',input:normalized,output}});
}
const businessDate=z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/).refine(v=>{const parsed=new Date(v+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===v;});
export function customerDueDate(date:unknown,termsDays:unknown){
 const start=businessDate.parse(date),days=z.number().int().min(0).max(3650).parse(termsDays),result=new Date(start+'T00:00:00Z');
 result.setUTCDate(result.getUTCDate()+days);if(result.getUTCFullYear()>9999)throw new RangeError('Due date exceeds the supported business-date calendar.');
 return businessDate.parse(result.toISOString().slice(0,10));
}
