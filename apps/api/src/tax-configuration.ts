import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import Decimal from 'decimal.js';
import {PoolClient} from 'pg';
import {Db,Context,BusinessError,audit} from './db';
import {CommandService} from './commands';
import {calculateTaxLine} from './tax-calculator';
const uuid=z.string().uuid(),reason=z.string().trim().min(5).max(500),basis=z.string().trim().min(5).max(1000);
const date=z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/).refine(s=>{const n=Date.parse(s+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s;},'Invalid Gregorian date');
const factor=z.string().regex(/^(0|[1-9]\d{0,2})(\.\d{1,10})?$/).refine(s=>new Decimal(s).lte('100'));
const fraction=z.string().regex(/^(0(\.\d{1,10})?|1(\.0{1,10})?)$/);
const base={basis,reason},master={code:z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),name:z.string().trim().min(2).max(120)};
const proposal=z.discriminatedUnion('kind',[
 z.object({...base,...master,kind:z.literal('TAX'),taxType:z.enum(['VAT','EXCISE','LEVY','OTHER'])}).strict(),
 z.object({...base,...master,kind:z.literal('CATEGORY'),classification:z.enum(['TAXABLE','ZERO_RATED','EXEMPT','NON_TAXABLE'])}).strict(),
 z.object({...base,kind:z.literal('RATE'),taxId:uuid,categoryId:uuid,validFrom:date,validTo:date,rate:factor,inclusive:z.boolean(),recoverableFraction:fraction,inputAccountId:uuid,outputAccountId:uuid}).strict()
]).refine(v=>v.kind!=='RATE'||v.validTo>=v.validFrom,'End must not precede start');
const paging=z.object({q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
@Injectable()
export class TaxConfigurationService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService){}
 async catalog(ctx:Context,query:unknown){const v=paging.extend({kind:z.enum(['TAX','CATEGORY','RATE'])}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const table={TAX:'taxes',CATEGORY:'tax_categories',RATE:'tax_rates'}[v.kind],args=[ctx.companyId,'%'+v.q+'%'];
  const where=`r.company_id=$1 AND r.publication_request_id IS NOT NULL AND ${v.kind==='RATE'?"(t.code ILIKE $2 OR ca.code ILIKE $2 OR t.name ILIKE $2)":"(r.code ILIKE $2 OR r.name ILIKE $2)"}`;
  const joins=v.kind==='RATE'?' JOIN taxes t ON t.company_id=r.company_id AND t.id=r.tax_id JOIN tax_categories ca ON ca.company_id=r.company_id AND ca.id=r.category_id JOIN accounts ia ON ia.id=r.input_account_id JOIN accounts oa ON oa.id=r.output_account_id':'';
  const extra=v.kind==='RATE'?',r.rate::text AS rate,r.recoverable_fraction::text AS recoverable_fraction,t.code AS tax_code,ca.code AS category_code,ca.classification,ia.code AS input_code,ia.name AS input_name,oa.code AS output_code,oa.name AS output_name':'';
  return {data:(await c.query(`SELECT r.*,u.display_name AS creator,v.display_name AS reviewer,q.basis${extra} FROM ${table} r${joins} JOIN users u ON u.id=r.created_by JOIN users v ON v.id=r.approved_by JOIN tax_change_requests q ON q.id=r.publication_request_id WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4`,[...args,v.limit,(v.page-1)*v.limit])).rows,total:(await c.query(`SELECT count(*)::int n FROM ${table} r${joins} WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async accounts(ctx:Context,query:unknown){const v=paging.extend({direction:z.enum(['INPUT','OUTPUT'])}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,'%'+v.q+'%',v.direction==='INPUT'?'ASSET':'LIABILITY'],where="a.company_id=$1 AND a.active AND a.postable AND a.control_type='TAX' AND a.account_type=$3 AND (a.currency IS NULL OR a.currency=co.base_currency) AND (a.code ILIKE $2 OR a.name ILIKE $2)";
  return {data:(await c.query(`SELECT a.id,a.code,a.name,a.account_type,a.control_type FROM accounts a JOIN companies co ON co.id=a.company_id WHERE ${where} ORDER BY a.code,a.id LIMIT $4 OFFSET $5`,[...args,v.limit,(v.page-1)*v.limit])).rows,total:(await c.query(`SELECT count(*)::int n FROM accounts a JOIN companies co ON co.id=a.company_id WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async changes(ctx:Context,query:unknown){const v=paging.extend({state:z.enum(['PENDING','APPLIED','REJECTED']).optional()}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,'%'+v.q+'%',v.state??null],where="r.company_id=$1 AND (coalesce(r.code,'RATE') ILIKE $2 OR r.reason ILIKE $2) AND ($3::text IS NULL OR r.state=$3)";
  return {data:(await c.query(`SELECT r.*,r.rate::text AS rate,r.recoverable_fraction::text AS recoverable_fraction,u.display_name AS creator,v.display_name AS reviewer,t.code AS tax_code,ca.code AS category_code,ia.code AS input_code,ia.name AS input_name,oa.code AS output_code,oa.name AS output_name FROM tax_change_requests r JOIN users u ON u.id=r.created_by LEFT JOIN users v ON v.id=r.reviewed_by LEFT JOIN taxes t ON t.id=r.tax_id LEFT JOIN tax_categories ca ON ca.id=r.category_id LEFT JOIN accounts ia ON ia.id=r.input_account_id LEFT JOIN accounts oa ON oa.id=r.output_account_id WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT $4 OFFSET $5`,[...args,v.limit,(v.page-1)*v.limit])).rows,total:(await c.query(`SELECT count(*)::int n FROM tax_change_requests r WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async validate(c:PoolClient,id:string){try{await c.query('SELECT assert_tax_request($1)',[id]);}catch(e:any){const errors:Record<string,string>={TAX_DUPLICATE:'This configuration code already exists.',TAX_CLASSIFICATION:'Choose reviewed tax/category records and a factor matching their classification.',TAX_ACCOUNTS:'Select active, postable, functional-currency input ASSET/TAX and output LIABILITY/TAX accounts.',TAX_OVERLAP:'An existing schedule overlaps this tax/category and inclusive period.'};if(e.code==='23514'&&errors[e.message])throw new BusinessError(e.message,errors[e.message]);throw e;}}
 async recordAudit(c:PoolClient,ctx:Context,id:string,action:string,before:any,why:string){const r=(await c.query('SELECT to_jsonb(r) AS after,tax_publication_snapshot(r.id) AS published FROM tax_change_requests r WHERE id=$1',[id])).rows[0];await audit(c,ctx,action,null,{before,after:r.after,published:r.published},why,'TAX_CONFIGURATION',id);}
 async propose(ctx:Context,key:string|undefined,body:unknown){const v=proposal.parse(body);return this.commands.run(ctx,key,'taxes.propose',v,async c=>{
  const r=v.kind==='RATE'?v:null,m=v.kind!=='RATE'?v:null;
  const id=(await c.query(`INSERT INTO tax_change_requests(company_id,kind,code,name,tax_type,classification,tax_id,category_id,valid_from,valid_to,rate,inclusive,recoverable_fraction,input_account_id,output_account_id,basis,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,[ctx.companyId,v.kind,m?.code??null,m?.name??null,v.kind==='TAX'?v.taxType:null,v.kind==='CATEGORY'?v.classification:null,r?.taxId??null,r?.categoryId??null,r?.validFrom??null,r?.validTo??null,r?.rate??null,r?.inclusive??null,r?.recoverableFraction??null,r?.inputAccountId??null,r?.outputAccountId??null,v.basis,v.reason,ctx.userId])).rows[0].id;
  await this.validate(c,id);await this.recordAudit(c,ctx,id,'TAX_CHANGE_PROPOSE',null,v.reason);return {id,state:'PENDING'};
 },true);}
 async decide(ctx:Context,key:string|undefined,id:string,body:unknown){uuid.parse(id);const v=z.object({decision:z.enum(['APPROVE','REJECT']),reason}).strict().parse(body);return this.commands.run(ctx,key,'taxes.decide.'+id,v,async c=>{
  const row=(await c.query('SELECT to_jsonb(r) AS snapshot FROM tax_change_requests r WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];if(!row)throw new BusinessError('NOT_FOUND','Tax request not found.',404);const r=row.snapshot;
  if(r.state!=='PENDING')throw new BusinessError('STATE_CONFLICT','Request already reviewed.',409);if(r.created_by===ctx.userId)throw new BusinessError('INDEPENDENT_REVIEW','Another authorized user must review this request.',403);
  const apply=v.decision==='APPROVE';if(apply)await this.validate(c,id);
  await c.query('UPDATE tax_change_requests SET state=$2,reviewed_by=$3,reviewed_at=now(),review_reason=$4 WHERE id=$1',[id,apply?'APPLIED':'REJECTED',ctx.userId,v.reason]);
  if(apply){const common='id,company_id,created_by,publication_request_id,approved_by,approved_at',values='record_id,company_id,created_by,id,reviewed_by,reviewed_at';
   if(r.kind==='TAX')await c.query(`INSERT INTO taxes(${common},code,name,tax_type) SELECT ${values},code,name,tax_type FROM tax_change_requests WHERE id=$1`,[id]);
   else if(r.kind==='CATEGORY')await c.query(`INSERT INTO tax_categories(${common},code,name,classification) SELECT ${values},code,name,classification FROM tax_change_requests WHERE id=$1`,[id]);
   else await c.query(`INSERT INTO tax_rates(${common},tax_id,category_id,valid_from,valid_to,rate,inclusive,recoverable_fraction,input_account_id,output_account_id) SELECT ${values},tax_id,category_id,valid_from,valid_to,rate,inclusive,recoverable_fraction,input_account_id,output_account_id FROM tax_change_requests WHERE id=$1`,[id]);
  }
  await this.recordAudit(c,ctx,id,'TAX_CHANGE_'+v.decision,r,v.reason);return {id,state:apply?'APPLIED':'REJECTED',recordId:apply?r.record_id:null};
 },true);}
 async preview(ctx:Context,body:unknown){return this.db.transaction(ctx,c=>this.calculateConfigured(c,ctx,body));}
 async calculateConfigured(c:PoolClient,ctx:Context,body:unknown){const v=z.object({categoryId:uuid,taxIds:z.array(uuid).max(10).refine(a=>new Set(a).size===a.length),date,quantity:z.string().max(30),unitPrice:z.string().max(30),discount:z.string().max(30)}).strict().parse(body);
  await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,77))',[ctx.companyId]);
  const category=(await c.query('SELECT classification FROM tax_categories WHERE company_id=$1 AND id=$2 AND publication_request_id IS NOT NULL',[ctx.companyId,v.categoryId])).rows[0];if(!category)throw new BusinessError('TAX_CATEGORY','Choose a reviewed category.');
  const taxable=['TAXABLE','ZERO_RATED'].includes(category.classification);if(taxable!==!!v.taxIds.length)throw new BusinessError('TAX_SELECTION','Taxable/zero-rated previews require explicit tax IDs; exempt/non-taxable previews require none.');
  const rates=(await c.query('SELECT r.*,r.rate::text AS factor,r.recoverable_fraction::text AS fraction FROM tax_rates r JOIN taxes t ON t.company_id=r.company_id AND t.id=r.tax_id WHERE r.company_id=$1 AND r.category_id=$2 AND r.tax_id=ANY($3::uuid[]) AND r.publication_request_id IS NOT NULL AND t.publication_request_id IS NOT NULL AND t.active AND r.valid_from<=$4 AND r.valid_to>=$4 ORDER BY r.tax_id,r.id',[ctx.companyId,v.categoryId,v.taxIds,v.date])).rows;
  if(rates.length!==v.taxIds.length||new Set(rates.map(r=>r.tax_id)).size!==v.taxIds.length)throw new BusinessError('TAX_SCHEDULE_MISSING','Every requested tax needs exactly one reviewed effective schedule.');
  for(const r of rates)await this.validate(c,r.publication_request_id);
  const currency=(await c.query('SELECT base_currency FROM companies WHERE id=$1',[ctx.companyId])).rows[0].base_currency;
  try{return {configurationOnly:true,categoryId:v.categoryId,calculation:calculateTaxLine({quantity:v.quantity,unitPrice:v.unitPrice,discount:v.discount,currency,scale:2,date:v.date,classification:category.classification,rates:rates.map(r=>({taxId:r.tax_id,rateId:r.id,rate:r.factor,validFrom:r.valid_from,validTo:r.valid_to,inclusive:r.inclusive,recoverableFraction:r.fraction,inputAccountId:r.input_account_id,outputAccountId:r.output_account_id}))})};}catch(e){if(e instanceof RangeError)throw new BusinessError('TAX_CALCULATION',e.message);throw e;}
 }
}
