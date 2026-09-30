// Resumable sequential regression. Observe the unchanged development login
// throttle; pause BEFORE exhausting it. Never modify rate buckets or credentials.
const fs=require('fs'),path=require('path'),{createHash}=require('crypto'),{execSync}=require('child_process'),{Pool}=require('pg');require('dotenv').config({quiet:true});
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]);}
(async()=>{
 const hash=createHash('sha256');for(const file of ['apps/api/src','apps/web/src','apps/web/app','db'].flatMap(files).sort())hash.update(file).update(fs.readFileSync(file));for(const file of ['apps/web/next.config.mjs','apps/web/proxy.ts'])if(fs.existsSync(file))hash.update(fs.readFileSync(file));const fingerprint=hash.digest('hex');
 const receipt='docs/testing/browser-regression.json',log='docs/testing/browser-regression.txt',scripts=Object.entries(require('../package.json').scripts).filter(([k])=>k==='test:e2e'||k.startsWith('test:e2e:'));
 let state=fs.existsSync(receipt)?JSON.parse(fs.readFileSync(receipt)):null;if(process.argv.includes('--new')||!state){state={started:new Date().toISOString(),fingerprint,status:'TESTING',complete:false,suites:scripts.map(([name])=>({name,passed:false})),runs:[]};fs.writeFileSync(log,'Browser regression '+state.started+'\nSource fingerprint '+fingerprint+'\n');}
 if(state.fingerprint!==fingerprint)throw Error('Application/migration sources changed. Start an explicitly new regression with --new; prior evidence is not current.');
 if(JSON.stringify(state.suites.map(s=>s.name))!==JSON.stringify(scripts.map(([name])=>name)))throw Error('Suite catalog changed. Start a new regression.');
 if(state.complete&&state.suites.every(s=>s.passed)){console.log('ALL',scripts.length,'PASSED',state.finished,'(existing frozen-source receipt; no suites rerun)');return;}
 const p=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});try{
  for(const [i,[name,command]] of scripts.entries()){
   if(state.suites[i].passed)continue;
   const budget=(await p.query("SELECT coalesce(max(attempts),0)::int used,max(window_start+interval '15 minutes') reset_at FROM auth_rate_limits WHERE bucket LIKE 'login-ip:%' AND window_start>now()-interval '15 minutes'")).rows[0];
   if(budget.used>50){state.pauseReason='Natural login throttle budget; resume after '+budget.reset_at.toISOString();fs.writeFileSync(receipt,JSON.stringify(state,null,2)+'\n');console.log(state.pauseReason);return;}
   fs.appendFileSync(log,'\n### '+name+' '+new Date().toISOString()+'\n');console.log(name);
   try{const output=execSync(command,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});fs.appendFileSync(log,output);state.suites[i]={name,passed:true,date:new Date().toISOString()};state.runs.push({name,passed:true,date:new Date().toISOString()});delete state.pauseReason;}
   catch(e){fs.appendFileSync(log,(e.stdout||'')+(e.stderr||'')+'\nFAILED\n');state.runs.push({name,passed:false,date:new Date().toISOString()});fs.writeFileSync(receipt,JSON.stringify(state,null,2)+'\n');throw Error(name+' failed; inspect '+log);}
   fs.writeFileSync(receipt,JSON.stringify(state,null,2)+'\n');
  }
  state.complete=true;state.status='VERIFIED';state.finished=new Date().toISOString();delete state.pauseReason;fs.writeFileSync(receipt,JSON.stringify(state,null,2)+'\n');fs.appendFileSync(log,'\nALL '+scripts.length+' PASSED '+state.finished+'\n');console.log('ALL',scripts.length,'PASSED');
 }finally{await p.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
