import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const scaffold=require('../../../scripts/seed-company-scaffold.cjs');
const {STARTER_ACCOUNTS}=require('../../../scripts/company-setup-template.cjs');

const company={company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',company_code:'ACME_KE',company_name:'Acme Kenya Limited',company_active:true,branch_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',branch_name:'Nairobi HQ',admin_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',principal_type:'HUMAN',admin_active:true,membership_active:true};
function env(){const before={...process.env};process.env.NODE_ENV='production';process.env.MIGRATION_DATABASE_URL='postgresql://erp_owner:example@db/erp';return()=>{for(const key of ['NODE_ENV','MIGRATION_DATABASE_URL']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}};}
function poolMock({alreadySeeded=false,companyRow=company}={}){
 const calls:any[]=[];const dir=path.resolve(__dirname,'../../../db');
 const migrations=readdirSync(dir).filter((f:string)=>/^\d+.*\.sql$/.test(f)).sort().map((name:string)=>({name,checksum:createHash('sha256').update(readFileSync(path.join(dir,name))).digest('hex')}));
 const client={async query(sql:string,params:any[]=[]){calls.push({sql,params});const q=sql.replace(/\s+/g,' ').trim();
  if(q==='SELECT current_user AS role,current_database() AS database')return {rows:[{role:'erp_owner',database:'erp'}],rowCount:1};
  if(q==='SELECT current_user AS role')return {rows:[{role:'erp_owner'}],rowCount:1};
  if(q==='SELECT name, checksum FROM schema_migrations')return {rows:migrations,rowCount:migrations.length};
  if(q.startsWith("SELECT 1 FROM users WHERE id=$1 AND principal_type="))return {rows:[{ok:1}],rowCount:1};
  if(q.startsWith('SELECT c.id AS company_id'))return {rows:companyRow?[companyRow]:[],rowCount:companyRow?1:0};
  if(q.startsWith('SELECT completed_at FROM production_company_scaffolds'))return {rows:alreadySeeded?[{completed_at:'2026-09-30T10:00:00.000Z'}]:[],rowCount:alreadySeeded?1:0};
  if(q.startsWith('SELECT code,account_type,control_type,postable FROM accounts'))return {rows:STARTER_ACCOUNTS.map(([code,,account_type,control_type,postable]:any)=>({code,account_type,control_type,postable})),rowCount:STARTER_ACCOUNTS.length};
  if(q.startsWith('SELECT starts_on::text AS starts_on'))return {rows:[],rowCount:0};
  if(q.startsWith('SELECT branch_id,location_type FROM warehouses'))return {rows:[{branch_id:company.branch_id,location_type:'SELLABLE'}],rowCount:1};
  if(q.startsWith('SELECT id,catalog_version FROM'))return {rows:[],rowCount:0};
  if(q.includes('RETURNING to_jsonb('))return {rows:[{snapshot:{id:randomUUID(),catalog_version:1}}],rowCount:1};
  if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.startsWith('SELECT pg_advisory_xact_lock')||q.startsWith('SELECT set_config'))return {rows:[],rowCount:0};
  if(q.startsWith('INSERT')||q.startsWith('UPDATE')||q.startsWith('DELETE'))return {rows:[],rowCount:1};
  throw new Error('Unexpected SQL in starter-scaffold test: '+q);
 },release(){calls.push({sql:'RELEASE',params:[]});}};
 return {calls,pool:{connect:async()=>client,end:async()=>{}}};
}

test('existing-production-company starter scaffold is additive, one-time and audited',async()=>{
 const restore=env();const {pool,calls}=poolMock();
 try{
  const result=await scaffold.seedExistingCompany({companyCode:'acme_ke',confirmation:'SEED STARTER ACME_KE'},{pool});
  assert.equal(result.alreadySeeded,false);assert.equal(result.companyCode,'ACME_KE');assert.equal(result.seededYears.length,3);
  const sql=calls.map(x=>x.sql.replace(/\s+/g,' ').trim());
  assert.ok(sql.includes('COMMIT'));assert.ok(!sql.includes('ROLLBACK'));
  assert.ok(sql.some(q=>q.startsWith('INSERT INTO audit_logs(')));assert.ok(sql.some(q=>q.startsWith('INSERT INTO production_company_scaffolds(')));
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO accounts(')).length,22);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO units_of_measure(')).length,2);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO product_categories(')).length,2);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO brands(')).length,1);
  const insertRefs=sql.findIndex(q=>q.startsWith('INSERT INTO units_of_measure('));const lastAudit=sql.findIndex(q=>q.startsWith('INSERT INTO audit_logs('));assert.ok(lastAudit<insertRefs,'company scaffold audit and marker precede governed-reference inserts');
  const temporaryRoleDelete=sql.findIndex(q=>q.startsWith('DELETE FROM roles WHERE'));assert.ok(temporaryRoleDelete>insertRefs&&temporaryRoleDelete<sql.indexOf('COMMIT'),'temporary metadata permission role is removed before commit');
  assert.ok(!sql.some(q=>/INSERT INTO (sales|source_documents|journal_entries|inventory_movements|tax_rules|customers|products)\b/i.test(q)));
 }finally{restore();}
});

test('repeat run recognizes the immutable scaffold ledger and makes no writes',async()=>{
 const restore=env();const {pool,calls}=poolMock({alreadySeeded:true});
 try{
  const result=await scaffold.seedExistingCompany({companyCode:'ACME_KE',confirmation:'SEED STARTER ACME_KE'},{pool});
  assert.equal(result.alreadySeeded,true);assert.ok(calls.some(x=>x.sql==='COMMIT'));
  assert.ok(!calls.some(x=>/^(INSERT|UPDATE|DELETE)\b/i.test(x.sql.trim())));
 }finally{restore();}
});

test('supplemental seed refuses wrong confirmation and unmarked demo databases before writes',async()=>{
 const restore=env();let connects=0;const pool={connect:async()=>{connects++;return poolMock({companyRow:null}).pool.connect();},end:async()=>{}};
 try{
  await assert.rejects(scaffold.seedExistingCompany({companyCode:'ACME_KE',confirmation:'CREATE ACME_KE'},{pool}),/Confirmation must exactly match/);assert.equal(connects,0);
  const {pool:missing}=poolMock({companyRow:null});
  await assert.rejects(scaffold.seedExistingCompany({companyCode:'ACME_KE',confirmation:'SEED STARTER ACME_KE'},{pool:missing}),/No production-onboarding company marker/);
 }finally{restore();}
});
