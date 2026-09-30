import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HealthService,migrationManifest} from '../src/health';

test('liveness is independent of database connectivity',()=>{const h=new HealthService({pool:{query:async()=>{throw Error('secret connection detail')}}} as any);assert.equal(h.live().status,'alive');});
test('readiness checks exact migration manifest and required worker heartbeat',async()=>{
 const manifest=migrationManifest();const db={pool:{query:async(sql:string)=>({rows:sql.includes('schema_migrations')?manifest:sql.includes('service_heartbeats')?[{fresh:true}]:[{ok:1}]})}};
 const h=new HealthService(db as any);const r=await h.ready({REQUIRE_AUTH_WORKER:'true'});assert.equal(r.ready,true);assert.equal(r.checks.worker,'ok');
 const missing=new HealthService({pool:{query:async(sql:string)=>({rows:sql.includes('schema_migrations')?manifest.slice(1):[{ok:1}]})}} as any);
 assert.equal((await missing.ready({})).ready,false);
 const stale=new HealthService({pool:{query:async(sql:string)=>({rows:sql.includes('schema_migrations')?manifest:sql.includes('service_heartbeats')?[{fresh:false}]:[{ok:1}]})}} as any);
 assert.equal((await stale.ready({REQUIRE_AUTH_WORKER:'true'})).ready,false);
});
test('database errors fail readiness without exposing credentials',async()=>{const h=new HealthService({pool:{query:async()=>{throw Error('postgres://secret:password@private')}}} as any);const r=await h.ready({});assert.equal(r.ready,false);assert.ok(!JSON.stringify(r).includes('secret'));});
test('storage readiness actually writes and deletes a probe; missing required storage fails',async()=>{const root=await mkdtemp(join(tmpdir(),'erp-health-'));try{const h=new HealthService({pool:{query:async(sql:string)=>({rows:sql.includes('schema_migrations')?migrationManifest():[{ok:1}]})}} as any);assert.equal((await h.ready({REQUIRE_FILE_STORAGE:'true',FILE_STORAGE_ROOT:root})).checks.storage,'ok');assert.equal((await h.ready({REQUIRE_FILE_STORAGE:'true'})).ready,false);}finally{await rm(root,{recursive:true,force:true});}});

test('HTTP liveness stays 200 while real unavailable database makes readiness 503',async()=>{
 const {bootstrap}=await import('../src/main');const {Db}=await import('../src/db');const old=process.env.DATABASE_URL;process.env.DATABASE_URL='postgresql://unavailable@127.0.0.1:65431/unavailable';let app:any;
 try{app=await bootstrap(0);const url='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/health';assert.equal((await fetch(url+'/live')).status,200);const r=await fetch(url+'/ready');assert.equal(r.status,503);assert.equal((await r.json()).checks.database,'failed');assert.equal((await fetch(url)).status,503);assert.equal((await fetch(url.replace('/api/health','/api/v1/health'))).status,503);}finally{if(app){await app.get(Db).pool.end();await app.close();}if(old===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old;}
});
