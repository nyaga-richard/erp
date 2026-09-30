import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bootstrap} from '../src/main';
import {Db} from '../src/db';
import {seed,C1,C2,B1,ids} from '../src/seed';

test('Controlled numbering configuration preserves transactional financial origin',{timeout:120000},async t=>{
 const adminUrl=process.env.TEST_ADMIN_URL??'postgresql://user@127.0.0.1:5432/postgres',admin=new Pool({connectionString:adminUrl}),name='erp_numbering_'+Date.now();await admin.query('CREATE DATABASE '+name);
 const ownerUrl=new URL(adminUrl);ownerUrl.pathname='/'+name;const owner=new Pool({connectionString:ownerUrl.toString()});let app:any;
 try{
  for(const f of readdirSync('../../db').filter(f=>/^\d+.*\.sql$/.test(f)).sort())await owner.query(readFileSync('../../db/'+f,'utf8'));
  await seed(ownerUrl.toString(),'Numbering-Test-Only-Password-2026!');const runtime=new URL(process.env.TEST_RUNTIME_URL??adminUrl);runtime.pathname='/'+name;runtime.username='erp_runtime';if(!process.env.TEST_RUNTIME_URL)runtime.password=process.env.TEST_RUNTIME_PASSWORD??'';
  process.env.DATABASE_URL=runtime.toString();app=await bootstrap(0);const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';type User={cookie:string;csrf:string};
  const call=async(path:string,u?:User,body?:unknown,options:{key?:string;company?:string;csrf?:string}={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Company-ID':options.company??C1,'Idempotency-Key':options.key??randomUUID(),...(u?{Cookie:u.cookie,'X-CSRF-Token':options.csrf??u.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const login=async(email:string)=>{const r=await call('/auth/login',undefined,{email,password:'Numbering-Test-Only-Password-2026!'});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};};
  const maker=await login('admin@demo.local'),reviewer=await login('reviewer@demo.local'),a=await login('amina@demo.local'),b=await login('brian@demo.local'),c=await login('carol@demo.local'),makerId='30000000-0000-4000-8000-000000000005',reviewerId='30000000-0000-4000-8000-000000000006';
  const proposal={branchId:B1,documentType:'MANUAL_JOURNAL',year:2028,prefix:'NDR',padding:7,expectedVersion:0,reason:'Reviewed branch document numbering convention'},approve={decision:'APPROVE',reason:'Independently reviewed unused numbering format'};
  const propose=async(body:any=proposal)=>{const r=await call('/admin/numbering-policy-changes',maker,body);assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const decide=(id:string,body:any=approve,u:User=reviewer,key?:string)=>call('/admin/numbering-policy-changes/'+id+'/decide',u,body,{key});
  const effective=(year=2028,documentType='MANUAL_JOURNAL')=>call(`/admin/numbering-policies/effective?branchId=${B1}&documentType=${documentType}&year=${year}`,maker);
  let request='',policy='';
  await t.test('catalog, branch search, type registry and explicit authority boundaries',async()=>{
   assert.equal((await call('/admin/numbering-policies',maker)).status,200);assert.equal((await call('/admin/numbering-policies')).status,401);assert.equal((await call('/admin/numbering-policies',maker,undefined,{company:C2})).status,403);
   assert.equal((await call('/admin/numbering-policies?limit=101',maker)).status,400);assert.ok((await call('/admin/numbering-policies/types',maker)).data.some((r:any)=>r.document_type==='JOURNAL'));assert.ok((await call('/admin/numbering-policies/branches?q=HQ&limit=1',maker)).data.data.length<=1);
   assert.equal((await call('/admin/numbering-policy-changes',a,proposal)).status,403);assert.equal((await call('/admin/numbering-policy-changes',reviewer,proposal)).status,403);assert.equal((await call('/admin/numbering-policy-changes',maker,proposal,{csrf:'forged'})).status,403);assert.equal((await call('/admin/numbering-policy-changes',maker,{...proposal,created_by:ids[0]})).status,400);
   const foreign=(await owner.query('SELECT id FROM branches WHERE company_id=$1 LIMIT 1',[C2])).rows[0].id;assert.equal((await call('/admin/numbering-policy-changes',maker,{...proposal,branchId:foreign})).status,422);
  });
  await t.test('pending proposal is idempotent, immutable and has no effective/financial effect',async()=>{
   const key=randomUUID(),one=await call('/admin/numbering-policy-changes',maker,proposal,{key}),two=await call('/admin/numbering-policy-changes',maker,proposal,{key});assert.equal(one.status,201,JSON.stringify(one.data));assert.equal(one.data.id,two.data.id);request=one.data.id;
   assert.equal((await call('/admin/numbering-policy-changes',maker,{...proposal,prefix:'OTHER'},{key})).status,409);const e=await effective();assert.equal(e.data.inherited,true);assert.equal(e.data.prefix,'JDR');assert.equal((await owner.query('SELECT count(*) FROM source_documents')).rows[0].count,'0');assert.equal((await owner.query('SELECT count(*) FROM document_numbering_policies')).rows[0].count,'0');
  });
  await t.test('self-review remains forbidden even when both grants are present',async()=>{
   const role=(await owner.query('SELECT role_id FROM user_roles WHERE company_id=$1 AND user_id=$2 LIMIT 1',[C1,makerId])).rows[0].role_id;await owner.query("INSERT INTO role_permissions(company_id,role_id,permission_code) VALUES($1,$2,'numbering:approve')",[C1,role]);try{assert.equal((await decide(request,approve,maker)).status,403);}finally{await owner.query("DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2 AND permission_code='numbering:approve'",[C1,role]);}
  });
  await t.test('independent concurrent idempotent approval retains maker and reviewer',async()=>{
   const key=randomUUID(),r=await Promise.all([decide(request,approve,reviewer,key),decide(request,approve,reviewer,key)]);assert.ok(r.every(x=>x.status===201),JSON.stringify(r));policy=r[0].data.policyId;assert.equal(r[0].data.version,1);const e=(await effective()).data;assert.equal(e.inherited,false);assert.equal(e.prefix,'NDR');assert.equal(e.padding,7);assert.equal(e.version,1);
   const stored=(await owner.query('SELECT * FROM document_numbering_policies WHERE id=$1',[policy])).rows[0],reviewed=(await owner.query('SELECT * FROM numbering_change_requests WHERE id=$1',[request])).rows[0];assert.equal(stored.created_by,makerId);assert.equal(reviewed.reviewed_by,reviewerId);assert.equal(reviewed.state,'APPLIED');
  });
  await t.test('revisions are versioned and stale competing requests can only be rejected',async()=>{
   const first=await propose({...proposal,prefix:'NDR2',padding:8,expectedVersion:1}),stale=await propose({...proposal,prefix:'OLD',expectedVersion:1});assert.equal((await decide(first)).status,201);assert.equal((await decide(stale)).status,409);assert.equal((await decide(stale,{decision:'REJECT',reason:'Reject stale request after competing publication'})).status,201);assert.equal((await effective()).data.version,2);assert.equal((await effective()).data.prefix,'NDR2');
  });
  await t.test('effective-prefix conflicts fail both early and under concurrent publication',async()=>{
   assert.equal((await call('/admin/numbering-policy-changes',maker,{...proposal,year:2031,prefix:'JE'})).status,422);
   const x=await propose({...proposal,year:2030,prefix:'SHARED'}),y=await propose({...proposal,year:2030,prefix:'SHARED',documentType:'JOURNAL'});const r=await Promise.all([decide(x),decide(y)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,422]);
  });
  await t.test('approved format drives real independently posted balanced financial source and then locks',async()=>{
   const accounts=(await owner.query("SELECT id,code FROM accounts WHERE company_id=$1 AND code IN ('6100','6200')",[C1])).rows;const dr=accounts.find(x=>x.code==='6100').id,cr=accounts.find(x=>x.code==='6200').id;
   const draft={branchId:B1,date:'2028-01-02',currency:'KES',description:'Test configured number integrates with journal',lines:[{accountId:dr,debit:'10.00',credit:'0'},{accountId:cr,debit:'0',credit:'10.00'}]};const r=await call('/journals/drafts',a,draft);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.document_number,'NDR2-2028-00000001');
   assert.equal((await call('/admin/numbering-policy-changes',maker,{...proposal,prefix:'LOCKED',expectedVersion:2})).status,422);assert.equal((await effective()).data.locked,true);
   await owner.query("INSERT INTO financial_periods(company_id,name,starts_on,ends_on,created_by) VALUES($1,'Test 2028','2028-01-01','2028-12-31',$2)",[C1,ids[0]]);
   for(const [action,user] of [['submit',a],['approve',b],['post',c]] as const){const result=await call('/documents/'+r.data.id+'/'+action,user,{});assert.equal(result.status,201,JSON.stringify(result.data));}
   const result=(await call('/documents/'+r.data.id,a)).data;assert.equal(result.status,'POSTED');assert.equal(result.created_by,ids[0]);const sum=(await owner.query('SELECT sum(debit-credit) AS balance FROM journal_lines')).rows[0].balance;assert.equal(Number(sum),0);
  });
  await t.test('publication racing first allocation cannot renumber an initialized sequence',async()=>{
   const id=await propose({...proposal,year:2032,prefix:'RACE'});const accounts=(await owner.query("SELECT id,code FROM accounts WHERE company_id=$1 AND code IN ('6100','6200')",[C1])).rows;
   const draft={branchId:B1,date:'2032-01-02',currency:'KES',description:'Concurrent numbering initialization test',lines:[{accountId:accounts.find(x=>x.code==='6100').id,debit:'1.00',credit:'0'},{accountId:accounts.find(x=>x.code==='6200').id,debit:'0',credit:'1.00'}]};
   const [publication,created]=await Promise.all([decide(id),call('/journals/drafts',a,draft)]);assert.equal(created.status,201,JSON.stringify(created.data));assert.ok([201,422].includes(publication.status));assert.equal(created.data.document_number,(publication.status===201?'RACE':'JDR')+'-2032-'+(publication.status===201?'0000001':'000001'));assert.equal((await effective(2032)).data.locked,true);
  });
  for(const field of ['before','policyBefore'])await t.test('forged '+field+' audit snapshot rolls back approved numbering change',async()=>{
   const year=field==='before'?2034:2035;let version=0;if(field==='policyBefore'){const base=await propose({...proposal,year,prefix:'PRIOR'});assert.equal((await decide(base)).status,201);version=1;}
   const id=await propose({...proposal,year,prefix:'AUDIT',expectedVersion:version});await owner.query("CREATE FUNCTION corrupt_numbering_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='NUMBERING_CONFIGURATION' AND NEW.action='NUMBERING_CHANGE_APPROVE' THEN NEW.new_values=jsonb_set(NEW.new_values,ARRAY['"+field+"'],'{}'::jsonb); END IF; RETURN NEW; END $$; CREATE TRIGGER corrupt_numbering_audit_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corrupt_numbering_audit_test()");
   try{assert.equal((await decide(id)).status,422);assert.equal((await owner.query('SELECT state FROM numbering_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');assert.equal((await effective(year)).data.version,version);}finally{await owner.query('DROP TRIGGER corrupt_numbering_audit_test ON audit_logs; DROP FUNCTION corrupt_numbering_audit_test()');}
  });
  await t.test('direct runtime changes cannot bypass matching approval and audit',async()=>{
   const db=app.get(Db);await assert.rejects(()=>db.transaction({userId:reviewerId,companyId:C1},c=>c.query("UPDATE document_numbering_policies SET prefix='FORGED',version=version+1 WHERE id=$1",[policy])));await assert.rejects(()=>db.transaction({userId:makerId,companyId:C1},c=>c.query("UPDATE numbering_change_requests SET prefix='FORGED' WHERE id=$1",[request])));await assert.rejects(()=>db.transaction({userId:makerId,companyId:C1},c=>c.query('DELETE FROM numbering_change_requests WHERE id=$1',[request])));
  });
  await t.test('intentional apply failure rolls back policy/request/audit and same-key retry succeeds',async()=>{
   const id=await propose({...proposal,year:2029,prefix:'ROLL'}),key=randomUUID();await owner.query("CREATE FUNCTION fail_numbering_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.prefix='ROLL' THEN RAISE EXCEPTION 'intentional numbering apply failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_numbering_test BEFORE INSERT ON document_numbering_policies FOR EACH ROW EXECUTE FUNCTION fail_numbering_test()");
   try{assert.equal((await decide(id,approve,reviewer,key)).status,500);assert.equal((await owner.query('SELECT state FROM numbering_change_requests WHERE id=$1',[id])).rows[0].state,'PENDING');assert.equal((await owner.query("SELECT count(*) FROM document_numbering_policies WHERE prefix='ROLL'")).rows[0].count,'0');assert.equal((await owner.query("SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action='NUMBERING_CHANGE_APPROVE'",[id])).rows[0].count,'0');}finally{await owner.query('DROP TRIGGER fail_numbering_test ON document_numbering_policies; DROP FUNCTION fail_numbering_test()');}assert.equal((await decide(id,approve,reviewer,key)).status,201);
  });
 }finally{if(app){await app.get(Db).pool.end();await app.close();}await owner.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
