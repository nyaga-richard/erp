import {Inject,Injectable} from '@nestjs/common';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {Db,Context,BusinessError,audit} from './db';
import {CommandService} from './commands';
export const reasonBody=z.object({reason:z.string().trim().min(5).max(500),expectedRevision:z.number().int().positive()}).strict();
export const policyBody=z.object({eventType:z.enum(['MANUAL_JOURNAL','JOURNAL_REVERSAL','STOCK_GAIN','STOCK_LOSS','STOCK_REVERSAL','SERVICE_CREDIT_INVOICE']),threshold:z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/),independentCreator:z.boolean(),independentPoster:z.boolean(),steps:z.array(z.object({permission:z.string().min(3).max(80),minimumApprovers:z.number().int().min(1).max(5)}).strict()).min(1).max(5),reason:z.string().trim().min(5).max(500)}).strict();
@Injectable()
export class WorkflowService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService){}
 async snapshot(c:PoolClient,ctx:Context,s:any,total:string,fallbackPermission='journals:approve'){
  const p=(await c.query(`SELECT * FROM approval_policies WHERE company_id=$1 AND event_type=$2 AND branch_id IS NULL AND active AND threshold_base<=$3::numeric ORDER BY threshold_base DESC LIMIT 1`,[ctx.companyId,s.document_type,total])).rows[0];
  if(!p){const co=(await c.query('SELECT independent_approval,independent_posting FROM companies WHERE id=$1',[ctx.companyId])).rows[0];return {origin:'COMPANY_BASELINE',policyId:null,version:1,revision:s.revision,baseAmount:total,independentCreator:co.independent_approval,independentPoster:co.independent_posting,steps:[{number:1,permission:fallbackPermission,minimumApprovers:1,stepId:null}]};}
  const steps=(await c.query('SELECT id AS "stepId",step_no AS number,required_permission AS permission,minimum_approvers AS "minimumApprovers" FROM approval_steps WHERE company_id=$1 AND policy_id=$2 ORDER BY step_no',[ctx.companyId,p.id])).rows;
  if(!steps.length)throw new BusinessError('POLICY_INCOMPLETE','No approval steps have been configured.');
  return {origin:'PUBLISHED_POLICY',policyId:p.id,version:p.version,revision:s.revision,baseAmount:total,threshold:p.threshold_base,independentCreator:p.independent_creator,independentPoster:p.independent_poster,steps};
 }
 async decisions(c:PoolClient,ctx:Context,s:any){return (await c.query("SELECT created_by,step_no,decision FROM approval_decisions WHERE company_id=$1 AND source_id=$2 AND revision=$3",[ctx.companyId,s.id,s.revision])).rows;}
 async decide(c:PoolClient,ctx:Context,s:any,decision:'APPROVE'|'REJECT',comments:string){
  const snap=s.approval_snapshot;if(!snap)throw new BusinessError('LEGACY_REVIEW','Revise and resubmit this legacy document to establish an approval snapshot.');
  if(snap.independentCreator&&s.created_by===ctx.userId)throw new BusinessError('SEGREGATION','Creator cannot approve or reject their own document.',403);
  const existing=await this.decisions(c,ctx,s);
  if(existing.some(d=>d.created_by===ctx.userId))throw new BusinessError('DUPLICATE_APPROVER','Each revision requires distinct approvers across all steps.',409);
  const step=snap.steps.find((st:any)=>existing.filter(d=>d.step_no===st.number&&d.decision==='APPROVE').length<st.minimumApprovers);
  if(!step)throw new BusinessError('APPROVAL_COMPLETE','Approval is already complete.',409);
  if(!ctx.permissions.includes(step.permission))throw new BusinessError('STEP_PERMISSION',`Current step requires ${step.permission}.`,403);
  await c.query('INSERT INTO approval_decisions(company_id,source_id,revision,step_id,step_no,created_by,decision,comments) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ctx.companyId,s.id,s.revision,step.stepId,step.number,ctx.userId,decision,comments]);
  const all=[...existing,{step_no:step.number,decision}];return decision==='APPROVE'&&snap.steps.every((st:any)=>all.filter(d=>d.step_no===st.number&&d.decision==='APPROVE').length>=st.minimumApprovers);
 }
 async checkPoster(c:PoolClient,ctx:Context,s:any){
  const independent=s.approval_snapshot?.independentPoster??(await c.query('SELECT independent_posting FROM companies WHERE id=$1',[ctx.companyId])).rows[0].independent_posting;
  const all=await this.decisions(c,ctx,s);
  if(independent&&([s.created_by,s.approved_by].includes(ctx.userId)||all.some(d=>d.decision==='APPROVE'&&d.created_by===ctx.userId)))throw new BusinessError('SEGREGATION','Poster must be different from the creator and every approver.',403);
 }
 async list(ctx:Context){return this.db.transaction(ctx,async c=>(await c.query(`SELECT p.*,(SELECT base_currency FROM companies WHERE id=p.company_id) AS currency,u.display_name AS creator,pub.display_name AS publisher,coalesce((SELECT jsonb_agg(jsonb_build_object('number',s.step_no,'permission',s.required_permission,'minimumApprovers',s.minimum_approvers) ORDER BY s.step_no) FROM approval_steps s WHERE s.company_id=p.company_id AND s.policy_id=p.id),'[]') AS steps FROM approval_policies p JOIN users u ON u.id=p.created_by LEFT JOIN users pub ON pub.id=p.published_by WHERE p.company_id=$1 ORDER BY p.created_at DESC,p.id LIMIT 100`,[ctx.companyId])).rows);}
 async create(ctx:Context,key:string|undefined,body:unknown){const v=policyBody.parse(body);return this.commands.run(ctx,key,'policy.create',v,async c=>{
  if(v.steps.reduce((n,s)=>n+s.minimumApprovers,0)>10)throw new BusinessError('POLICY_LIMIT','At most ten distinct approvers may be required.');
  const permissions=(await c.query('SELECT code FROM permissions WHERE code=ANY($1::text[])',[v.steps.map(s=>s.permission)])).rows.map(r=>r.code);
  if(v.steps.some(s=>!permissions.includes(s.permission)))throw new BusinessError('UNKNOWN_PERMISSION','Every step must use an existing permission.');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,88))',[ctx.companyId+v.eventType]);
  const version=(await c.query('SELECT coalesce(max(version),0)+1 AS next FROM approval_policies WHERE company_id=$1 AND event_type=$2',[ctx.companyId,v.eventType])).rows[0].next;
  const p=(await c.query('INSERT INTO approval_policies(company_id,created_by,event_type,version,threshold_base,independent_creator,independent_poster) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,version',[ctx.companyId,ctx.userId,v.eventType,version,v.threshold,v.independentCreator,v.independentPoster])).rows[0];
  for(const [i,st] of v.steps.entries())await c.query('INSERT INTO approval_steps(company_id,created_by,policy_id,step_no,required_permission,minimum_approvers) VALUES($1,$2,$3,$4,$5,$6)',[ctx.companyId,ctx.userId,p.id,i+1,st.permission,st.minimumApprovers]);
  await audit(c,ctx,'POLICY_DRAFT',null,{...v,id:p.id,version},v.reason,'APPROVAL_POLICY',p.id);return p;
 });}
 async publish(ctx:Context,key:string|undefined,id:string,body:unknown){z.string().uuid().parse(id);const v=z.object({reason:z.string().trim().min(5).max(500)}).strict().parse(body);return this.commands.run(ctx,key,'policy.publish.'+id,v,async c=>{
  const p=(await c.query('SELECT * FROM approval_policies WHERE company_id=$1 AND id=$2',[ctx.companyId,id])).rows[0];if(!p)throw new BusinessError('NOT_FOUND','Policy not found.',404);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,88))',[ctx.companyId+p.event_type]);
  const locked=(await c.query('SELECT * FROM approval_policies WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];
  if(locked.published_by)throw new BusinessError('POLICY_STATE','This policy version has already been published.',409);
  if(p.created_by===ctx.userId)throw new BusinessError('SEGREGATION','A different user must publish this policy.',403);
  await c.query('UPDATE approval_policies SET active=false,superseded_at=now() WHERE company_id=$1 AND event_type=$2 AND threshold_base=$3 AND branch_id IS NULL AND active',[ctx.companyId,p.event_type,p.threshold_base]);
  await c.query('UPDATE approval_policies SET active=true,published_by=$3,published_at=now() WHERE company_id=$1 AND id=$2',[ctx.companyId,id,ctx.userId]);
  await audit(c,ctx,'POLICY_PUBLISH',null,{policyId:id,version:p.version,threshold:p.threshold_base},v.reason,'APPROVAL_POLICY',id);return {id,status:'ACTIVE'};
 });}
}
