import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {PoolClient} from 'pg';
import {Db,Context,BusinessError,audit} from './db';
import {CommandService} from './commands';
const name=z.string().trim().min(2).max(120),reason=z.string().trim().min(5).max(500),uuid=z.string().uuid();
const accountType=z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']);
const paging=z.object({q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
export const accountProposal=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('CREATE'),code:z.string().trim().min(2).max(24).regex(/^[A-Z0-9][A-Z0-9_-]*$/),name,accountType,parentId:uuid.nullable(),postable:z.boolean(),reason}).strict(),
 z.object({kind:z.literal('RENAME'),accountId:uuid,expectedVersion:z.number().int().positive(),name,reason}).strict()
]);
@Injectable()
export class CoaService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService){}
 async catalog(ctx:Context,query:unknown){const v=paging.parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`],where='a.company_id=$1 AND (a.code ILIKE $2 OR a.name ILIKE $2)';
  const data=(await c.query(`SELECT a.*,p.code AS parent_code,u.display_name AS creator,e.display_name AS editor FROM accounts a LEFT JOIN accounts p ON p.company_id=a.company_id AND p.id=a.parent_id JOIN users u ON u.id=a.created_by LEFT JOIN users e ON e.id=a.updated_by WHERE ${where} ORDER BY a.code,a.id LIMIT $3 OFFSET $4`,[...args,v.limit,(v.page-1)*v.limit])).rows;
  return {data,total:(await c.query(`SELECT count(*)::int n FROM accounts a WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async parents(ctx:Context,query:unknown){const v=paging.extend({accountType}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`,v.accountType],where='company_id=$1 AND active AND NOT postable AND control_type IS NULL AND account_type=$3 AND (currency IS NULL OR currency=(SELECT base_currency FROM companies WHERE id=$1)) AND (code ILIKE $2 OR name ILIKE $2)';
  return {data:(await c.query(`SELECT id,code,name FROM accounts WHERE ${where} ORDER BY code,id LIMIT $4 OFFSET $5`,[...args,v.limit,(v.page-1)*v.limit])).rows,total:(await c.query(`SELECT count(*)::int n FROM accounts WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async changes(ctx:Context,query:unknown){const v=paging.extend({state:z.enum(['PENDING','APPLIED','REJECTED']).optional()}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`,v.state??null],where="r.company_id=$1 AND (r.name ILIKE $2 OR coalesce(r.code,a.code,'') ILIKE $2) AND ($3::text IS NULL OR r.state=$3)";
  const data=(await c.query(`SELECT r.*,u.display_name AS creator,e.display_name AS reviewer,a.code AS target_code,a.name AS current_name,a.version AS current_version,p.code AS parent_code,p.name AS parent_name FROM account_change_requests r JOIN users u ON u.id=r.created_by LEFT JOIN users e ON e.id=r.reviewed_by LEFT JOIN accounts a ON a.company_id=r.company_id AND a.id=r.target_id LEFT JOIN accounts p ON p.company_id=r.company_id AND p.id=r.parent_id WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT $4 OFFSET $5`,[...args,v.limit,(v.page-1)*v.limit])).rows;
  return {data,total:(await c.query(`SELECT count(*)::int n FROM account_change_requests r LEFT JOIN accounts a ON a.company_id=r.company_id AND a.id=r.target_id WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async parent(c:PoolClient,ctx:Context,id:string|null,type:string){if(!id)return;
  const p=await c.query('SELECT id FROM accounts WHERE company_id=$1 AND id=$2 AND active AND NOT postable AND control_type IS NULL AND account_type=$3 AND (currency IS NULL OR currency=(SELECT base_currency FROM companies WHERE id=$1)) FOR SHARE',[ctx.companyId,id,type]);
  if(!p.rowCount)throw new BusinessError('ACCOUNT_PARENT','Choose an active, non-posting, non-control parent of the same classification in this company.');
 }
 async target(c:PoolClient,ctx:Context,id:string,version:number){const row=(await c.query('SELECT to_jsonb(a) AS snapshot FROM accounts a WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0]?.snapshot;
  if(!row)throw new BusinessError('NOT_FOUND','Account not found.',404);
  if(row.version!==version)throw new BusinessError('VERSION_CONFLICT','Account changed. Reject the stale request and submit a new proposal.',409);return row;
 }
 async propose(ctx:Context,key:string|undefined,body:unknown){const v=accountProposal.parse(body);return this.commands.run(ctx,key,'account.change.propose',v,async c=>{
  if(v.kind==='CREATE')await this.parent(c,ctx,v.parentId,v.accountType);else await this.target(c,ctx,v.accountId,v.expectedVersion);
  const after=(await c.query(`INSERT INTO account_change_requests(company_id,kind,target_id,expected_version,new_account_id,code,name,account_type,parent_id,postable,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING to_jsonb(account_change_requests) AS snapshot`,[ctx.companyId,v.kind,v.kind==='RENAME'?v.accountId:null,v.kind==='RENAME'?v.expectedVersion:null,v.kind==='CREATE'?randomUUID():null,v.kind==='CREATE'?v.code:null,v.name,v.kind==='CREATE'?v.accountType:null,v.kind==='CREATE'?v.parentId:null,v.kind==='CREATE'?v.postable:null,v.reason,ctx.userId])).rows[0].snapshot;
  await audit(c,ctx,'ACCOUNT_CHANGE_PROPOSE',null,{before:null,after},v.reason,'ACCOUNT_CONFIGURATION',after.id);return {id:after.id,state:after.state};
 },true);}
 async decide(ctx:Context,key:string|undefined,id:string,body:unknown){uuid.parse(id);const v=z.object({decision:z.enum(['APPROVE','REJECT']),reason}).strict().parse(body);return this.commands.run(ctx,key,'account.change.decide.'+id,v,async c=>{
  const before=(await c.query('SELECT to_jsonb(r) AS snapshot FROM account_change_requests r WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0]?.snapshot;
  if(!before)throw new BusinessError('NOT_FOUND','Account request not found.',404);
  if(before.state!=='PENDING')throw new BusinessError('STATE_CONFLICT','This request was already reviewed.',409);
  if(before.created_by===ctx.userId)throw new BusinessError('INDEPENDENT_REVIEW','Another authorized user must review your request.',403);
  let accountBefore=null,accountAfter=null;const applied=v.decision==='APPROVE',accountId=applied?(before.target_id??before.new_account_id):null;
  if(applied){
   if(before.kind==='CREATE'){
    await this.parent(c,ctx,before.parent_id,before.account_type);
    if((await c.query('SELECT 1 FROM accounts WHERE company_id=$1 AND code=$2',[ctx.companyId,before.code])).rowCount)throw new BusinessError('ACCOUNT_CODE_EXISTS','This account code is already in use. Reject this request and propose a different code.',409);
   }else accountBefore=await this.target(c,ctx,before.target_id,before.expected_version);
  }
  const after=(await c.query("UPDATE account_change_requests SET state=$3,reviewed_by=$4,reviewed_at=now(),review_reason=$5,result_account_id=$6 WHERE company_id=$1 AND id=$2 RETURNING to_jsonb(account_change_requests) AS snapshot",[ctx.companyId,id,applied?'APPLIED':'REJECTED',ctx.userId,v.reason,accountId])).rows[0].snapshot;
  if(applied){
   if(before.kind==='CREATE')accountAfter=(await c.query('INSERT INTO accounts(id,company_id,code,name,account_type,parent_id,postable,created_by,last_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING to_jsonb(accounts) AS snapshot',[accountId,ctx.companyId,before.code,before.name,before.account_type,before.parent_id,before.postable,before.created_by,id])).rows[0].snapshot;
   else accountAfter=(await c.query('UPDATE accounts SET name=$3,version=version+1,updated_by=$4,updated_at=now(),last_request_id=$5 WHERE company_id=$1 AND id=$2 RETURNING to_jsonb(accounts) AS snapshot',[ctx.companyId,accountId,before.name,ctx.userId,id])).rows[0].snapshot;
  }
  await audit(c,ctx,'ACCOUNT_CHANGE_'+v.decision,null,{before,after,accountBefore,accountAfter},v.reason,'ACCOUNT_CONFIGURATION',id);return {id,state:after.state,accountId,version:accountAfter?.version??null};
 },true);}
}
