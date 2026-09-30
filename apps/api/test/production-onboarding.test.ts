import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const onboarding=require('../../../scripts/bootstrap-production.cjs');

const input={companyCode:'acme_ke',companyName:'Acme Kenya Limited',baseCurrency:'kes',branchCode:'hq',branchName:'Nairobi Head Office',adminName:'Admin User',adminEmail:'ADMIN@EXAMPLE.TEST'};
const permissions=['workspace:view','users:view','users:manage','roles:view','roles:manage','organization:view','organization:manage','organization:profile:manage','warehouses:view','warehouses:manage','approvals:view','approvals:manage','audit:view','security:view','accounts:configuration:view','accounts:propose','customers:propose','customers:approve','inventory:post','periods:close'];

function productionEnv(){
 const before={...process.env};Object.assign(process.env,{NODE_ENV:'production',MIGRATION_DATABASE_URL:'postgresql://erp_owner:never-use-this-example@db/erp',AUTH_MAIL_MODE:'smtp',SMTP_URL:'smtp://mail.example.test',SMTP_FROM:'erp@example.test',PUBLIC_WEB_ORIGIN:'https://erp.example.test',RESET_ENCRYPTION_KEY:'a'.repeat(64)});return()=>{for(const key of ['NODE_ENV','MIGRATION_DATABASE_URL','AUTH_MAIL_MODE','SMTP_URL','SMTP_FROM','PUBLIC_WEB_ORIGIN','RESET_ENCRYPTION_KEY']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}};
}

function fakePool({companies=0,marker=false,workerFresh=true,role='erp_owner'}={}){
 const calls:any[]=[];const dir=path.resolve(__dirname,'../../../db');
 const migrations=readdirSync(dir).filter((f:string)=>/^\d+.*\.sql$/.test(f)).sort().map((name:string)=>({name,checksum:createHash('sha256').update(readFileSync(path.join(dir,name))).digest('hex')}));
 const client={
  async query(sql:string,params:any[]=[]){calls.push({sql,params});const q=sql.replace(/\s+/g,' ').trim();
   if(q==='SELECT current_user AS role, current_database() AS database')return {rows:[{role,database:'erp'}],rowCount:1};
   if(q==='SELECT name, checksum FROM schema_migrations')return {rows:migrations,rowCount:migrations.length};
   if(q.startsWith('SELECT 1 FROM users WHERE id=$1 AND principal_type='))return {rows:[{'?column?':1}],rowCount:1};
   if(q==='SELECT singleton FROM production_onboarding WHERE singleton=1')return {rows:marker?[{singleton:1}]:[],rowCount:marker?1:0};
   if(q.startsWith('SELECT (SELECT count(*)'))return {rows:[{companies,memberships:0,humans:0}],rowCount:1};
   if(q.includes("FROM service_heartbeats WHERE service_name='auth-mail'"))return {rows:[{fresh:workerFresh}],rowCount:1};
   if(q.startsWith('SELECT code FROM currencies'))return {rows:[{code:'KES'}],rowCount:1};
   if(q==='SELECT code FROM permissions ORDER BY code')return {rows:permissions.map(code=>({code})),rowCount:permissions.length};
   if(q==='COMMIT'||q==='BEGIN'||q==='ROLLBACK'||q.startsWith('SELECT pg_advisory_xact_lock')||q.startsWith("SELECT set_config"))return {rows:[],rowCount:0};
   if(q.startsWith('INSERT'))return {rows:[],rowCount:1};
   throw new Error('Unexpected SQL in bootstrap test: '+q);
  },release(){calls.push({sql:'RELEASE',params:[]});}
 };
 return {calls,pool:{connect:async()=>client,end:async()=>{}}};
}

test('production bootstrap validates first-company fields and normalizes codes/currency/email',()=>{
 const value=onboarding.validateInputs(input);assert.equal(value.companyCode,'ACME_KE');assert.equal(value.baseCurrency,'KES');assert.equal(value.adminEmail,'admin@example.test');
 assert.throws(()=>onboarding.validateInputs({...input,companyCode:'a'}),/Company code/);
 assert.throws(()=>onboarding.validateInputs({...input,baseCurrency:'GBP'}),/Base currency/);
 assert.throws(()=>onboarding.validateInputs({...input,adminEmail:'not-an-email'}),/valid administrator email/);
});

