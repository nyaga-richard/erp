import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import {Db,Context,BusinessError,audit} from './db';
import {CommandService} from './commands';
const name=z.string().trim().min(2).max(120),reason=z.string().trim().min(5).max(500);
const create=z.object({code:z.string().trim().min(2).max(24).regex(/^[A-Z0-9][A-Z0-9_-]*$/),name,reason}).strict();
const revise=z.object({name,active:z.boolean(),expectedVersion:z.number().int().positive(),reason}).strict();
const pageInput=z.object({q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
@Injectable()
export class OrganizationService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService){}
 async company(ctx:Context){return this.db.transaction(ctx,async c=>{
  const row=(await c.query('SELECT co.id,co.code,co.name,co.tax_pin,co.base_currency,co.timezone,co.active,co.version,co.created_by,co.created_at,co.updated_by,co.updated_at,u.display_name AS creator,e.display_name AS editor FROM companies co JOIN users u ON u.id=co.created_by LEFT JOIN users e ON e.id=co.updated_by WHERE co.id=$1',[ctx.companyId])).rows[0];
  if(!row)throw new BusinessError('NOT_FOUND','Company not found.',404);return row;
 });}
 async reviseCompany(ctx:Context,key:string|undefined,body:unknown){
  const v=z.object({name,expectedVersion:z.number().int().positive(),reason}).strict().parse(body);
  return this.commands.run(ctx,key,'organization.company.revise',v,async c=>{
   const before=(await c.query('SELECT * FROM companies WHERE id=$1 FOR UPDATE',[ctx.companyId])).rows[0];
   if(before.version!==v.expectedVersion)throw new BusinessError('VERSION_CONFLICT','Company profile changed. Reload before editing.',409);
   const after=(await c.query('UPDATE companies SET name=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *',[ctx.companyId,v.name,ctx.userId])).rows[0];
   await audit(c,ctx,'COMPANY_REVISE',null,{before,after},v.reason,'COMPANY',ctx.companyId);return {id:ctx.companyId,name:after.name,version:after.version};
  },true);
 }
 async warehouseBranches(ctx:Context,query:unknown){const v=pageInput.parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`],where='company_id=$1 AND active AND (code ILIKE $2 OR name ILIKE $2)';
  return {data:(await c.query(`SELECT id,code,name FROM branches WHERE ${where} ORDER BY code,id LIMIT $3 OFFSET $4`,[...args,v.limit,(v.page-1)*v.limit])).rows,total:(await c.query(`SELECT count(*)::int AS n FROM branches WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async warehouses(ctx:Context,query:unknown){const v=pageInput.extend({branchId:z.string().uuid().optional()}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const args=[ctx.companyId,`%${v.q}%`,v.branchId??null],where='w.company_id=$1 AND (w.code ILIKE $2 OR w.name ILIKE $2) AND ($3::uuid IS NULL OR w.branch_id=$3)';
  const rows=(await c.query(`SELECT w.*,b.code AS branch_code,b.name AS branch_name,b.active AS branch_active,u.display_name AS creator,e.display_name AS editor FROM warehouses w JOIN branches b ON b.company_id=w.company_id AND b.id=w.branch_id JOIN users u ON u.id=w.created_by LEFT JOIN users e ON e.id=w.updated_by WHERE ${where} ORDER BY w.code,w.id LIMIT $4 OFFSET $5`,[...args,v.limit,(v.page-1)*v.limit])).rows;
  const total=(await c.query(`SELECT count(*)::int AS n FROM warehouses w WHERE ${where}`,args)).rows[0].n;return {data:rows,total,page:v.page,limit:v.limit};
 });}
 async createWarehouse(ctx:Context,key:string|undefined,body:unknown){
  const v=z.object({branchId:z.string().uuid(),code:create.shape.code,name,locationType:z.enum(['SELLABLE','TRANSIT','QUARANTINE','DAMAGED','RETURNS']),reason}).strict().parse(body);
  return this.commands.run(ctx,key,'organization.warehouse.create',v,async c=>{
   if(!(await c.query('SELECT 1 FROM branches WHERE company_id=$1 AND id=$2 AND active FOR SHARE',[ctx.companyId,v.branchId])).rowCount)throw new BusinessError('BRANCH_UNAVAILABLE','Choose an active branch in this company.');
   const after=(await c.query('INSERT INTO warehouses(company_id,branch_id,code,name,location_type,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[ctx.companyId,v.branchId,v.code,v.name,v.locationType,ctx.userId])).rows[0];
   await audit(c,ctx,'WAREHOUSE_CREATE',null,{before:null,after},v.reason,'WAREHOUSE',after.id);return {id:after.id,version:after.version};
  },true);
 }
 async reviseWarehouse(ctx:Context,key:string|undefined,id:string,body:unknown){
  z.string().uuid().parse(id);const v=revise.parse(body);return this.commands.run(ctx,key,'organization.warehouse.revise.'+id,v,async c=>{
   const before=(await c.query('SELECT * FROM warehouses WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];
   if(!before)throw new BusinessError('NOT_FOUND','Warehouse not found.',404);
   if(before.version!==v.expectedVersion)throw new BusinessError('VERSION_CONFLICT','Warehouse changed. Reload before editing.',409);
   if(v.active&&!(await c.query('SELECT 1 FROM branches WHERE company_id=$1 AND id=$2 AND active FOR SHARE',[ctx.companyId,before.branch_id])).rowCount)throw new BusinessError('BRANCH_UNAVAILABLE','Reactivate the parent branch before activating its warehouse.');
   if(before.active&&!v.active&&(await c.query('SELECT warehouse_has_dependencies($1) AS used',[id])).rows[0].used)throw new BusinessError('WAREHOUSE_IN_USE','This warehouse has operational references. Closure is blocked until the connected operational close workflow is implemented.');
   const after=(await c.query('UPDATE warehouses SET name=$3,active=$4,version=version+1,updated_by=$5,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING *',[ctx.companyId,id,v.name,v.active,ctx.userId])).rows[0];
   await audit(c,ctx,'WAREHOUSE_REVISE',null,{before,after},v.reason,'WAREHOUSE',id);return {id,version:after.version,active:after.active};
  },true);
 }
 async branches(ctx:Context,query:unknown){
  const v=z.object({q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict().parse(query);
  return this.db.transaction(ctx,async c=>{
   const args=[ctx.companyId,`%${v.q}%`];
   const total=(await c.query('SELECT count(*)::int AS n FROM branches WHERE company_id=$1 AND (code ILIKE $2 OR name ILIKE $2)',args)).rows[0].n;
   const rows=(await c.query(`SELECT b.id,b.code,b.name,b.active,b.version,b.created_by,b.created_at,b.updated_by,b.updated_at,u.display_name AS creator,e.display_name AS editor FROM branches b JOIN users u ON u.id=b.created_by LEFT JOIN users e ON e.id=b.updated_by WHERE b.company_id=$1 AND (b.code ILIKE $2 OR b.name ILIKE $2) ORDER BY b.code,b.id LIMIT $3 OFFSET $4`,[...args,v.limit,(v.page-1)*v.limit])).rows;
   return {data:rows,total,page:v.page,limit:v.limit};
  });
 }
 async create(ctx:Context,key:string|undefined,body:unknown){
  const v=create.parse(body);return this.commands.run(ctx,key,'organization.branch.create',v,async c=>{
   const row=(await c.query('INSERT INTO branches(company_id,code,name,created_by) VALUES($1,$2,$3,$4) RETURNING *',[ctx.companyId,v.code,v.name,ctx.userId])).rows[0];
   await audit(c,ctx,'BRANCH_CREATE',null,{before:null,after:row},v.reason,'BRANCH',row.id);return {id:row.id,version:row.version};
  },true);
 }
 async revise(ctx:Context,key:string|undefined,id:string,body:unknown){
  z.string().uuid().parse(id);const v=revise.parse(body);return this.commands.run(ctx,key,'organization.branch.revise.'+id,v,async c=>{
   const before=(await c.query('SELECT * FROM branches WHERE company_id=$1 AND id=$2 FOR UPDATE',[ctx.companyId,id])).rows[0];
   if(!before)throw new BusinessError('NOT_FOUND','Branch not found.',404);
   if(before.version!==v.expectedVersion)throw new BusinessError('VERSION_CONFLICT','Branch changed. Reload before editing.',409);
   if(before.active&&!v.active){
    const dependency=await c.query("SELECT 1 FROM source_documents WHERE company_id=$1 AND branch_id=$2 AND status NOT IN ('POSTED','CANCELLED') UNION ALL SELECT 1 FROM warehouses WHERE company_id=$1 AND branch_id=$2 AND active LIMIT 1",[ctx.companyId,id]);
    if(dependency.rowCount)throw new BusinessError('BRANCH_IN_USE','Resolve unposted documents and active warehouses before deactivating this branch.');
   }
   const after=(await c.query('UPDATE branches SET name=$3,active=$4,version=version+1,updated_by=$5,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING *',[ctx.companyId,id,v.name,v.active,ctx.userId])).rows[0];
   await audit(c,ctx,'BRANCH_REVISE',null,{before,after},v.reason,'BRANCH',id);return {id,version:after.version,active:after.active};
  },true);
 }
}
