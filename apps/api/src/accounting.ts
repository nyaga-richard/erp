import {Inject,Injectable} from '@nestjs/common';
import Decimal from 'decimal.js';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Db,Context,BusinessError,audit,event} from './db';
import {CommandService} from './commands';
import {WorkflowService} from './workflow';
import {allocateDocumentNumber} from './numbering';
Decimal.set({precision:40,rounding:Decimal.ROUND_HALF_UP});
const amount=z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/,'Use a nonnegative decimal string with at most 2 decimal places');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s,'Invalid date');
const line=z.object({accountId:z.string().uuid(),debit:amount,credit:amount,description:z.string().max(250).default('')}).strict();
export const journalDraft=z.object({branchId:z.string().uuid(),date,currency:z.enum(['KES','USD','EUR']),description:z.string().trim().min(5).max(500),lines:z.array(line).min(2).max(100)}).strict();
export const reversalDraft=z.object({date,reason:z.string().trim().min(5).max(500)}).strict();
export function validateLines(lines:z.infer<typeof line>[]){
 let dr=new Decimal(0),cr=new Decimal(0);
 for(const l of lines){const d=new Decimal(l.debit),c=new Decimal(l.credit);if(!((d.gt(0)&&c.eq(0))||(c.gt(0)&&d.eq(0))))throw new BusinessError('ONE_SIDED_LINE','Every line must have exactly one positive debit or credit.');dr=dr.add(d);cr=cr.add(c);}
 if(!dr.eq(cr))throw new BusinessError('UNBALANCED','Total debits must equal total credits exactly.');
 return {debit:dr.toFixed(2),credit:cr.toFixed(2)};
}
@Injectable()
export class AccountingService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService,@Inject(WorkflowService) private workflow:WorkflowService){}
 async command<T>(ctx:Context,key:string|undefined,cmd:string,body:unknown,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  return this.commands.run(ctx,key,cmd,body,fn);
 }
 scope(ctx:Context,branch:string){if(!ctx.branches.includes(branch))throw new BusinessError('BRANCH_SCOPE','Branch is outside your assigned scope.',403);}
 async accountsCheck(c:PoolClient,ctx:Context,lines:z.infer<typeof line>[],currency:string){
  const ids=[...new Set(lines.map(l=>l.accountId))];const a=await c.query('SELECT * FROM accounts WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[ctx.companyId,ids]);
  if(a.rows.length!==ids.length || a.rows.some(a=>!a.active||!a.postable||a.control_type||(a.currency&&a.currency!==currency)))throw new BusinessError('ACCOUNT_POLICY','Use active, postable, same-company non-control accounts in the correct currency.');
 }
 async create(ctx:Context,key:string|undefined,body:unknown){
  const v=journalDraft.parse(body);validateLines(v.lines);this.scope(ctx,v.branchId);
  return this.command(ctx,key,'journal.create',v,async c=>{this.scope(ctx,v.branchId);return this.insertDraft(c,ctx,v,'MANUAL_JOURNAL');});
 }
 async insertDraft(c:PoolClient,ctx:Context,v:z.infer<typeof journalDraft>,type:string,original?:string,reason?:string){
  const co=await c.query('SELECT base_currency FROM companies WHERE id=$1',[ctx.companyId]);
  if(co.rows[0].base_currency!==v.currency)throw new BusinessError('FX_DISABLED','Foreign-currency posting is not enabled in this foundation.');
  const b=await c.query('SELECT 1 FROM branches WHERE company_id=$1 AND id=$2 AND active',[ctx.companyId,v.branchId]);if(!b.rowCount)throw new BusinessError('BRANCH','Branch is unavailable.');
  await this.accountsCheck(c,ctx,v.lines,v.currency);
  const number=await allocateDocumentNumber(c,ctx,v.branchId,type,v.date);
  const r=await c.query(`INSERT INTO source_documents(company_id,branch_id,document_type,document_number,business_date,currency,description,payload,created_by,original_document_id,reversal_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,document_number,status`,[ctx.companyId,v.branchId,type,number,v.date,v.currency,v.description,JSON.stringify({lines:v.lines}),ctx.userId,original??null,reason??null]);
  const doc=r.rows[0];await event(c,ctx,doc.id,'CREATE',null,'DRAFT',1);await audit(c,ctx,'CREATE',doc.id,{documentNumber:number,type},reason);
  return doc;
 }
 async lockedSource(c:PoolClient,ctx:Context,id:string){
  z.string().uuid().parse(id);const r=await c.query('SELECT * FROM source_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id]);
  if(!r.rowCount)throw new BusinessError('NOT_FOUND','Document not found.',404);const s=r.rows[0];this.scope(ctx,s.branch_id);
  if(!['MANUAL_JOURNAL','JOURNAL_REVERSAL'].includes(s.document_type))throw new BusinessError('UNSUPPORTED','This domain is not released.');return s;
 }
 async transition(ctx:Context,key:string|undefined,id:string,action:'SUBMIT'|'APPROVE'|'POST'){
  return this.command(ctx,key,`document.${action}.${id}`,{},async c=>{
   const s=await this.lockedSource(c,ctx,id);const required={SUBMIT:'DRAFT',APPROVE:'PENDING_APPROVAL',POST:'APPROVED'}[action];
   if(s.status!==required)throw new BusinessError('STATE_CONFLICT',`Expected ${required}; document is ${s.status}.`,409);
   if(action==='SUBMIT'&&s.created_by!==ctx.userId)throw new BusinessError('CREATOR_ONLY','Only the original creator may submit this draft.',403);
   let snapshot=s.approval_snapshot,complete=true;
   if(action==='SUBMIT')snapshot=await this.workflow.snapshot(c,ctx,s,validateLines(s.payload.lines).debit);
   if(action==='APPROVE')complete=await this.workflow.decide(c,ctx,s,'APPROVE','Approved after review');
   if(action==='POST')await this.workflow.checkPoster(c,ctx,s);
   let journalId:string|null=null;
   if(action==='POST')journalId=await this.post(c,ctx,s);
   const next=action==='APPROVE'&&!complete?'PENDING_APPROVAL':{SUBMIT:'PENDING_APPROVAL',APPROVE:'APPROVED',POST:'POSTED'}[action];
   await c.query(`UPDATE source_documents SET approval_snapshot=$5,status=$3,updated_by=$4,updated_at=now(),approved_by=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by END,approved_at=CASE WHEN $3='APPROVED' THEN now() ELSE approved_at END,posted_by=CASE WHEN $3='POSTED' THEN $4 ELSE posted_by END,posted_at=CASE WHEN $3='POSTED' THEN now() ELSE posted_at END WHERE company_id=$1 AND id=$2`,[ctx.companyId,id,next,ctx.userId,snapshot?JSON.stringify(snapshot):null]);
   await event(c,ctx,id,action,s.status,next,s.revision);await audit(c,ctx,action,id,{from:s.status,to:next,journalId});
   return {id,document_number:s.document_number,status:next,journalId};
  });
 }
 async post(c:PoolClient,ctx:Context,s:any){
  const lines=z.array(line).min(2).max(100).parse(s.payload.lines);validateLines(lines);await this.accountsCheck(c,ctx,lines,s.currency);
  let reversalOf:string|null=null;
  if(s.original_document_id){
   const old=await c.query('SELECT id FROM journal_entries WHERE company_id=$1 AND source_id=$2 AND status=\'POSTED\' FOR SHARE',[ctx.companyId,s.original_document_id]);
   if(!old.rowCount)throw new BusinessError('ORIGINAL_NOT_POSTED','Original journal is unavailable.');reversalOf=old.rows[0].id;
  }
  return this.postPrepared(c,ctx,s,lines,{type:s.document_type,version:1,manualControlAccountsBlocked:true},reversalOf);
 }
 // Internal only: operational callers must establish guarded domain authority before using controlled accounts.
 async postPrepared(c:PoolClient,ctx:Context,s:any,lines:z.infer<typeof line>[],snapshot:unknown,reversalOf:string|null=null){
  validateLines(lines);
  const p=await c.query(`SELECT * FROM financial_periods WHERE company_id=$1 AND $2::date BETWEEN starts_on AND ends_on FOR SHARE`,[ctx.companyId,s.business_date]);
  if(p.rows[0]?.status!=='OPEN')throw new BusinessError('PERIOD_CLOSED','The accounting date must fall in an open financial period.');
  const number=await allocateDocumentNumber(c,ctx,s.branch_id,'JOURNAL',s.business_date);
  const j=await c.query(`INSERT INTO journal_entries(company_id,branch_id,source_id,number,accounting_date,period_id,currency,base_currency,exchange_rate,description,created_by,posted_by,reversal_of,rule_snapshot) SELECT $1,$2,$3,$4,$5,$6,$7,base_currency,1,$8,$9,$9,$10,$11 FROM companies WHERE id=$1 RETURNING id`,[ctx.companyId,s.branch_id,s.id,number,s.business_date,p.rows[0].id,s.currency,s.description,ctx.userId,reversalOf,JSON.stringify(snapshot)]);
  const id=j.rows[0].id;
  for(const [i,l] of lines.entries())await c.query(`INSERT INTO journal_lines(company_id,journal_id,line_no,account_id,debit,credit,base_debit,base_credit,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$5,$6,$7,$8)`,[ctx.companyId,id,i+1,l.accountId,l.debit,l.credit,l.description,ctx.userId]);
  await c.query("UPDATE journal_entries SET status='POSTED' WHERE id=$1 AND company_id=$2",[id,ctx.companyId]);
  if(s.original_document_id)await c.query(`INSERT INTO document_links(company_id,source_id,target_id,relation,created_by) VALUES($1,$2,$3,'REVERSES',$4)`,[ctx.companyId,s.id,s.original_document_id,ctx.userId]);
  await c.query(`INSERT INTO outbox_events(company_id,source_id,event_type,payload,created_by) VALUES($1,$2,'JOURNAL_POSTED',$3,$4)`,[ctx.companyId,s.id,JSON.stringify({journalId:id}),ctx.userId]);
  return id;
 }
 async reverse(ctx:Context,key:string|undefined,journalId:string,body:unknown){
  z.string().uuid().parse(journalId);const v=reversalDraft.parse(body);
  return this.command(ctx,key,`journal.reverse.${journalId}`,v,async c=>{
   const j=(await c.query('SELECT * FROM journal_entries WHERE company_id=$1 AND id=$2 FOR SHARE',[ctx.companyId,journalId])).rows[0];
   if(!j)throw new BusinessError('NOT_FOUND','Journal not found.',404);this.scope(ctx,j.branch_id);
   if(j.reversal_of)throw new BusinessError('REVERSAL_CHAIN','Create an independently reviewed correcting journal instead of reversing a reversal.');
   const original=await c.query('SELECT 1 FROM source_documents WHERE company_id=$1 AND original_document_id=$2 AND status<>\'CANCELLED\'',[ctx.companyId,j.source_id]);
   if(original.rowCount)throw new BusinessError('ALREADY_REVERSED','A reversal request already exists.',409);
   const l=await c.query('SELECT account_id AS "accountId",credit AS debit,debit AS credit,description FROM journal_lines WHERE company_id=$1 AND journal_id=$2 ORDER BY line_no',[ctx.companyId,journalId]);
   return this.insertDraft(c,ctx,{branchId:j.branch_id,date:v.date,currency:j.currency,description:`Reversal of ${j.number}: ${v.reason}`.slice(0,500),lines:l.rows},'JOURNAL_REVERSAL',j.source_id,v.reason);
  });
 }
 async revise(ctx:Context,key:string|undefined,id:string,body:unknown){
  const v=journalDraft.extend({expectedRevision:z.number().int().positive(),reason:z.string().trim().min(5).max(500)}).strict().parse(body);validateLines(v.lines);
  return this.command(ctx,key,'document.revise.'+id,v,async c=>{
   const s=await this.lockedSource(c,ctx,id);if(s.created_by!==ctx.userId)throw new BusinessError('CREATOR_ONLY','Only the creator may revise this source.',403);
   if(['POSTED','CANCELLED'].includes(s.status))throw new BusinessError('STATE_CONFLICT','Posted or cancelled sources cannot be revised.',409);
   if(s.revision!==v.expectedRevision)throw new BusinessError('VERSION_CONFLICT','Source revision changed. Reload before editing.',409);
   if(s.branch_id!==v.branchId||s.currency!==v.currency)throw new BusinessError('SOURCE_SCOPE','Branch and currency changes require a new source.');
   await this.accountsCheck(c,ctx,v.lines,v.currency);
   if(s.document_type==='JOURNAL_REVERSAL'&&!(await c.query('SELECT $1::jsonb=$2::jsonb AS same',[JSON.stringify(s.payload.lines),JSON.stringify(v.lines)])).rows[0].same)throw new BusinessError('REVERSAL_LINES','Reversal lines must match the original posting.');
   await c.query("UPDATE source_documents SET status='DRAFT',revision=revision+1,payload=$3,business_date=$4,description=$5,approval_snapshot=NULL,approved_by=NULL,approved_at=NULL,updated_by=$6,updated_at=now() WHERE company_id=$1 AND id=$2",[ctx.companyId,id,JSON.stringify({lines:v.lines}),v.date,v.description,ctx.userId]);
   await event(c,ctx,id,'REVISE',s.status,'DRAFT',s.revision+1,v.reason);await audit(c,ctx,'REVISE',id,{fromRevision:s.revision,toRevision:s.revision+1,priorStatus:s.status,approvalsInvalidated:true},v.reason);return {id,status:'DRAFT',revision:s.revision+1};
  });
 }
 async rejectOrCancel(ctx:Context,key:string|undefined,id:string,action:'REJECT'|'CANCEL',body:unknown){
  const v=z.object({expectedRevision:z.number().int().positive(),reason:z.string().trim().min(5).max(500)}).strict().parse(body);
  return this.command(ctx,key,'document.'+action+'.'+id,v,async c=>{
   const s=await this.lockedSource(c,ctx,id);if(s.revision!==v.expectedRevision)throw new BusinessError('VERSION_CONFLICT','Reload the current revision.',409);
   if(['POSTED','CANCELLED'].includes(s.status)||(action==='REJECT'&&s.status!=='PENDING_APPROVAL'))throw new BusinessError('STATE_CONFLICT','This transition is not allowed.',409);
   if(action==='REJECT')await this.workflow.decide(c,ctx,s,'REJECT',v.reason);
   const next=action==='REJECT'?'REJECTED':'CANCELLED';await c.query("UPDATE source_documents SET status=$3,cancelled_by=CASE WHEN $3='CANCELLED' THEN $4 ELSE cancelled_by END,cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE cancelled_at END,updated_by=$4,updated_at=now() WHERE company_id=$1 AND id=$2",[ctx.companyId,id,next,ctx.userId]);
   await event(c,ctx,id,action,s.status,next,s.revision,v.reason);await audit(c,ctx,action,id,{from:s.status,to:next,revision:s.revision},v.reason);return {id,status:next};
  });
 }
 async period(ctx:Context,key:string|undefined,id:string,mode:'close'|'reopen',body:unknown){
  z.string().uuid().parse(id);const v=z.object({reason:z.string().trim().min(5).max(500)}).strict().parse(body);
  return this.command(ctx,key,`period.${mode}.${id}`,v,async c=>{
   const p=(await c.query('SELECT * FROM financial_periods WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];
   if(!p)throw new BusinessError('NOT_FOUND','Period not found.',404);
   if(p.status!==(mode==='close'?'OPEN':'CLOSED'))throw new BusinessError('PERIOD_STATE','Invalid period transition. Locked periods cannot be reopened here.',409);
   if(mode==='close'){
    const pending=await c.query(`SELECT 1 FROM source_documents WHERE company_id=$1 AND business_date BETWEEN $2 AND $3 AND status IN ('APPROVED','PENDING_APPROVAL') LIMIT 1`,[ctx.companyId,p.starts_on,p.ends_on]);
    if(pending.rowCount)throw new BusinessError('PENDING_DOCUMENTS','Resolve pending/approved documents before closing.');
   }
   const status=mode==='close'?'CLOSED':'OPEN';await c.query('UPDATE financial_periods SET status=$3,updated_by=$4,updated_at=now() WHERE company_id=$1 AND id=$2',[ctx.companyId,id,status,ctx.userId]);
   await audit(c,ctx,mode.toUpperCase()+'_PERIOD',null,{from:p.status,to:status},v.reason,'FINANCIAL_PERIOD',id);return {id,status};
  });
 }
}
