import {config} from 'dotenv';
import {Pool} from 'pg';
import argon2 from 'argon2';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
config({path:'../../.env'});
export const C1='10000000-0000-4000-8000-000000000001',C2='10000000-0000-4000-8000-000000000002';
export const B1='20000000-0000-4000-8000-000000000001',B2='20000000-0000-4000-8000-000000000002';
export const ids=['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000004'];

const {starterFiscalYears,seedChartOfAccounts,seedFiscalPeriods,seedMainWarehouse,seedStarterProductReferences}=require('../../../scripts/company-setup-template.cjs');
export const demoFiscalYears=starterFiscalYears;

export async function seed(url:string,password:string){
 if(process.env.NODE_ENV==='production')throw new Error('Development demo seed is forbidden in production. Use the reviewed production onboarding workflow.');
 const p=new Pool({connectionString:url});const c=await p.connect();
 try{
 await c.query('BEGIN');const existing=(await c.query('SELECT password_hash FROM users WHERE id=$1',[ids[0]])).rows[0];if(existing && !await argon2.verify(existing.password_hash,password))throw new Error('Existing development users use a different password. Supply the original DEMO_PASSWORD; seed will not silently reset credentials.');const h=await argon2.hash(password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
 const names=['Amina • Creator','Brian • Approver','Carol • Poster','David • Auditor'];
 for(let i=0;i<4;i++)await c.query(`INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,[ids[i],['amina','brian','carol','auditor'][i]+'@demo.local',names[i],h]);
 const stockReady=(await c.query("SELECT 1 FROM permissions WHERE code='inventory:view'")).rowCount;
 const permissions=[...(stockReady?['inventory:view','inventory:cost:view','inventory:create','inventory:submit','inventory:approve','inventory:post','inventory:cancel','inventory:reverse']:[]),'numbering:view','accounts:configuration:view','accounting:view','journals:view','journals:create','journals:approve','journals:post','journals:reverse','periods:close','periods:reopen','audit:view','workspace:view','journals:edit','journals:cancel','journals:reject','approvals:view'];
 for(const code of permissions)await c.query('INSERT INTO permissions(code,description) VALUES($1,$1) ON CONFLICT DO NOTHING',[code]);
 for(const [idx,co] of [C1,C2].entries()){
 await c.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true)",[ids[0],co]);
 await c.query('INSERT INTO companies(id,code,name,base_currency,created_by) VALUES($1,$2,$3,\'KES\',$4) ON CONFLICT DO NOTHING',[co,idx===0?'NAI':'MSA',idx===0?'Karibu Retail • Demo':'Coast Wholesale • Demo',ids[0]]);
 const branch=idx===0?B1:B2;
 await c.query('INSERT INTO branches(id,company_id,code,name,created_by) VALUES($1,$2,\'HQ\',$3,$4) ON CONFLICT DO NOTHING',[branch,co,idx===0?'Nairobi • Main branch':'Mombasa • Main branch',ids[0]]);
 await seedMainWarehouse(c,co,branch,idx===0?'Nairobi • Main branch':'Mombasa • Main branch',ids[0]);
 const full=(await c.query(`INSERT INTO roles(company_id,name,created_by) VALUES($1,'Demo accounting team',$2) ON CONFLICT(company_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[co,ids[0]])).rows[0].id;
 const view=(await c.query(`INSERT INTO roles(company_id,name,created_by) VALUES($1,'Read-only auditor',$2) ON CONFLICT(company_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[co,ids[0]])).rows[0].id;
 for(const code of permissions){await c.query('INSERT INTO role_permissions VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[co,full,code]);if(['numbering:view','accounts:configuration:view','accounting:view','journals:view','audit:view','workspace:view'].includes(code))await c.query('INSERT INTO role_permissions VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[co,view,code]);}
 for(let i=0;i<4;i++){if(idx===1&&i!==0)continue;await c.query('INSERT INTO memberships(company_id,user_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[co,ids[i],ids[0]]);await c.query('INSERT INTO user_roles VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[co,ids[i],i===3?view:full]);await c.query('INSERT INTO user_branch_scopes VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[co,ids[i],branch]);}
 await seedFiscalPeriods(c,co,ids[0]);
 await seedChartOfAccounts(c,co,ids[0]);
 }
 const adminId='30000000-0000-4000-8000-000000000005',reviewId='30000000-0000-4000-8000-000000000006';
 const customerAmendReady=(await c.query("SELECT 1 FROM permissions WHERE code='customers:amend:propose'")).rowCount;
 const customersReady=(await c.query("SELECT 1 FROM permissions WHERE code='customers:view'")).rowCount;
 const productsReady=(await c.query("SELECT 1 FROM permissions WHERE code='products:propose'")).rowCount;
 const productRefsReady=(await c.query("SELECT 1 FROM permissions WHERE code='products:view'")).rowCount;
 const taxesReady=(await c.query("SELECT 1 FROM permissions WHERE code='taxes:view'")).rowCount;
 const rulesReady=(await c.query("SELECT 1 FROM permissions WHERE code='rules:view'")).rowCount;
 const adminGrants=[...(customerAmendReady?['customers:amend:propose','customers:credit:propose']:[]),...(customersReady?['customers:view','customers:propose']:[]),...(productsReady?['products:propose','products:cost:view']:[]),...(productRefsReady?['products:view','products:manage']:[]),...(taxesReady?['taxes:view','taxes:propose']:[]),...(rulesReady?['rules:view','rules:propose']:[]),'numbering:view','numbering:propose','accounts:configuration:view','accounts:propose','organization:profile:manage','warehouses:view','warehouses:manage','organization:view','organization:manage','workspace:view','users:view','users:manage','roles:view','roles:manage','approvals:view','approvals:manage','security:view','audit:view'];
 const reviewGrants=[...(customerAmendReady?['customers:amend:approve','customers:credit:approve']:[]),...(customersReady?['customers:view','customers:approve']:[]),...(productsReady?['products:approve','products:cost:view']:[]),...(productRefsReady?['products:view']:[]),...(taxesReady?['taxes:view','taxes:approve']:[]),...(rulesReady?['rules:view','rules:approve']:[]),'numbering:view','numbering:approve','accounts:configuration:view','accounts:approve','warehouses:view','organization:view','workspace:view','roles:view','approvals:view','approvals:publish','audit:view'];
 for(const [id,email,name,grants] of [[adminId,'admin@demo.local','Esther • Access administrator',adminGrants],[reviewId,'reviewer@demo.local','Felix • Policy reviewer',reviewGrants]] as const){
  await c.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,email,name,h]);
  await c.query('INSERT INTO memberships(company_id,user_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[C1,id,ids[0]]);
  const role=(await c.query('INSERT INTO roles(company_id,name,created_by) VALUES($1,$2,$3) ON CONFLICT(company_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[C1,name,ids[0]])).rows[0].id;
  for(const code of grants)await c.query('INSERT INTO role_permissions VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[C1,role,code]);
  await c.query('INSERT INTO user_roles VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[C1,id,role]);
  await c.query('INSERT INTO user_branch_scopes VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[C1,id,B1]);
 }
 if(productRefsReady)await seedStarterProductReferences(c,C1,adminId);
 await c.query('INSERT INTO permission_delegations(company_id,user_id,permission_code,granted_by) SELECT $1,$2,code,$3 FROM permissions ON CONFLICT DO NOTHING',[C1,adminId,ids[0]]);
 await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await p.end();}
}
if(require.main===module){
 const password=process.env.DEMO_PASSWORD??(existsSync('../../.runtime/demo.json')?JSON.parse(readFileSync('../../.runtime/demo.json','utf8')).password:randomBytes(18).toString('base64url'));
 seed(process.env.MIGRATION_DATABASE_URL!,password).then(()=>{mkdirSync('../../.runtime',{recursive:true});writeFileSync('../../.runtime/demo.json',JSON.stringify({password,emails:['amina@demo.local','brian@demo.local','carol@demo.local','auditor@demo.local','admin@demo.local','reviewer@demo.local'],companyId:C1,branchId:B1},null,2));writeFileSync('../../DEMO_ACCESS.md',`# Development preview access\n\n**Development only — no real business data or live payments. Never use these accounts in production.**\n\nOpen the Karibu ERP live preview card (port 5173) in Arena. Do not use a copied raw sandbox hostname: platform traffic authorization is required. If already open, reload the preview before signing in.\n\nShared development password: \`${password}\`\n\n| User | Email | Demonstration role |\n|---|---|---|\n| Amina | amina@demo.local | Create and submit |\n| Brian | brian@demo.local | Independently approve |\n| Carol | carol@demo.local | Independently post |\n| David | auditor@demo.local | Read-only audit |\n| Esther | admin@demo.local | Access administration, policy drafts and account proposals (no posting) |\n| Felix | reviewer@demo.local | Independent policy/account review (no posting) |\n\nUse **Karibu Retail • Demo / Nairobi** for the three-user workflow. The three finance users have configurable grants; segregation rules, not hard-coded role names, prevent self-approval and self-posting. The Coast company is visible only to Amina for isolation testing.\n\nCreate a balanced non-control journal (for example Dr Rent / Cr Utilities), submit as Amina, sign out, approve as Brian, then sign out and post as Carol. This is a demo reclassification, not a cash expense. Control-account posting is blocked until the connected operational services exist.\n\nThe demo workspace includes a starter chart of accounts, prior/current/next fiscal years, a branch and warehouse, plus governed starter units, product categories and brand references. No financial opening balances or stock balances were fabricated.\n\nThe browser test leaves clearly labeled DEMO source documents and journals. They are not real sales, stock, or cash.\n`);console.log('Development seed complete: starter CoA, fiscal periods, branch/warehouse and product references are ready. Credentials: .runtime/demo.json. No financial or stock opening balances were fabricated.');}).catch(e=>{console.error(e);process.exitCode=1;});
}
