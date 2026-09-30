import {CustomerAmendmentService} from './customer-amendments';
import {CustomerService,CustomerController} from './customers';
import {InventoryAdjustmentService} from './inventory-adjustments';
import {InventoryController} from './inventory-controller';
import {ProductConfigurationService} from './product-configuration';
import {ProductReferencesService} from './product-references';
import {TaxConfigurationService} from './tax-configuration';
import {PostingRuleConfigurationService} from './posting-rule-configuration';
import {NumberingConfigurationService} from './numbering-configuration';
import {HealthController,HealthService} from './health';
import {CoaService} from './coa';
import {previewMemorySessionsEnabled} from './preview-session';
import {OrganizationService} from './organization';
import {sessionCookieOptions,sessionCookieName} from './session-cookie';
import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Module,Controller,Get,Post,Param,Body,Req,Res,Inject,Catch,ExceptionFilter,ArgumentsHost,HttpException} from '@nestjs/common';
import {Request,Response} from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import {z,ZodError} from 'zod';
import {Db,BusinessError,requestId} from './db';
import {AuthService} from './auth';
import {AccountingService} from './accounting';
import {CommandService} from './commands';
import {WorkflowService} from './workflow';
import {AdminService} from './admin';
import {SecurityService,securityEvent} from './security';
import {ControlController} from './control-controller';