test('forward migration installs audit:view required for production bootstrap',()=>{
 const migration=readFileSync(path.resolve(__dirname,'../../../db/022-bootstrap-audit-permission.sql'),'utf8');
 assert.match(migration,/INSERT INTO permissions[\s\S]*audit:view/);
 assert.match(migration,/ON CONFLICT \(code\) DO NOTHING/);
});

test('initial admin receives setup/proposal and access rights, never approval/posting rights',()=>{
 const role=onboarding.bootstrapAdminPermissions(permissions);
 assert.ok(role.includes('users:manage'));assert.ok(role.includes('accounts:propose'));assert.ok(role.includes('customers:propose'));
 for(const denied of ['customers:approve','inventory:post','periods:close'])assert.ok(!role.includes(denied),`unexpected bootstrap privilege ${denied}`);
 assert.throws(()=>onboarding.bootstrapAdminPermissions(['workspace:view']),/Required permissions are missing/);
});

test('production bootstrap commits tenant/admin atomically and keeps credentials undisclosed',async()=>{
 const restore=productionEnv();const {pool,calls}=fakePool();
 try{
  const result=await onboarding.bootstrap(input,{pool});assert.match(result.companyId,/^[0-9a-f-]{36}$/);assert.match(result.branchId,/^[0-9a-f-]{36}$/);assert.ok(result.grantedPermissions>0);
  const sql=calls.map(x=>x.sql.replace(/\s+/g,' ').trim());assert.ok(sql.includes('BEGIN'));assert.ok(sql.some(q=>q.startsWith('SELECT pg_advisory_xact_lock')));assert.ok(sql.includes('COMMIT'));assert.ok(!sql.includes('ROLLBACK'));
  const userInsert=calls.find(x=>x.sql.startsWith('INSERT INTO users('));assert.ok(userInsert);assert.match(userInsert.params[3],/^\$argon2id\$/);assert.deepEqual(Object.keys(result).sort(),['branchId','companyId','grantedPermissions','initialAdminId','roleId']);
  assert.ok(sql.some(q=>q.startsWith('INSERT INTO permission_delegations')));assert.ok(sql.some(q=>q.startsWith('INSERT INTO audit_logs')));assert.ok(sql.some(q=>q.startsWith('INSERT INTO production_onboarding')));
 }finally{restore();}
});

test('bootstrap fails closed on an existing company and rolls back before inserts',async()=>{
 const restore=productionEnv();const {pool,calls}=fakePool({companies:1});
 try{
  await assert.rejects(onboarding.bootstrap(input,{pool}),/Database is not pristine/);
  const sql=calls.map(x=>x.sql.replace(/\s+/g,' ').trim());assert.ok(sql.includes('ROLLBACK'));assert.ok(!sql.some(q=>q.startsWith('INSERT INTO users(')));
 }finally{restore();}
});

test('bootstrap refuses an existing marker or stale SMTP worker without creating a user',async()=>{
 const restore=productionEnv();
 try{
  for(const [overrides,message] of [[{marker:true},/already been completed/],[{workerFresh:false},/auth-mail worker is not healthy/]] as const){
   const {pool,calls}=fakePool(overrides);await assert.rejects(onboarding.bootstrap(input,{pool}),message);
   assert.ok(calls.some(x=>x.sql==='ROLLBACK'));assert.ok(!calls.some(x=>x.sql.startsWith('INSERT INTO users(')));
  }
 }finally{restore();}
});

test('bootstrap refuses any database role other than erp_owner',async()=>{
 const restore=productionEnv();const {pool,calls}=fakePool({role:'erp_runtime'});
 try{await assert.rejects(onboarding.bootstrap(input,{pool}),/dedicated erp_owner/);assert.ok(calls.some(x=>x.sql==='ROLLBACK'));assert.ok(!calls.some(x=>x.sql.startsWith('INSERT INTO users(')));}
 finally{restore();}
});

test('production bootstrap rejects development configuration before connecting',async()=>{
 const before={...process.env};process.env.NODE_ENV='development';let connects=0;
 const pool={connect:async()=>{connects++;throw new Error('must not connect');},end:async()=>{}};
 try{await assert.rejects(onboarding.bootstrap(input,{pool}),/only with NODE_ENV=production/);assert.equal(connects,0);}
 finally{for(const key of ['NODE_ENV','MIGRATION_DATABASE_URL','AUTH_MAIL_MODE','SMTP_URL','SMTP_FROM','PUBLIC_WEB_ORIGIN','RESET_ENCRYPTION_KEY']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
