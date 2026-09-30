import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {existsSync,readFileSync,readdirSync} from 'node:fs';

test('Migration-owned posting contracts are complete, sealed and runtime read-only',{timeout:60000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_contract_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const ownerUrl=new URL(adminUrl);ownerUrl.pathname='/'+name;const owner=new Pool({connectionString:ownerUrl.toString()});let runtime:Pool|undefined;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));
  const draft='../../db/drafts/014-controlled-posting-rules.sql';if(existsSync(draft))await owner.query(readFileSync(draft,'utf8'));
  // This availability assertion genuinely failed before the draft registry existed.
  assert.equal((await owner.query('SELECT count(*) FROM posting_event_contracts')).rows[0].count,'3');
  const runtimeUrl=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtimeUrl.pathname='/'+name;runtimeUrl.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtimeUrl.password=process.env.TEST_RUNTIME_PASSWORD??'';runtime=new Pool({connectionString:runtimeUrl.toString()});
  await t.test('Initial contracts have exact trusted stock legs and migration provenance, not operating workflows',async()=>{
   const rows=(await runtime!.query('SELECT * FROM posting_event_contracts ORDER BY event_type')).rows;assert.deepEqual(rows.map(r=>r.event_type),['GOODS_RECEIVED','STOCK_GAIN','STOCK_LOSS']);const principal=(await owner.query('SELECT current_user AS name')).rows[0].name;
   for(const r of rows){assert.equal(r.contract_version,1);assert.equal(r.workflow_status,'CONFIGURATION_ONLY');assert.equal(r.migration_principal,principal);assert.equal(r.origin_migration,'014-controlled-posting-rules.sql');assert.ok(r.sealed_at);}
   const legs=(await runtime!.query('SELECT event_type,leg_code,side,amount_key FROM posting_event_leg_contracts ORDER BY event_type,leg_code')).rows;
   assert.deepEqual(legs,[['GOODS_RECEIVED','GRNI','CREDIT'],['GOODS_RECEIVED','INVENTORY','DEBIT'],['STOCK_GAIN','GAIN','CREDIT'],['STOCK_GAIN','INVENTORY','DEBIT'],['STOCK_LOSS','INVENTORY','CREDIT'],['STOCK_LOSS','LOSS','DEBIT']].map(([event_type,leg_code,side])=>({event_type,leg_code,side,amount_key:'stockValue'})));
   const allowed=(await runtime!.query("SELECT account_type,control_type FROM posting_event_leg_eligibility WHERE event_type='STOCK_GAIN' AND leg_code='GAIN' ORDER BY account_type")).rows;assert.deepEqual(allowed,[{account_type:'EXPENSE',control_type:null},{account_type:'REVENUE',control_type:null}]);
   assert.equal((await owner.query('SELECT count(*) FROM source_documents')).rows[0].count,'0');
  });
  await t.test('Runtime cannot insert, update, delete, truncate or extend registry definitions',async()=>{
   for(const table of ['posting_event_contracts','posting_event_leg_contracts','posting_event_leg_eligibility'])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await owner.query('SELECT has_table_privilege($1,$2,$3) AS granted',['erp_runtime',table,privilege])).rows[0].granted,false,table+privilege);
   await assert.rejects(runtime!.query("UPDATE posting_event_contracts SET workflow_status='CONFIGURATION_ONLY'"),{code:'42501'});
   await assert.rejects(runtime!.query("INSERT INTO posting_event_leg_eligibility(event_type,contract_version,leg_code,account_type,control_type) VALUES('STOCK_GAIN',1,'GAIN','ASSET',NULL)"),{code:'42501'});
   await assert.rejects(runtime!.query('TRUNCATE posting_event_contracts CASCADE'),{code:'42501'});
  });
  await t.test('Even ordinary owner writes cannot mutate or extend sealed definition graphs',async()=>{
   await assert.rejects(owner.query("UPDATE posting_event_contracts SET event_type='OTHER' WHERE event_type='STOCK_GAIN'"),{code:'23514'});
   await assert.rejects(owner.query("DELETE FROM posting_event_leg_contracts WHERE event_type='STOCK_GAIN'"),{code:'23514'});
   await assert.rejects(owner.query("INSERT INTO posting_event_leg_eligibility(event_type,contract_version,leg_code,account_type,control_type) VALUES('STOCK_GAIN',1,'GAIN','ASSET',NULL)"),{code:'23514'});
   await assert.rejects(owner.query("INSERT INTO posting_event_leg_contracts(event_type,contract_version,leg_code,side,amount_key) VALUES('STOCK_GAIN',1,'EXTRA','DEBIT','stockValue')"),{code:'23514'});
  });
  await t.test('Incomplete, unsealed, duplicate-null eligibility and forged provenance transactions roll back',async()=>{
   for(const kind of ['unsealed','incomplete','missingEligibility','oneSided','duplicate','provenance','reservedAmount']){
    const c=await owner.connect();try{await c.query('BEGIN');let rejected=false;
     try{
      await c.query("INSERT INTO posting_event_contracts(event_type,contract_version,origin_migration,migration_principal) VALUES('TEST_EVENT',1,'014-controlled-posting-rules.sql',"+(kind==='provenance'?"'forged'":"current_user")+")");
      if(kind==='reservedAmount')await c.query("INSERT INTO posting_event_leg_contracts(event_type,contract_version,leg_code,side,amount_key) VALUES('TEST_EVENT',1,'TEST','DEBIT','constructor')");
      if(kind==='missingEligibility'||kind==='oneSided'){
       await c.query("INSERT INTO posting_event_leg_contracts(event_type,contract_version,leg_code,side,amount_key) VALUES('TEST_EVENT',1,'FIRST','DEBIT','stockValue'),('TEST_EVENT',1,'SECOND',$1,'stockValue')",[kind==='oneSided'?'DEBIT':'CREDIT']);
       if(kind==='oneSided')await c.query("INSERT INTO posting_event_leg_eligibility(event_type,contract_version,leg_code,account_type,control_type) VALUES('TEST_EVENT',1,'FIRST','EXPENSE',NULL),('TEST_EVENT',1,'SECOND','EXPENSE',NULL)");
       await c.query("UPDATE posting_event_contracts SET sealed_at=now() WHERE event_type='TEST_EVENT'");
      }
      if(kind==='duplicate'){
       await c.query("INSERT INTO posting_event_leg_contracts(event_type,contract_version,leg_code,side,amount_key) VALUES('TEST_EVENT',1,'TEST','DEBIT','stockValue')");
       await c.query("INSERT INTO posting_event_leg_eligibility(event_type,contract_version,leg_code,account_type,control_type) VALUES('TEST_EVENT',1,'TEST','EXPENSE',NULL),('TEST_EVENT',1,'TEST','EXPENSE',NULL)");
      }
      if(kind==='incomplete')await c.query("UPDATE posting_event_contracts SET sealed_at=now() WHERE event_type='TEST_EVENT'");
      await c.query('COMMIT');
     }catch(e:any){assert.ok(['23514','23505'].includes(e.code),e.message);rejected=true;await c.query('ROLLBACK');}
     assert.equal(rejected,true,kind);assert.equal((await c.query("SELECT count(*) FROM posting_event_contracts WHERE event_type='TEST_EVENT'")).rows[0].count,'0');
    }finally{await c.query('ROLLBACK');c.release();}
   }
  });
 }finally{if(runtime)await runtime.end();await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