@Catch()
class Errors implements ExceptionFilter{
 constructor(private db:Db){}
 async catch(e:any,host:ArgumentsHost){
  const r=host.switchToHttp().getResponse<Response>(),req=host.switchToHttp().getRequest<Request>();
  const status=e instanceof BusinessError?e.status:e instanceof ZodError?400:e instanceof HttpException?e.getStatus():e.code==='23505'?409:e.code==='23514'||e.code==='23503'?422:e.code==='40001'||e.code==='40P01'?503:500;
  if(status===500)console.error(JSON.stringify({event:'request_failed',requestId:(req as any).requestId,code:typeof e.code==='string'?e.code:'INTERNAL'}));
  try{await securityEvent(this.db.pool,req,'REQUEST_REJECTED','DENIED',null,{code:e instanceof BusinessError?e.code:status===400?'VALIDATION':'REQUEST_FAILED',route:req.route?.path??'UNKNOWN',method:req.method});}catch{console.error('SECURITY_ALERT: request audit persistence unavailable',(req as any).requestId);}
  r.status(status).json({code:e instanceof BusinessError?e.code:e instanceof ZodError?'VALIDATION':status===409?'CONFLICT':status===422?'INTEGRITY_CONSTRAINT':status===503?'RETRY_TRANSACTION':status===404?'NOT_FOUND':'REQUEST_FAILED',message:e instanceof BusinessError?e.message:e instanceof ZodError?'Check the submitted fields.':status===422?'Database integrity rule rejected the transaction.':status===409?'This transaction or reference already exists.':status===503?'Transaction contention. Retry with the same idempotency key.':status===404?'Endpoint not found.':'The request could not be completed.',requestId:(req as any).requestId, ...(e instanceof ZodError?{details:e.issues.map(i=>({path:i.path.join('.'),message:i.message}))}:{})});
 }
}
const empty=z.object({}).strict();
@Controller('api/v1')
class ApiController{
 constructor(@Inject(Db) private db:Db,@Inject(AuthService) private auth:AuthService,@Inject(AccountingService) private accounting:AccountingService,@Inject(HealthService) private healthService:HealthService){}
 @Get('health') async health(@Res({passthrough:true}) res:Response){const result=await this.healthService.ready();res.status(result.ready?200:503);return result;}
 @Get('auth/config') authConfig(){return {previewMemorySession:previewMemorySessionsEnabled()};}
 @Post('auth/login') async login(@Body() b:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){
  const v=await this.auth.login(b,req);
  if(previewMemorySessionsEnabled()&&req.header('X-ERP-Session-Transport')==='memory'){res.clearCookie(sessionCookieName(),sessionCookieOptions());return {csrfToken:v.csrf,previewSessionToken:v.token};}
  res.cookie(sessionCookieName(),v.token,{...sessionCookieOptions(),maxAge:8*3600*1000});return {csrfToken:v.csrf};
 }
 @Get('auth/me') me(@Req() req:Request){return this.auth.me(req);}
 @Post('auth/logout') async logout(@Req() req:Request,@Res({passthrough:true}) res:Response){const result=await this.auth.logout(req);res.clearCookie(sessionCookieName(),sessionCookieOptions());return result;}
 @Get('workspace') async workspace(@Req() req:Request){const ctx=await this.auth.context(req,'workspace:view');return this.db.transaction(ctx,async c=>({permissions:ctx.permissions,currency:(await c.query('SELECT base_currency FROM companies WHERE id=$1',[ctx.companyId])).rows[0].base_currency,branches:(await c.query('SELECT id,code,name FROM branches WHERE company_id=$1 AND active AND id=ANY($2::uuid[]) ORDER BY name',[ctx.companyId,ctx.branches])).rows,release:{phase:'Phase 1 — accounting foundation',productionReady:false,unreleased:['Inventory','Purchasing','POS','Subledgers','Payments','Tax/eTIMS','Cashier','Expenses']}}));}
 @Get('accounts') async accounts(@Req() req:Request){const ctx=await this.auth.context(req,'accounting:view');const q=z.string().max(100).parse(req.query.q??'');const page=z.coerce.number().int().min(1).max(10000).parse(req.query.page??1);const limit=z.coerce.number().int().min(1).max(100).parse(req.query.limit??100);return this.db.transaction(ctx,async c=>(await c.query('SELECT id,code,name,account_type,parent_id,control_type,currency,active,postable FROM accounts WHERE company_id=$1 AND (code ILIKE $2 OR name ILIKE $2) ORDER BY code LIMIT $3 OFFSET $4',[ctx.companyId,`%${q}%`,limit,(page-1)*limit])).rows);}
 @Get('periods') async periods(@Req() req:Request){const ctx=await this.auth.context(req,'accounting:view');return this.db.transaction(ctx,async c=>(await c.query('SELECT id,name,starts_on,ends_on,status FROM financial_periods WHERE company_id=$1 ORDER BY starts_on DESC',[ctx.companyId])).rows);}
 @Post('periods/:id/close') async close(@Param('id') id:string,@Body() b:unknown,@Req() req:Request){return this.accounting.period(await this.auth.context(req,'periods:close',true),req.header('Idempotency-Key'),id,'close',b);}
 @Post('periods/:id/reopen') async reopen(@Param('id') id:string,@Body() b:unknown,@Req() req:Request){return this.accounting.period(await this.auth.context(req,'periods:reopen',true),req.header('Idempotency-Key'),id,'reopen',b);}
 @Post('journals/drafts') async draft(@Body() b:unknown,@Req() req:Request){return this.accounting.create(await this.auth.context(req,'journals:create',true),req.header('Idempotency-Key'),b);}
 @Post('documents/:id/submit') async submit(@Param('id') id:string,@Body() b:unknown,@Req() req:Request){empty.parse(b);return this.accounting.transition(await this.auth.context(req,'journals:create',true),req.header('Idempotency-Key'),id,'SUBMIT');}
 @Post('documents/:id/approve') async approve(@Param('id') id:string,@Body() b:unknown,@Req() req:Request){empty.parse(b);return this.accounting.transition(await this.auth.context(req,'journals:approve',true),req.header('Idempotency-Key'),id,'APPROVE');}
 @Post('documents/:id/post') async post(@Param('id') id:string,@Body() b:unknown,@Req() req:Request){empty.parse(b);return this.accounting.transition(await this.auth.context(req,'journals:post',true),req.header('Idempotency-Key'),id,'POST');}
 @Post('journals/:id/reversal-drafts') async reverse(@Param('id') id:string,@Body() b:unknown,@Req() req:Request){return this.accounting.reverse(await this.auth.context(req,'journals:reverse',true),req.header('Idempotency-Key'),id,b);}
 @Get('documents') async documents(@Req() req:Request){
  const ctx=await this.auth.context(req,'journals:view');const q=z.string().max(100).parse(req.query.q??'');const page=z.coerce.number().int().min(1).max(10000).parse(req.query.page??1);const size=z.coerce.number().int().min(1).max(100).parse(req.query.limit??25);
  return this.db.transaction(ctx,async c=>{
   const params=[ctx.companyId,ctx.branches,`%${q}%`];const where=`s.company_id=$1 AND s.document_type IN ('MANUAL_JOURNAL','JOURNAL_REVERSAL') AND s.branch_id=ANY($2::uuid[]) AND (s.document_number ILIKE $3 OR s.description ILIKE $3)`;
   const count=(await c.query(`SELECT count(*) FROM source_documents s WHERE ${where}`,params)).rows[0].count;
   const rows=await c.query(`SELECT s.id,s.branch_id,br.code AS branch_code,br.name AS branch_name,s.document_number,s.document_type,s.description,s.status,s.business_date,s.currency,s.created_at,u.display_name AS creator FROM source_documents s JOIN branches br ON br.company_id=s.company_id AND br.id=s.branch_id JOIN users u ON u.id=s.created_by WHERE ${where} ORDER BY s.created_at DESC,s.id LIMIT $4 OFFSET $5`,[...params,size,(page-1)*size]);return {data:rows.rows,total:Number(count),page,limit:size};
  });
 }
 @Get('documents/:id') async document(@Param('id') id:string,@Req() req:Request){
  z.string().uuid().parse(id);const ctx=await this.auth.context(req,'journals:view');return this.db.transaction(ctx,async c=>{
   const r=await c.query(`SELECT s.*,br.code AS branch_code,br.name AS branch_name,u.display_name AS creator,a.display_name AS approver,p.display_name AS poster FROM source_documents s JOIN branches br ON br.company_id=s.company_id AND br.id=s.branch_id JOIN users u ON u.id=s.created_by LEFT JOIN users a ON a.id=s.approved_by LEFT JOIN users p ON p.id=s.posted_by WHERE s.company_id=$1 AND s.document_type IN ('MANUAL_JOURNAL','JOURNAL_REVERSAL') AND s.id=$2 AND s.branch_id=ANY($3::uuid[])`,[ctx.companyId,id,ctx.branches]);
   if(!r.rowCount)throw new BusinessError('NOT_FOUND','Document not found.',404);
   const journals=await c.query('SELECT * FROM journal_entries WHERE company_id=$1 AND source_id=$2',[ctx.companyId,id]);
   const lines=await c.query(`SELECT l.*,a.code,a.name FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_id WHERE l.company_id=$1 AND j.source_id=$2 ORDER BY l.line_no`,[ctx.companyId,id]);
   const events=await c.query(`SELECT e.*,u.display_name AS actor FROM document_events e JOIN users u ON u.id=e.actor_id WHERE e.company_id=$1 AND e.source_id=$2 ORDER BY e.created_at,e.id`,[ctx.companyId,id]);
   const links=await c.query('SELECT * FROM document_links WHERE company_id=$1 AND (source_id=$2 OR target_id=$2)',[ctx.companyId,id]);const approvals=await c.query('SELECT a.id,a.revision,a.step_no,a.decision,a.comments,a.created_at,a.created_by,u.display_name AS actor FROM approval_decisions a JOIN users u ON u.id=a.created_by WHERE a.company_id=$1 AND a.source_id=$2 ORDER BY a.created_at,a.id',[ctx.companyId,id]);const revisions=await c.query('SELECT revision,snapshot,changed_by,reason,created_at FROM source_revisions WHERE company_id=$1 AND source_id=$2 ORDER BY revision',[ctx.companyId,id]);return {...r.rows[0],journals:journals.rows,lines:lines.rows,events:events.rows,links:links.rows,approvals:approvals.rows,revisions:revisions.rows};
  });
 }
 @Get('journals') async journals(@Req() req:Request){const ctx=await this.auth.context(req,'accounting:view');const limit=z.coerce.number().int().min(1).max(100).parse(req.query.limit??50);return this.db.transaction(ctx,async c=>(await c.query(`SELECT j.id,(SELECT document_type FROM source_documents WHERE id=j.source_id) AS document_type,j.branch_id,br.code AS branch_code,br.name AS branch_name,j.number,j.source_id,j.accounting_date,j.description,j.currency,j.reversal_of,sum(l.debit)::text AS debit,sum(l.credit)::text AS credit,u.display_name AS poster FROM journal_entries j JOIN branches br ON br.company_id=j.company_id AND br.id=j.branch_id JOIN journal_lines l ON l.journal_id=j.id JOIN users u ON u.id=j.posted_by WHERE j.company_id=$1 AND j.branch_id=ANY($2::uuid[]) GROUP BY j.id,u.display_name,br.code,br.name ORDER BY j.posted_at DESC,j.id LIMIT $3`,[ctx.companyId,ctx.branches,limit])).rows);}
 @Get('reports/trial-balance') async trial(@Req() req:Request){const ctx=await this.auth.context(req,'accounting:view');return this.db.transaction(ctx,async c=>(await c.query(`SELECT a.id,a.code,a.name,a.account_type,coalesce(sum(l.base_debit),0)::text AS debit,coalesce(sum(l.base_credit),0)::text AS credit,(coalesce(sum(l.base_debit),0)-coalesce(sum(l.base_credit),0))::text AS balance FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id AND l.company_id=a.company_id WHERE a.company_id=$1 AND a.postable GROUP BY a.id ORDER BY a.code`,[ctx.companyId])).rows);}
 @Get('reports/integrity') async integrity(@Req() req:Request){const ctx=await this.auth.context(req,'accounting:view');return this.db.transaction(ctx,async c=>{
   const r=await c.query(`SELECT j.id,j.number,sum(l.debit-l.credit)::text AS difference,sum(l.base_debit-l.base_credit)::text AS base_difference FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_id=j.id WHERE j.company_id=$1 GROUP BY j.id HAVING sum(l.debit-l.credit)<>0 OR sum(l.base_debit-l.base_credit)<>0 OR count(l.id)<2 OR j.status<>'POSTED'`,[ctx.companyId]);
   const counts=await c.query(`SELECT (SELECT count(*) FROM journal_entries WHERE company_id=$1)::int AS journals,(SELECT count(*) FROM source_documents WHERE company_id=$1 AND status='PENDING_APPROVAL')::int AS awaiting_approval,(SELECT count(*) FROM audit_logs WHERE company_id=$1)::int AS audit_events`,[ctx.companyId]);
   return {coreJournalCheck:r.rowCount===0?'PASS':'FAIL',exceptions:r.rows,counts:counts.rows[0],operationalReconciliations:'NOT_IMPLEMENTED',scope:'Journal arithmetic only; not AR/AP/inventory/tax/payment reconciliation.'};
 });}
 @Get('audit') async audit(@Req() req:Request){const ctx=await this.auth.context(req,'audit:view');const actor=req.query.userId?z.string().uuid().parse(req.query.userId):null;const page=z.coerce.number().int().min(1).max(10000).parse(req.query.page??1);return this.db.transaction(ctx,async c=>(await c.query(`SELECT a.id,a.source_id,a.action,a.entity_type,a.entity_id,a.created_at,a.reason,a.request_id,CASE WHEN a.entity_type IN ('CUSTOMER_CONFIGURATION','CUSTOMER_AMENDMENT') AND NOT $6::boolean THEN jsonb_build_object('redacted',true,'reason','Customer profile visibility is required.') WHEN a.entity_type='INVENTORY_SOURCE' AND NOT $5::boolean THEN jsonb_build_object('redacted',true,'reason','Stock cost visibility is required.') WHEN a.entity_type='PRODUCT_CONFIGURATION' THEN CASE WHEN NOT $4::boolean THEN jsonb_build_object('redacted',true,'reason','Purchase-cost visibility is required for product snapshots.') ELSE (SELECT jsonb_object_agg(k,CASE WHEN jsonb_typeof(v)='object' THEN v||jsonb_build_object('purchase_price',v->>'purchase_price','selling_price',v->>'selling_price') ELSE v END) FROM jsonb_each(a.new_values) AS e(k,v)) END ELSE a.new_values END AS new_values,u.display_name AS actor,s.document_number,s.document_type FROM audit_logs a JOIN users u ON u.id=a.actor_id LEFT JOIN source_documents s ON s.id=a.source_id WHERE a.company_id=$1 AND ($2::uuid IS NULL OR a.actor_id=$2) ORDER BY a.created_at DESC,a.id LIMIT 50 OFFSET $3`,[ctx.companyId,actor,(page-1)*50,ctx.permissions.includes('products:cost:view'),ctx.permissions.includes('inventory:cost:view'),ctx.permissions.includes('customers:view')])).rows);}
}
@Module({controllers:[ApiController,ControlController,HealthController,InventoryController,CustomerController],providers:[CustomerAmendmentService,CustomerService,InventoryAdjustmentService,ProductConfigurationService,ProductReferencesService,TaxConfigurationService,PostingRuleConfigurationService,NumberingConfigurationService,HealthService,CoaService,OrganizationService,Db,AuthService,CommandService,WorkflowService,AccountingService,AdminService,SecurityService]})
export class AppModule{}
export async function bootstrap(port=Number(process.env.PORT??3000)){
 previewMemorySessionsEnabled();
 sessionCookieOptions(); // Fail closed before listening if deployment cookies are unsafe.
 const app=await NestFactory.create(AppModule,{logger:['error','warn','log']});
 app.use(helmet());app.use(cookieParser());app.use((req:any,res:any,next:any)=>{req.requestId=requestId();res.setHeader('X-Request-ID',req.requestId);res.setHeader('Cache-Control','no-store');const started=Date.now();if(process.env.LOG_HTTP_REQUESTS==='true')res.on('finish',()=>console.log(JSON.stringify({event:'http_request',requestId:req.requestId,method:req.method,route:req.route?.path??'UNMATCHED',status:res.statusCode,durationMs:Date.now()-started,actorId:req.authenticatedUserId??null})));next();});app.useGlobalFilters(new Errors(app.get(Db)));
 // Same-origin Next/reverse-proxy traffic only: no permissive CORS.
 await app.listen(port,'0.0.0.0');return app;
}
if(require.main===module)bootstrap();
