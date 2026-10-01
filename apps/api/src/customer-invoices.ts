import {Inject,Injectable,Controller,Post,Get,Param,Body,Req} from '@nestjs/common';
import {Request} from 'express';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {Db,Context,BusinessError,audit,event} from './db';
import {AuthService} from './auth';
import {CommandService} from './commands';
import {ProductConfigurationService} from './product-configuration';
import {WorkflowService} from './workflow';
import {allocateDocumentNumber} from './numbering';
import {customerDueDate} from './customer-credit';

const uuid=z.string().uuid();
const date=z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'Invalid Gregorian date');
const quantity=z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,6})?$/);
const invoicePage=z.object({q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
export const serviceInvoiceDraft=z.object({warehouseId:uuid,customerId:uuid,productId:uuid,quantity,date,reason:z.string().trim().min(5).max(500)}).strict();
export const serviceInvoiceSubmit=z.object({expectedRevision:z.number().int().positive(),reason:z.string().trim().min(5).max(500)}).strict();

@Injectable()
export class CustomerInvoiceService {
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService,@Inject(ProductConfigurationService) private products:ProductConfigurationService,@Inject(WorkflowService) private workflow:WorkflowService){}
 async createDraft(ctx:Context,key:string|undefined,body:unknown){
  const v=serviceInvoiceDraft.parse(body);
  return this.commands.run(ctx,key,'customer-invoice.create',v,async c=>{
   const warehouse=(await c.query(`SELECT id,branch_id,location_type FROM warehouses
    WHERE company_id=$1 AND id=$2 AND active FOR SHARE`,[ctx.companyId,v.warehouseId])).rows[0];
   if(!warehouse||warehouse.location_type!=='SELLABLE')throw new BusinessError('INVOICE_WAREHOUSE','Choose an active sellable warehouse.');
   if(!ctx.branches.includes(warehouse.branch_id))throw new BusinessError('BRANCH_SCOPE','Warehouse branch is outside your assigned scope.',403);
   const customer=(await c.query(`SELECT cu.id,cu.number,cu.customer_type,cu.active,cu.credit_hold,
      cu.credit_limit::text AS credit_limit,cu.payment_terms_days,cu.currency,cu.version,
      ca.control_account_id,a.account_type,a.control_type,a.active AS account_active,a.postable,
      EXISTS(SELECT 1 FROM accounts child WHERE child.company_id=a.company_id AND child.parent_id=a.id) AS has_children,
      co.base_currency
    FROM customers cu JOIN customer_accounts ca ON ca.company_id=cu.company_id AND ca.customer_id=cu.id
    JOIN accounts a ON a.company_id=ca.company_id AND a.id=ca.control_account_id
    JOIN companies co ON co.id=cu.company_id
    WHERE cu.company_id=$1 AND cu.id=$2 AND cu.publication_request_id IS NOT NULL
    FOR SHARE OF cu,a`,[ctx.companyId,v.customerId])).rows[0];
   if(!customer||!customer.active||customer.customer_type!=='REGISTERED')throw new BusinessError('INVOICE_CUSTOMER','Choose an active governed registered customer.');
   if(customer.credit_hold||customer.credit_limit==='0.00'||customer.credit_limit==='0')throw new BusinessError('CREDIT_POLICY','Customer hold or zero credit limit prevents credit invoicing.');
   if(customer.currency!==customer.base_currency)throw new BusinessError('INVOICE_CURRENCY','Foreign-currency customer invoices are not enabled.');
   if(customer.account_type!=='ASSET'||customer.control_type!=='AR'||!customer.account_active||!customer.postable||customer.has_children)throw new BusinessError('CUSTOMER_AR_BINDING','Customer requires an active same-company postable AR leaf binding.');
   const resolved=await this.products.resolveServiceInvoiceProduct(c,ctx,v.productId,{date:v.date,quantity:v.quantity});
   if(resolved.currency!==customer.base_currency)throw new BusinessError('INVOICE_CURRENCY','Invoice product and customer must use the company functional currency.');
   const taxCalc=resolved.taxResult.calculation;
   const outputAccounts=[...new Set(taxCalc.snapshot.input.rates.map((r:any)=>r.outputAccountId).filter(Boolean))];
   if(outputAccounts.length>1)throw new BusinessError('INVOICE_TAX_MAPPING','This first invoice contract requires all effective tax components to share one output-tax control account.');
   const dueDate=customerDueDate(v.date,customer.payment_terms_days);
   const number=await allocateDocumentNumber(c,ctx,warehouse.branch_id,'SERVICE_CREDIT_INVOICE',v.date);
   // Draft JSON contains only user-selected identities and quantity. It is not a
   // posted amount or tax authority; submission resolves current governed values
   // again and freezes its own typed valuation snapshot.
   const payload={warehouseId:v.warehouseId,customerId:v.customerId,productId:v.productId,quantity:taxCalc.snapshot.input.quantity};
   const doc=(await c.query(`INSERT INTO source_documents(company_id,branch_id,document_type,document_number,business_date,currency,description,payload,created_by,initiated_by)
    VALUES($1,$2,'SERVICE_CREDIT_INVOICE',$3,$4,$5,$6,$7::jsonb,$8,$8) RETURNING id,document_number,status,revision`,
   [ctx.companyId,warehouse.branch_id,number,v.date,customer.base_currency,v.reason,JSON.stringify(payload),ctx.userId])).rows[0];
   await event(c,ctx,doc.id,'CREATE',null,'DRAFT',doc.revision,v.reason);
   await audit(c,ctx,'CREATE',doc.id,{documentType:'SERVICE_CREDIT_INVOICE',documentNumber:doc.document_number,branchId:warehouse.branch_id,customerId:customer.id,productId:resolved.productId,quantity:taxCalc.snapshot.input.quantity},v.reason,'SERVICE_CREDIT_INVOICE',doc.id);
   // Current informational valuation only: deliberately not stored as the
   // future invoice's immutable submitted valuation snapshot.
   return {id:doc.id,documentNumber:doc.document_number,status:doc.status,revision:doc.revision,amountPreview:{currency:customer.base_currency,net:taxCalc.net,tax:taxCalc.tax,gross:taxCalc.gross,dueDate}};
  },true);
 }
 async submitDraft(ctx:Context,key:string|undefined,id:string,body:unknown){
  uuid.parse(id);const v=serviceInvoiceSubmit.parse(body);
  return this.commands.run(ctx,key,'customer-invoice.submit.'+id,v,async c=>{
   const source=(await c.query('SELECT * FROM source_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];
   if(!source||source.document_type!=='SERVICE_CREDIT_INVOICE')throw new BusinessError('NOT_FOUND','Service credit invoice draft not found.',404);
   if(!ctx.branches.includes(source.branch_id))throw new BusinessError('BRANCH_SCOPE','Invoice branch is outside your assigned scope.',403);
   if(source.created_by!==ctx.userId)throw new BusinessError('CREATOR_ONLY','Only the original creator may submit this invoice draft.',403);
   if(source.status!=='DRAFT')throw new BusinessError('STATE_CONFLICT',`Expected DRAFT; invoice is ${source.status}.`,409);
   if(source.revision!==v.expectedRevision)throw new BusinessError('VERSION_CONFLICT','Invoice draft changed. Reload before submission.',409);
   const input=z.object({warehouseId:uuid,customerId:uuid,productId:uuid,quantity}).strict().parse(source.payload);
   const warehouse=(await c.query(`SELECT id,branch_id,location_type FROM warehouses WHERE company_id=$1 AND id=$2 AND active FOR SHARE`,[ctx.companyId,input.warehouseId])).rows[0];
   if(!warehouse||warehouse.branch_id!==source.branch_id||warehouse.location_type!=='SELLABLE')throw new BusinessError('INVOICE_WAREHOUSE','The invoice warehouse is no longer active and sellable in its source branch.');
   const customer=(await c.query(`SELECT cu.id,cu.number,cu.name,cu.customer_type,cu.active,cu.credit_hold,cu.credit_limit::text AS credit_limit,
      cu.payment_terms_days,cu.currency,cu.version,ca.control_account_id,a.account_type,a.control_type,a.active AS account_active,a.postable,
      EXISTS(SELECT 1 FROM accounts child WHERE child.company_id=a.company_id AND child.parent_id=a.id) AS has_children,co.base_currency
    FROM customers cu JOIN customer_accounts ca ON ca.company_id=cu.company_id AND ca.customer_id=cu.id
    JOIN accounts a ON a.company_id=ca.company_id AND a.id=ca.control_account_id JOIN companies co ON co.id=cu.company_id
    WHERE cu.company_id=$1 AND cu.id=$2 AND cu.publication_request_id IS NOT NULL FOR SHARE OF cu,a`,[ctx.companyId,input.customerId])).rows[0];
   if(!customer||!customer.active||customer.customer_type!=='REGISTERED')throw new BusinessError('INVOICE_CUSTOMER','Choose an active governed registered customer.');
   if(customer.credit_hold||customer.credit_limit==='0.00'||customer.credit_limit==='0')throw new BusinessError('CREDIT_POLICY','Customer hold or zero credit limit prevents credit invoicing.');
   if(customer.currency!==customer.base_currency||source.currency!==customer.base_currency)throw new BusinessError('INVOICE_CURRENCY','Foreign-currency customer invoices are not enabled.');
   if(customer.account_type!=='ASSET'||customer.control_type!=='AR'||!customer.account_active||!customer.postable||customer.has_children)throw new BusinessError('CUSTOMER_AR_BINDING','Customer requires an active same-company postable AR leaf binding.');
   const period=(await c.query(`SELECT id FROM financial_periods WHERE company_id=$1 AND $2::date BETWEEN starts_on AND ends_on AND status='OPEN' FOR SHARE`,[ctx.companyId,source.business_date])).rows[0];
   if(!period)throw new BusinessError('PERIOD_CLOSED','The invoice date must fall in an open financial period.');
   const resolved=await this.products.resolveServiceInvoiceProduct(c,ctx,input.productId,{date:source.business_date,quantity:input.quantity});
   if(resolved.currency!==customer.base_currency)throw new BusinessError('INVOICE_CURRENCY','Invoice product must use the company functional currency.');
   const calc=resolved.taxResult.calculation,taxSnapshot=calc.snapshot;
   const grossCents=BigInt(calc.gross.replace('.','')),netCents=BigInt(calc.net.replace('.',''));if(grossCents<=0n||netCents<=0n)throw new BusinessError('INVOICE_ZERO','A submitted service invoice must have positive net and gross values.');
   const outputAccounts=[...new Set(taxSnapshot.input.rates.map((r:any)=>r.outputAccountId).filter(Boolean))];
   if(outputAccounts.length>1)throw new BusinessError('INVOICE_TAX_MAPPING','This first invoice contract requires all effective tax components to share one output-tax control account.');
   const dueDate=customerDueDate(source.business_date,customer.payment_terms_days);
   const approval=await this.workflow.snapshot(c,ctx,source,calc.gross,'customer-invoices:approve');
   const valuation=(await c.query(`INSERT INTO customer_invoice_valuations(company_id,source_id,source_revision,warehouse_id,customer_id,customer_number,customer_name,customer_version,customer_credit_limit,customer_credit_hold,customer_payment_terms_days,control_account_id,product_id,product_sku,product_code,product_name,product_category_id,product_brand_id,uom_id,product_profile_id,quantity_scale,quantity,unit_price,discount,price_mode,net,tax,gross,currency,due_date,tax_snapshot,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,0,$24,$25,$26,$27,$28,$29,$30::jsonb,$31) RETURNING id`,
   [ctx.companyId,source.id,source.revision,input.warehouseId,customer.id,customer.number,customer.name,customer.version,customer.credit_limit,customer.credit_hold,customer.payment_terms_days,customer.control_account_id,resolved.productId,resolved.sku,resolved.productCode,resolved.name,resolved.categoryId,resolved.brandId,resolved.uomId,resolved.profileId,resolved.quantityScale,taxSnapshot.input.quantity,resolved.unitPrice,resolved.priceMode,calc.net,calc.tax,calc.gross,customer.base_currency,dueDate,JSON.stringify(taxSnapshot),ctx.userId])).rows[0];
   await c.query(`UPDATE source_documents SET status='PENDING_APPROVAL',approval_snapshot=$3,updated_by=$4,updated_at=now() WHERE company_id=$1 AND id=$2`,[ctx.companyId,source.id,JSON.stringify(approval),ctx.userId]);
   await event(c,ctx,source.id,'SUBMIT','DRAFT','PENDING_APPROVAL',source.revision,v.reason);
   await audit(c,ctx,'SUBMIT',source.id,{from:'DRAFT',to:'PENDING_APPROVAL',revision:source.revision,valuationId:valuation.id,currency:customer.base_currency,net:calc.net,tax:calc.tax,gross:calc.gross,dueDate},v.reason,'SERVICE_CREDIT_INVOICE',source.id);
   return {id:source.id,documentNumber:source.document_number,status:'PENDING_APPROVAL',revision:source.revision,valuation:{currency:customer.base_currency,net:calc.net,tax:calc.tax,gross:calc.gross,dueDate}};
  },true);
 }
 async list(ctx:Context,query:unknown){const v=invoicePage.parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,ctx.branches,'%'+v.q+'%'],where="s.company_id=$1 AND s.document_type='SERVICE_CREDIT_INVOICE' AND s.branch_id=ANY($2::uuid[]) AND (s.document_number ILIKE $3 OR s.description ILIKE $3)";
  const total=Number((await c.query(`SELECT count(*)::int n FROM source_documents s WHERE ${where}`,args)).rows[0].n);
  const data=(await c.query(`SELECT s.id,s.branch_id,s.document_number,s.status,s.revision,s.business_date,s.currency,s.description,s.payload,s.created_at,s.created_by
    FROM source_documents s WHERE ${where} ORDER BY s.created_at DESC,s.id LIMIT $4 OFFSET $5`,[...args,v.limit,(v.page-1)*v.limit])).rows;
  return {data,total,page:v.page,limit:v.limit};
 });}
 async detail(ctx:Context,id:string){uuid.parse(id);return this.db.transaction(ctx,async c=>{
  const row=(await c.query(`SELECT s.id,s.branch_id,s.document_number,s.status,s.revision,s.business_date,s.currency,s.description,s.payload,s.created_at,s.created_by,
    CASE WHEN v.source_id IS NULL THEN NULL ELSE jsonb_build_object('sourceRevision',v.source_revision,'warehouseId',v.warehouse_id,'customer',jsonb_build_object('id',v.customer_id,'number',v.customer_number,'name',v.customer_name),'product',jsonb_build_object('id',v.product_id,'sku',v.product_sku,'productCode',v.product_code,'name',v.product_name),'quantity',v.quantity::text,'unitPrice',v.unit_price::text,'priceMode',v.price_mode,'net',v.net::text,'tax',v.tax::text,'gross',v.gross::text,'currency',v.currency,'dueDate',v.due_date,'taxSnapshot',v.tax_snapshot) END AS valuation,
    CASE WHEN v.source_id IS NOT NULL AND $4::boolean THEN jsonb_build_object('customerVersion',v.customer_version,'creditLimit',v.customer_credit_limit::text,'creditHold',v.customer_credit_hold,'paymentTermsDays',v.customer_payment_terms_days,'controlAccountId',v.control_account_id) END AS creditPolicySnapshot
    FROM source_documents s LEFT JOIN customer_invoice_valuations v ON v.company_id=s.company_id AND v.source_id=s.id AND v.source_revision=s.revision
    WHERE s.company_id=$1 AND s.id=$2 AND s.document_type='SERVICE_CREDIT_INVOICE' AND s.branch_id=ANY($3::uuid[])`,[ctx.companyId,id,ctx.branches,ctx.permissions.includes('customer-invoices:credit:view')])).rows[0];
  if(!row)throw new BusinessError('NOT_FOUND','Service credit invoice draft not found.',404);
  return row;
 });}
}

@Controller('api/v1/customer-invoices')
export class CustomerInvoiceController {
 constructor(@Inject(AuthService) private auth:AuthService,@Inject(CustomerInvoiceService) private invoices:CustomerInvoiceService){}
 @Get() async list(@Req() req:Request){return this.invoices.list(await this.auth.context(req,'customer-invoices:view'),req.query);}
 @Get(':id') async detail(@Param('id') id:string,@Req() req:Request){return this.invoices.detail(await this.auth.context(req,'customer-invoices:view'),id);}
 @Post() async create(@Body() body:unknown,@Req() req:Request){return this.invoices.createDraft(await this.auth.context(req,'customer-invoices:create',true),req.header('Idempotency-Key'),body);}
 @Post(':id/submit') async submit(@Param('id') id:string,@Body() body:unknown,@Req() req:Request){return this.invoices.submitDraft(await this.auth.context(req,'customer-invoices:submit',true),req.header('Idempotency-Key'),id,body);}
}
