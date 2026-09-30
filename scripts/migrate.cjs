const {Pool}=require('pg');const fs=require('fs');const path=require('path');const {createHash}=require('crypto');require('dotenv').config();
(async()=>{
 if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL is required. Never use owner credentials in the API.');
 const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});const c=await pool.connect();
 try{
  await c.query('SELECT pg_advisory_lock(319001)');
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),applied_by text NOT NULL DEFAULT current_user)');
  for(const name of fs.readdirSync('db').filter(f=>/^\d+.*\.sql$/.test(f)).sort()){
   const raw=fs.readFileSync(path.join('db',name),'utf8');const checksum=createHash('sha256').update(raw).digest('hex');
   const old=(await c.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name])).rows[0];
   if(old){if(old.checksum!==checksum)throw Error('Migration checksum changed: '+name);continue;}
   try{await c.query('BEGIN');await c.query(raw.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''));await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await c.query('COMMIT');console.log('Applied',name);}catch(e){await c.query('ROLLBACK');throw e;}
  }
  if(process.env.RUNTIME_DB_PASSWORD){if(process.env.RUNTIME_DB_PASSWORD.length<20)throw Error('Use a runtime database password of at least 20 characters.');const sql=(await c.query("SELECT format('ALTER ROLE erp_runtime PASSWORD %L',$1::text)",[process.env.RUNTIME_DB_PASSWORD])).rows[0].format;await c.query(sql);}
  if(process.env.AUTH_WORKER_DB_PASSWORD){if(process.env.AUTH_WORKER_DB_PASSWORD.length<20)throw Error('Worker password must be at least 20 characters.');const sql=(await c.query("SELECT format('ALTER ROLE erp_auth_worker PASSWORD %L',$1::text)",[process.env.AUTH_WORKER_DB_PASSWORD])).rows[0].format;await c.query(sql);}
 }finally{await c.query('SELECT pg_advisory_unlock(319001)');c.release();await pool.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
