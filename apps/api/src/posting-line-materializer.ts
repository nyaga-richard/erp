import {z} from 'zod';
import {journalDraft,validateLines} from './accounting';
import {resolvePostingRule} from './posting-rule-resolver';
import {deepFreeze} from './immutable';

// Internal only. The caller must fetch published rules/contracts and current
// accounts, and compute trusted totals, inside the same authorized transaction.
const uuid=z.string().uuid(),version=z.number().int().positive().max(2147483647);
const accountType=z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']);
const controlType=z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).nullable();
const amountKey=z.string().regex(/^[a-z][a-zA-Z0-9_]{0,47}$/).refine(v=>!['constructor','prototype','__proto__'].includes(v));
const legCode=z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/);
const account=z.object({id:uuid,companyId:uuid,code:z.string().min(1).max(24),name:z.string().min(1).max(120),accountType,controlType,currency:journalDraft.shape.currency.nullable(),active:z.boolean(),postable:z.boolean()}).strict();
const contractLeg=z.object({legCode,side:z.enum(['DEBIT','CREDIT']),amountKey,eligible:z.array(z.object({accountType,controlType}).strict()).min(1).max(20)}).strict();
const contract=z.object({eventType:z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),version,legs:z.array(contractLeg).min(2).max(100)}).strict();
const selectionSchema=z.object({engine:z.literal('SCOPED_POSTING_RULE'),engineVersion:z.literal(1),ranking:z.literal('PRIORITY_DESC_THEN_SPECIFICITY_DESC_UNIQUE'),context:z.unknown(),rule:z.unknown(),specificity:z.number().int().nonnegative()}).strict();
const input=z.object({selection:selectionSchema,contract,accounts:z.array(account).min(1).max(100),amounts:z.record(journalDraft.shape.lines.element.shape.debit),currency:journalDraft.shape.currency,functionalCurrency:journalDraft.shape.currency}).strict();
const canonical=(value:string)=>{const [whole,fraction='']=value.split('.');return whole+'.'+fraction.padEnd(2,'0');};
export function materializePostingLines(body:unknown){
 const v=input.parse(body),selection=resolvePostingRule(v.selection.context,[v.selection.rule]);
 if(selection.specificity!==v.selection.specificity)throw new RangeError('Invalid selection specificity');
 if(v.currency!==v.functionalCurrency)throw new RangeError('Foreign-currency rule materialization is not enabled');
 if(v.contract.eventType!==selection.rule.eventType||v.contract.version!==selection.rule.contractVersion)throw new RangeError('Rule and event contract do not match');
 const contracts=new Map(v.contract.legs.map(l=>[l.legCode,l])),accounts=new Map(v.accounts.map(a=>[a.id,a]));
 if(contracts.size!==v.contract.legs.length||accounts.size!==v.accounts.length)throw new RangeError('Duplicate contract leg or account identity');
 if(contracts.size!==selection.rule.legs.length)throw new RangeError('Rule must map the complete contract leg set');
 const expectedAmounts=[...new Set(v.contract.legs.map(l=>l.amountKey))].sort(),suppliedAmounts=Object.keys(v.amounts).sort();
 if(JSON.stringify(expectedAmounts)!==JSON.stringify(suppliedAmounts))throw new RangeError('Missing or unexpected trusted amount keys');
 const requiredAccounts=new Set(selection.rule.legs.map(l=>l.accountId));
 if(accounts.size!==requiredAccounts.size||[...accounts.keys()].some(id=>!requiredAccounts.has(id)))throw new RangeError('Account records must exactly match the selected mapping');
 const amounts=Object.fromEntries(expectedAmounts.map(k=>[k,canonical(v.amounts[k])])),lines:Array<{legCode:string;accountId:string;debit:string;credit:string;description:string}>=[];
 for(const leg of selection.rule.legs){
  const c=contracts.get(leg.legCode),a=accounts.get(leg.accountId);
  if(!c||c.side!==leg.side||c.amountKey!==leg.amountKey)throw new RangeError('Mapped leg semantics differ from the registered contract');
  if(!a||a.companyId!==selection.context.companyId||!a.active||!a.postable||(a.currency!==null&&a.currency!==v.currency))throw new RangeError('Account is unavailable, foreign-scoped, non-postable or wrongly denominated');
  if(!c.eligible.some(e=>e.accountType===a.accountType&&e.controlType===a.controlType))throw new RangeError('Account classification is not eligible for this symbolic leg');
  const value=amounts[leg.amountKey];if(value==='0.00')continue;
  lines.push({legCode:leg.legCode,accountId:leg.accountId,debit:leg.side==='DEBIT'?value:'0.00',credit:leg.side==='CREDIT'?value:'0.00',description:leg.legCode.replaceAll('_',' ')});
 }
 const totals=validateLines(lines),noFinancialEffect=lines.length===0;
 const sortedContract={...v.contract,legs:v.contract.legs.map(l=>({...l,eligible:l.eligible.sort((a,b)=>[a.accountType,a.controlType??''].join(':')<[b.accountType,b.controlType??''].join(':')?-1:[a.accountType,a.controlType??''].join(':')>[b.accountType,b.controlType??''].join(':')?1:0)})).sort((a,b)=>a.legCode<b.legCode?-1:a.legCode>b.legCode?1:0)};
 const snapshot={engine:'TRUSTED_RULE_LINES' as const,engineVersion:1 as const,selection,contract:sortedContract,accounts:v.accounts.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),amounts,currency:v.currency,functionalCurrency:v.functionalCurrency,totals,noFinancialEffect,lines};
 return deepFreeze({lines,totals,noFinancialEffect,snapshot});
}
