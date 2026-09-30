import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import {Db,Context,audit} from './db';
import {CommandService} from './commands';
const kind=z.enum(['UNIT','CATEGORY','BRAND']),code=z.string().regex(/^[A-Z][A-Z0-9_-]{0,31}$/),name=z.string().trim().min(2).max(120),reason=z.string().trim().min(5).max(500);
const tables={UNIT:'units_of_measure',CATEGORY:'product_categories',BRAND:'brands'} as const;
const proposal=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('UNIT'),code,name,quantityScale:z.number().int().min(0).max(6),reason}).strict(),
 z.object({kind:z.literal('CATEGORY'),code,name,parentId:z.string().uuid().nullable().default(null),reason}).strict(),
 z.object({kind:z.literal('BRAND'),name,reason}).strict()
]);
@Injectable()
export class ProductReferencesService{
 constructor(@Inject(Db) private db:Db,@Inject(CommandService) private commands:CommandService){}
 async list(ctx:Context,query:unknown){const v=z.object({kind,q:z.string().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict().parse(query);return this.db.transaction(ctx,async c=>{
  const table=tables[v.kind],where=`r.company_id=$1 AND r.catalog_version=1 AND (r.name ILIKE $2${v.kind==='BRAND'?'':' OR r.code ILIKE $2'})`,args=[ctx.companyId,'%'+v.q+'%'];
  return {data:(await c.query(`SELECT r.*,u.display_name AS creator${v.kind==='BRAND'?',r.name AS code':''}${v.kind==='CATEGORY'?',p.name AS parent_name':''} FROM ${table} r JOIN users u ON u.id=r.created_by ${v.kind==='CATEGORY'?'LEFT JOIN product_categories p ON p.company_id=r.company_id AND p.id=r.parent_id':''} WHERE ${where} ORDER BY r.name,r.id LIMIT $3 OFFSET $4`,[...args,v.limit,(v.page-1)*v.limit])).rows,total:(await c.query(`SELECT count(*)::int n FROM ${table} r WHERE ${where}`,args)).rows[0].n,page:v.page,limit:v.limit};
 });}
 async create(ctx:Context,key:string|undefined,body:unknown){const v=proposal.parse(body);return this.commands.run(ctx,key,'products.reference.create',v,async c=>{
  const table=tables[v.kind],columns=['company_id','created_by','name','catalog_version',...(v.kind==='UNIT'?['code','quantity_scale']:v.kind==='CATEGORY'?['code','parent_id']:[])],values=[ctx.companyId,ctx.userId,v.name,1,...(v.kind==='UNIT'?[v.code,v.quantityScale]:v.kind==='CATEGORY'?[v.code,v.parentId]:[])];
  const row=(await c.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING to_jsonb(${table}) AS snapshot`,values)).rows[0].snapshot;
  await audit(c,ctx,'PRODUCT_REFERENCE_CREATE',null,{before:null,after:row,kind:v.kind},v.reason,'PRODUCT_REFERENCE',row.id);return {id:row.id,kind:v.kind};
 },true);}
}
