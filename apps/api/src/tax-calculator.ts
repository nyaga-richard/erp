import {deepFreeze as freeze} from './immutable';
import Decimal from 'decimal.js';
import {z} from 'zod';
// Local Decimal constructor: tax policy must not change journal rounding globally.
const D=Decimal.clone({precision:64,rounding:Decimal.ROUND_HALF_UP});
const decimal=z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,6})?$/,'Use a nonnegative decimal string, at most six fractional places');
const rateDecimal=z.string().regex(/^(0|[1-9]\d{0,2})(\.\d{1,10})?$/).refine(v=>new D(v).lte(100),'Rate outside supported calculation range');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const n=Date.parse(v+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v;},'Invalid business date');
const rateSchema=z.object({taxId:z.string().uuid(),rateId:z.string().uuid(),rate:rateDecimal,validFrom:date,validTo:date,inclusive:z.boolean(),recoverableFraction:rateDecimal.refine(v=>new D(v).lte(1)),inputAccountId:z.string().uuid().nullable().default(null),outputAccountId:z.string().uuid().nullable().default(null)}).strict();
const inputSchema=z.object({quantity:decimal.refine(v=>new D(v).gt(0)),unitPrice:decimal,discount:decimal.refine(v=>new D(v).decimalPlaces()<=2,'Discount must use currency precision'),currency:z.string().regex(/^[A-Z]{3}$/),scale:z.literal(2),date,classification:z.enum(['TAXABLE','ZERO_RATED','EXEMPT','NON_TAXABLE']),rates:z.array(rateSchema).max(10)}).strict();
export type TaxLineInput=z.input<typeof inputSchema>;
export function calculateTaxLine(body:unknown){
 const v=inputSchema.parse(body),taxes=new Set<string>(),ids=new Set<string>();
 const rates=[...v.rates].sort((a,b)=>a.taxId.localeCompare(b.taxId)||a.rateId.localeCompare(b.rateId));
 for(const r of rates){if(taxes.has(r.taxId)||ids.has(r.rateId))throw new RangeError('A tax/rate may occur only once per line');taxes.add(r.taxId);ids.add(r.rateId);if(r.validFrom>r.validTo||v.date<r.validFrom||v.date>r.validTo)throw new RangeError('Rate is not effective on this business date');}
 if(rates.some(r=>r.inclusive!==rates[0].inclusive))throw new RangeError('Mixed inclusive/exclusive same-base taxes are not supported');
 if(v.classification==='TAXABLE'&&(!rates.length||!rates.some(r=>new D(r.rate).gt(0))))throw new RangeError('Taxable classification requires an effective positive rate');
 if(v.classification==='ZERO_RATED'&&(!rates.length||rates.some(r=>!new D(r.rate).eq(0))))throw new RangeError('Zero-rated classification requires explicit zero-rate snapshots');
 if(['EXEMPT','NON_TAXABLE'].includes(v.classification)&&rates.length)throw new RangeError('Exempt/non-taxable classification cannot apply tax rates');
 const extension=new D(v.quantity).mul(v.unitPrice).toDecimalPlaces(2),discount=new D(v.discount);if(discount.gt(extension))throw new RangeError('Discount exceeds rounded line extension');
 const discounted=extension.sub(discount),inclusive=rates[0]?.inclusive??false,totalRate=rates.reduce((sum,r)=>sum.add(r.rate),new D(0));
 const rawNet=inclusive?discounted.div(totalRate.add(1)):discounted,net=rawNet.toDecimalPlaces(2);
 const work=rates.map(r=>{const raw=rawNet.mul(r.rate);return {r,raw,tax:inclusive?raw.toDecimalPlaces(2,Decimal.ROUND_DOWN):raw.toDecimalPlaces(2)};});
 if(inclusive){const target=discounted.sub(net),allocated=work.reduce((sum,r)=>sum.add(r.tax),new D(0)),remaining=target.sub(allocated).mul(100);if(!remaining.isInteger()||remaining.lt(0)||remaining.gt(work.length))throw new RangeError('Tax residual outside allocation bound');const order=work.map((c,i)=>({i,remainder:c.raw.sub(c.tax)})).sort((a,b)=>b.remainder.comparedTo(a.remainder)||a.i-b.i);for(let i=0;i<remaining.toNumber();i++)work[order[i].i].tax=work[order[i].i].tax.add('0.01');}
 const tax=work.reduce((sum,r)=>sum.add(r.tax),new D(0)),gross=net.add(tax),limit=new D('999999999999999999.99');
 if(net.gt(limit)||tax.gt(limit)||gross.gt(limit))throw new RangeError('Tax result exceeds current numeric(20,2) ledger capacity');
 if(inclusive&&!gross.eq(discounted))throw new RangeError('Inclusive tax invariant failed');
 const components=work.map(c=>{const recoverable=c.tax.mul(c.r.recoverableFraction).toDecimalPlaces(2);return {taxId:c.r.taxId,rateId:c.r.rateId,tax:c.tax.toFixed(2),recoverable:recoverable.toFixed(2),nonrecoverable:c.tax.sub(recoverable).toFixed(2)};});
 const normalized={...v,quantity:new D(v.quantity).toFixed(6),unitPrice:new D(v.unitPrice).toFixed(6),discount:discount.toFixed(2),rates:rates.map(r=>({...r,rate:new D(r.rate).toFixed(),recoverableFraction:new D(r.recoverableFraction).toFixed()}))};
 const totals={net:net.toFixed(2),tax:tax.toFixed(2),gross:gross.toFixed(2)};
 return freeze({...totals,components,snapshot:{engine:'SAME_BASE_TAX',version:1,rounding:'HALF_UP_CURRENCY_2',inclusiveAllocation:'LARGEST_REMAINDER_TAX_ID',priceMode:inclusive?'INCLUSIVE':'EXCLUSIVE',input:normalized,totals,components}});
}
