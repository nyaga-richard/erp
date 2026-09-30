import 'dotenv/config';
import { config } from 'dotenv';
import { Injectable } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
types.setTypeParser(1082, value=>value); // Business dates stay dates, not timezone-shifted JS Date objects.
import { randomUUID } from 'node:crypto';
config({path: '../../.env'});
export type Context={userId:string;companyId:string;sessionId:string;ip:string;device:string;requestId:string;permissions:string[];branches:string[];requiredPermission?:string};
export class BusinessError extends Error { constructor(public code:string,message:string, public status=422){super(message);} }
@Injectable()
export class Db {
 readonly pool=new Pool({connectionString:process.env.DATABASE_URL, max:12,connectionTimeoutMillis:2000,statement_timeout:15000,query_timeout:17000});
 async transaction<T>(ctx:Pick<Context,'userId'|'companyId'>, fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();
  try{await c.query('BEGIN'); await c.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true)",[ctx.userId,ctx.companyId]); const value=await fn(c); await c.query('COMMIT'); return value;}
  catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
 }
}
export async function audit(c:PoolClient,ctx:Context,action:string,sourceId:string|null,values:unknown,reason?:string,entityType='SOURCE_DOCUMENT',entityId=sourceId){
 await c.query(`INSERT INTO audit_logs(company_id,actor_id,action,module,entity_type,entity_id,source_id,request_id,session_id,ip,device,new_values,reason) VALUES($1,$2,$3,'CORE',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[ctx.companyId,ctx.userId,action,entityType,entityId,sourceId,ctx.requestId,ctx.sessionId,ctx.ip,ctx.device,JSON.stringify(values),reason??null]);
}
export async function event(c:PoolClient,ctx:Context,id:string,action:string,from:string|null,to:string,revision:number,reason?:string){
 await c.query(`INSERT INTO document_events(company_id,source_id,actor_id,action,old_status,new_status,revision,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[ctx.companyId,id,ctx.userId,action,from,to,revision,reason??null]);
}
export function requestId(){return randomUUID();}
