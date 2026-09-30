import {deepFreeze as freeze} from './immutable';
import {z} from 'zod';

// Pure selection only: database authorization, relationship/account validation and
// financial effects remain the responsibility of the enclosing trusted transaction.
const uuid=z.string().uuid();
const date=z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/).refine(s=>{const t=Date.parse(s+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;},'Invalid Gregorian date');
const eventType=z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const selectors=['branchId','warehouseId','productId','categoryId','taxCategoryId','paymentMethodId'] as const;
const optionalSelectors={warehouseId:uuid.nullable().default(null),productId:uuid.nullable().default(null),categoryId:uuid.nullable().default(null),taxCategoryId:uuid.nullable().default(null),paymentMethodId:uuid.nullable().default(null)};
const contextSchema=z.object({companyId:uuid,eventType,date,branchId:uuid,...optionalSelectors}).strict();
const legSchema=z.object({legCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/),side:z.enum(['DEBIT','CREDIT']),amountKey:z.string().regex(/^[a-z][a-zA-Z0-9_]{0,47}$/).refine(s=>!['constructor','prototype','__proto__'].includes(s),'Reserved amount key'),accountId:uuid}).strict();
const scopeSchema=z.object({companyId:uuid,eventType,validFrom:date,validTo:date.nullable(),priority:z.number().int().min(-2147483648).max(2147483647),branchId:uuid.nullable().default(null),...optionalSelectors}).strict();
function checkInterval(v:{validFrom:string;validTo:string|null},ctx:z.RefinementCtx){
 if(v.validTo!==null&&v.validTo<v.validFrom)ctx.addIssue({code:'custom',path:['validTo'],message:'Effective end precedes start'});
}
const applicabilitySchema=scopeSchema.superRefine(checkInterval);
const specificity=(r:z.infer<typeof scopeSchema>)=>selectors.filter(k=>r[k]!==null).length;
// Publication dependency only. Caller supplies prospective/published applicability
// with retirement ends already applied, under the exclusive configuration lock.
export function postingRuleScopesConflict(left:unknown,right:unknown):boolean{
 const a=applicabilitySchema.parse(left),b=applicabilitySchema.parse(right);
 return a.companyId===b.companyId&&a.eventType===b.eventType&&a.priority===b.priority&&specificity(a)===specificity(b)
  &&(a.validTo===null||b.validFrom<=a.validTo)&&(b.validTo===null||a.validFrom<=b.validTo)
  &&selectors.every(k=>a[k]===null||b[k]===null||a[k]===b[k]);
}
const ruleSchema=scopeSchema.extend({id:uuid,version:z.number().int().positive().max(2147483647),contractVersion:z.number().int().positive().max(2147483647).default(1),active:z.boolean(),createdBy:uuid,approvedBy:uuid.nullable(),approvedAt:z.string().datetime({offset:true}).nullable(),legs:z.array(legSchema).min(2).max(100)}).superRefine((v,ctx)=>{
 checkInterval(v,ctx);
 if((v.approvedBy===null)!==(v.approvedAt===null))ctx.addIssue({code:'custom',message:'Reviewer and review time must occur together'});
 if(v.active&&(!v.approvedBy||!v.approvedAt||v.createdBy===v.approvedBy))ctx.addIssue({code:'custom',message:'Active rule requires independent review evidence'});
 if(new Set(v.legs.map(l=>l.legCode)).size!==v.legs.length)ctx.addIssue({code:'custom',path:['legs'],message:'Duplicate symbolic leg'});
});
const candidatesSchema=z.array(ruleSchema).max(10000).superRefine((rows,ctx)=>{
 const identities=new Set<string>(),versions=new Set<string>();
 for(const r of rows){const key=[r.companyId,r.eventType,r.version].join('|');if(identities.has(r.id)||versions.has(key))ctx.addIssue({code:'custom',message:'Duplicate rule identity or company/event version'});identities.add(r.id);versions.add(key);}
});
export class PostingRuleResolutionError extends Error{
 constructor(readonly code:'RULE_MISSING'|'RULE_AMBIGUOUS',message:string){super(message);this.name='PostingRuleResolutionError';}
}
export function resolvePostingRule(input:unknown,candidates:unknown){
 const context=contextSchema.parse(input),rules=candidatesSchema.parse(candidates);
 const matches=rules.filter(r=>r.active&&r.approvedBy&&r.approvedAt&&r.companyId===context.companyId&&r.eventType===context.eventType&&r.validFrom<=context.date&&(r.validTo===null||context.date<=r.validTo)&&selectors.every(k=>r[k]===null||r[k]===context[k])).map(rule=>({rule,specificity:specificity(rule)}));
 matches.sort((a,b)=>b.rule.priority-a.rule.priority||b.specificity-a.specificity);
 if(!matches.length)throw new PostingRuleResolutionError('RULE_MISSING','No independently approved posting rule matches this event and scope.');
 const winner=matches[0],runner=matches[1];
 if(runner&&runner.rule.priority===winner.rule.priority&&runner.specificity===winner.specificity)throw new PostingRuleResolutionError('RULE_AMBIGUOUS','More than one equally ranked posting rule matches. Configuration review is required.');
 // Parse produced detached objects; canonical leg order prevents input-order snapshots.
 winner.rule.legs.sort((a,b)=>a.legCode<b.legCode?-1:a.legCode>b.legCode?1:0);
 return freeze({engine:'SCOPED_POSTING_RULE' as const,engineVersion:1 as const,ranking:'PRIORITY_DESC_THEN_SPECIFICITY_DESC_UNIQUE' as const,context,rule:winner.rule,specificity:winner.specificity});
}
