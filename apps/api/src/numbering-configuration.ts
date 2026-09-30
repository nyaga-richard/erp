import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {PoolClient} from 'pg';
import {Db,Context,BusinessError,audit} from './db';
import {CommandService} from './commands';
const uuid=z.string().uuid(),reason=z.string().trim().min(5).max(500);
const identity={branchId:uuid,documentType:z.string().min(1).max(64),year:z.coerce.number().int().min(1).max(9999)};
const paging=z.object({q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
const proposal=z.object({...identity,year:z.number().int().min(1).max(9999),prefix:z.string().trim().min(2).max(16).regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/),padding:z.number().int().min(4).max(12),expectedVersion:z.number().int().min(0),reason}).strict();
@Injectable()
export class NumberingConfigurationService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService){}
 async types(ctx:Context){return this.db.transaction(ctx,async c=>(await c.query('SELECT document_type,prefix,padding FROM document_numbering_defaults ORDER BY document_type')).rows);}
 async effective(ctx:Context,query:unknown){const v=z.object(identity).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const branch=(await c.query('SELECT id,code,name,active FROM branches WHERE company_id=$1 AND id=$2',[ctx.companyId,v.branchId])).rows[0];if(!branch)throw new BusinessError('NOT_FOUND','Branch not found.',404);
  const args=[ctx.companyId,v.branchId,v.documentType,v.year],row=(await c.query('SELECT * FROM numbering_format($1,$2,$3,$4)',args)).rows[0];if(!row)throw new BusinessError('NUMBERING_TYPE','Document type has not been released.');
  const locked=(await c.query('SELECT EXISTS(SELECT 1 FROM document_sequences WHERE company_id=$1 AND branch_id=$2 AND document_type=$3 AND financial_year=$4) AS locked',args)).rows[0].locked;return {...row,inherited:row.policy_id===null,locked,branch};
 });}
 async catalog(ctx:Context,query:unknown){const v=paging.parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`],where='p.company_id=$1 AND (p.prefix ILIKE $2 OR p.document_type ILIKE $2 OR b.code ILIKE $2 OR b.name ILIKE $2 OR p.calendar_year::text ILIKE $2)';
  const data=(await c.query(`SELECT p.*,b.code AS branch_code,b.name AS branch_name,b.active AS branch_active,u.display_name AS creator,r.reviewed_by,r.reviewed_at,rev.display_name AS reviewer,EXISTS(SELECT 1 FROM document_sequences s WHERE s.company_id=p.company_id AND s.branch_id=p.branch_id AND s.document_type=p.document_type AND s.financial_year=p.calendar_year) AS locked FROM document_numbering_policies p JOIN branches b ON b.id=p.branch_id JOIN users u ON u.id=p.created_by JOIN numbering_change_requests r ON r.id=p.last_request_id JOIN users rev ON rev.id=r.reviewed_by WHERE ${where} ORDER BY p.calendar_year DESC,b.code,p.document_type,p.id LIMIT $3 OFFSET $4`,[...args,v.limit,(v.page-1)*v.limit])).rows;
  return {data,total:(await c.query(`SELECT count(*)::int n FROM document_numbering_policies p JOIN branches b ON b.id=p.branch_id WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async changes(ctx:Context,query:unknown){const v=paging.extend({state:z.enum(['PENDING','APPLIED','REJECTED']).optional()}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`,v.state??null],where="r.company_id=$1 AND (r.prefix ILIKE $2 OR r.document_type ILIKE $2 OR b.code ILIKE $2 OR b.name ILIKE $2 OR r.calendar_year::text ILIKE $2) AND ($3::text IS NULL OR r.state=$3)";
  const data=(await c.query(`SELECT r.*,b.code AS branch_code,b.name AS branch_name,u.display_name AS creator,rev.display_name AS reviewer,coalesce(p.version,0) AS current_version FROM numbering_change_requests r JOIN branches b ON b.id=r.branch_id JOIN users u ON u.id=r.created_by LEFT JOIN users rev ON rev.id=r.reviewed_by LEFT JOIN document_numbering_policies p ON p.company_id=r.company_id AND p.branch_id=r.branch_id AND p.document_type=r.document_type AND p.calendar_year=r.calendar_year WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT $4 OFFSET $5`,[...args,v.limit,(v.page-1)*v.limit])).rows;
  return {data,total:(await c.query(`SELECT count(*)::int n FROM numbering_change_requests r JOIN branches b ON b.id=r.branch_id WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async validate(c:PoolClient,company:string,branch:string,type:string,year:number,prefix:string){try{await c.query('SELECT assert_numbering_format($1,$2,$3,$4,$5)',[company,branch,type,year,prefix]);}catch(e){const err=e as {code?:string;message:string},messages:Record<string,string>={NUMBERING_BRANCH:'Choose an active branch in this company.',NUMBERING_TYPE:'Document type has not been released.',NUMBERING_INITIALIZED:'This numbering key is already initialized and its format is immutable. Choose an unused year/key.',NUMBERING_PREFIX:'Another effective document type uses this prefix in the same branch/year.'};if(err.code==='23514'&&messages[err.message])throw new BusinessError(err.message,messages[err.message]);throw e;}}
 async current(c:PoolClient,ctx:Context,branch:string,type:string,year:number,expected:number){const row=(await c.query('SELECT to_jsonb(p) AS snapshot FROM document_numbering_policies p WHERE company_id=$1 AND branch_id=$2 AND document_type=$3 AND calendar_year=$4 FOR UPDATE',[ctx.companyId,branch,type,year])).rows[0]?.snapshot??null;if((row?.version??0)!==expected)throw new BusinessError('VERSION_CONFLICT','The effective policy changed. Reject this stale request and propose against the current version.',409);return row;}
 async propose(ctx:Context,key:string|undefined,body:unknown){const v=proposal.parse(body);return this.commands.run(ctx,key,'numbering.change.propose',v,async c=>{
  await this.validate(c,ctx.companyId,v.branchId,v.documentType,v.year,v.prefix);const current=await this.current(c,ctx,v.branchId,v.documentType,v.year,v.expectedVersion);
  const after=(await c.query(`INSERT INTO numbering_change_requests(company_id,branch_id,document_type,calendar_year,prefix,padding,expected_version,target_id,new_policy_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING to_jsonb(numbering_change_requests) AS snapshot`,[ctx.companyId,v.branchId,v.documentType,v.year,v.prefix,v.padding,v.expectedVersion,current?.id??null,current?null:randomUUID(),v.reason,ctx.userId])).rows[0].snapshot;
  await audit(c,ctx,'NUMBERING_CHANGE_PROPOSE',null,{before:null,after},v.reason,'NUMBERING_CONFIGURATION',after.id);return {id:after.id,state:after.state};
 },true);}
 async decide(ctx:Context,key:string|undefined,id:string,body:unknown){uuid.parse(id);const v=z.object({decision:z.enum(['APPROVE','REJECT']),reason}).strict().parse(body);return this.commands.run(ctx,key,'numbering.change.decide.'+id,v,async c=>{
  const before=(await c.query('SELECT to_jsonb(r) AS snapshot FROM numbering_change_requests r WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0]?.snapshot;
  if(!before)throw new BusinessError('NOT_FOUND','Numbering request not found.',404);if(before.state!=='PENDING')throw new BusinessError('STATE_CONFLICT','This request was already reviewed.',409);if(before.created_by===ctx.userId)throw new BusinessError('INDEPENDENT_REVIEW','Another authorized user must review your request.',403);
  const applied=v.decision==='APPROVE',policyId=applied?(before.target_id??before.new_policy_id):null;let policyBefore=null,policyAfter=null;
  if(applied){await this.validate(c,ctx.companyId,before.branch_id,before.document_type,before.calendar_year,before.prefix);policyBefore=await this.current(c,ctx,before.branch_id,before.document_type,before.calendar_year,before.expected_version);}
  const after=(await c.query("UPDATE numbering_change_requests SET state=$3,reviewed_by=$4,reviewed_at=now(),review_reason=$5,result_policy_id=$6 WHERE company_id=$1 AND id=$2 RETURNING to_jsonb(numbering_change_requests) AS snapshot",[ctx.companyId,id,applied?'APPLIED':'REJECTED',ctx.userId,v.reason,policyId])).rows[0].snapshot;
  if(applied){if(!policyBefore)policyAfter=(await c.query('INSERT INTO document_numbering_policies(id,company_id,branch_id,document_type,calendar_year,prefix,padding,created_by,last_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING to_jsonb(document_numbering_policies) AS snapshot',[policyId,ctx.companyId,before.branch_id,before.document_type,before.calendar_year,before.prefix,before.padding,before.created_by,id])).rows[0].snapshot;
   else policyAfter=(await c.query('UPDATE document_numbering_policies SET prefix=$3,padding=$4,version=version+1,updated_by=$5,updated_at=now(),last_request_id=$6 WHERE company_id=$1 AND id=$2 RETURNING to_jsonb(document_numbering_policies) AS snapshot',[ctx.companyId,policyId,before.prefix,before.padding,ctx.userId,id])).rows[0].snapshot;}
  await audit(c,ctx,'NUMBERING_CHANGE_'+v.decision,null,{before,after,policyBefore,policyAfter},v.reason,'NUMBERING_CONFIGURATION',id);return {id,state:after.state,policyId,version:policyAfter?.version??null};
 },true);}
}
