const {Pool}=require('pg');const fs=require('fs');require('dotenv').config();
(async()=>{
 const p=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
 try{
 const cols=(await p.query(`SELECT table_name,column_name,coalesce(domain_name,data_type) AS data_type,is_nullable,column_default,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name<>'schema_migrations' ORDER BY table_name,ordinal_position`)).rows;
 const fks=(await p.query(`SELECT con.conname AS name,cl.relname AS child,cr.relname AS parent,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_class cr ON cr.oid=con.confrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE con.contype='f' AND n.nspname='public' ORDER BY cl.relname,con.conname`)).rows;
 let text='erDiagram\n';for(const name of [...new Set(cols.map(c=>c.table_name))]){
 text+=`  ${name} {\n`;for(const c of cols.filter(c=>c.table_name===name))text+=`    ${c.data_type.replaceAll(' ','_').replaceAll('[]','_array')} ${c.column_name}${c.column_name==='id'?' PK':''}\n`;text+='  }\n';}
 for(const f of fks)text+=`  ${f.parent} ||--o{ ${f.child} : "${f.definition.match(/FOREIGN KEY \((.*?)\)/)?.[1]??f.name}"\n`;
 fs.writeFileSync('docs/erd.mmd',text);
 const keys=Object.keys(cols[0]);const csv=[keys,...cols.map(c=>keys.map(k=>c[k]??''))].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');fs.writeFileSync('docs/data-dictionary.csv',csv+'\n');
 fs.writeFileSync('docs/foreign-keys.json',JSON.stringify(fks,null,2));
 fs.writeFileSync('docs/schema-summary.json',JSON.stringify({tables:new Set(cols.map(c=>c.table_name)).size,columns:cols.length,foreignKeys:fks.length,generatedAt:new Date().toISOString()},null,2));console.log('Exported schema:',new Set(cols.map(c=>c.table_name)).size,'tables,',fks.length,'foreign keys.');
 }finally{await p.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
