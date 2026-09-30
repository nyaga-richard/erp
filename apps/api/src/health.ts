import {Controller,Get,Inject,Injectable,Res} from '@nestjs/common';
import {Response} from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {writeFile,unlink,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Db} from './db';
export function migrationManifest(){const dir=resolve(__dirname,'../../../db');return readdirSync(dir).filter(name=>/^\d+.*\.sql$/.test(name)).sort().map(name=>({name,checksum:createHash('sha256').update(readFileSync(join(dir,name))).digest('hex')}));}
@Injectable()
export class HealthService{
 constructor(@Inject(Db) private db:Db){}
 live(){return {status:'alive',service:'erp-api'};}
 async ready(env:Record<string,string|undefined>=process.env){
  const checks:Record<string,string>={database:'failed',migrations:'failed',worker:env.REQUIRE_AUTH_WORKER==='true'?'failed':'not_required',storage:env.REQUIRE_FILE_STORAGE==='true'?'failed':'not_required',redis:'not_required'};
  try{await this.db.pool.query('SELECT 1 AS ok');checks.database='ok';
   const applied=(await this.db.pool.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows,expected=migrationManifest();
   if(applied.length===expected.length&&expected.every((e,i)=>applied[i].name===e.name&&applied[i].checksum===e.checksum))checks.migrations='ok';
   if(env.REQUIRE_AUTH_WORKER==='true'){const row=(await this.db.pool.query("SELECT last_seen_at>now()-interval '60 seconds' AND last_seen_at<=now()+interval '5 seconds' AS fresh FROM service_heartbeats WHERE service_name='auth-mail'")).rows[0];if(row?.fresh)checks.worker='ok';}
  }catch{/* Readiness is public: never return SQL, stack traces or connection details. */}
  if(env.REQUIRE_FILE_STORAGE==='true'&&env.FILE_STORAGE_ROOT){let probe:string|undefined;try{const root=await realpath(env.FILE_STORAGE_ROOT);probe=join(root,'.health-'+randomUUID());await writeFile(probe,'probe',{flag:'wx',mode:0o600});await unlink(probe);probe=undefined;checks.storage='ok';}catch{}finally{if(probe)await unlink(probe).catch(()=>{});}}
  const ready=Object.values(checks).every(v=>v==='ok'||v==='not_required');return {ready,status:ready?'ready':'not_ready',checks,productionReady:false};
 }
}
@Controller('api/health')
export class HealthController{
 constructor(@Inject(HealthService) private health:HealthService){}
 @Get('live') live(){return this.health.live();}
 @Get() root(@Res({passthrough:true}) res:Response){return this.readiness(res);}
 @Get('ready') async readiness(@Res({passthrough:true}) res:Response){const result=await this.health.ready();res.status(result.ready?200:503);return result;}
}
