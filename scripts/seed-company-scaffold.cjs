#!/usr/bin/env node
'use strict';

// One-time, additive day-2 scaffold for a real company created by production
// onboarding. This is not a demo seed and never touches live balances or postings.
const {Pool} = require('pg');
const {randomUUID} = require('node:crypto');
const {stdin, stdout} = require('node:process');
const readline = require('node:readline/promises');
const {verifyMigrations} = require('./bootstrap-production.cjs');
const {seedChartOfAccounts,seedFiscalPeriods,seedMainWarehouse,seedStarterProductReferences} = require('./company-setup-template.cjs');

const AUTH_SERVICE = '00000000-0000-4000-8000-000000000001';
const BOOTSTRAP_LOCK = 738194205;
const TEMPLATE_CODE = 'STARTER_V1';

function assertSeedConfiguration(env = process.env) {
  if (env.NODE_ENV !== 'production') throw new Error('Production starter seeding is available only with NODE_ENV=production.');
  if (!env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required; runtime credentials are not accepted.');
}

function normalizeCompanyCode(input) {
  const code = String(input ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(code)) throw new Error('Enter the permanent company code shown during initial onboarding.');
  return code;
}

async function readCompany(client) {
  const row = (await client.query(`SELECT c.id AS company_id,c.code AS company_code,c.name AS company_name,
      c.active AS company_active,b.id AS branch_id,b.name AS branch_name,
      u.id AS admin_id,u.principal_type,u.active AS admin_active,m.active AS membership_active
    FROM production_onboarding o
    JOIN companies c ON c.id=o.company_id
    JOIN branches b ON b.company_id=o.company_id AND b.id=o.branch_id
    JOIN users u ON u.id=o.initial_admin_id
    JOIN memberships m ON m.company_id=o.company_id AND m.user_id=o.initial_admin_id
    WHERE o.singleton=1`)).rows[0];
  if (!row) throw new Error('No production-onboarding company marker exists. This command only supplements the existing real company; use bootstrap only for a genuinely blank database.');
  return row;
}

async function previewExistingCompany(pool) {
  const client = await pool.connect();
  try {
    const identity = (await client.query('SELECT current_user AS role')).rows[0];
    if (identity.role !== 'erp_owner') throw new Error('Starter seeding must connect as the dedicated erp_owner migration role.');
    const company = await readCompany(client);
    const seeded = (await client.query('SELECT completed_at FROM production_company_scaffolds WHERE company_id=$1 AND template_code=$2', [company.company_id,TEMPLATE_CODE])).rows[0];
    return {...company,alreadySeeded:Boolean(seeded),completedAt:seeded?.completed_at ?? null};
  } finally { client.release(); }
}

async function seedExistingCompany(input, options = {}) {
  assertSeedConfiguration();
  const companyCode = normalizeCompanyCode(input.companyCode);
  const expectedConfirmation = `SEED STARTER ${companyCode}`;
  if (String(input.confirmation ?? '').trim() !== expectedConfirmation) throw new Error(`Confirmation must exactly match: ${expectedConfirmation}`);
  const pool = options.pool || new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  const createdPool = !options.pool;
  const client = await pool.connect();
  const requestId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    const identity = (await client.query('SELECT current_user AS role,current_database() AS database')).rows[0];
    if (identity.role !== 'erp_owner') throw new Error('Starter seeding must connect as the dedicated erp_owner migration role.');
    await verifyMigrations(client);
    const serviceIdentity = await client.query("SELECT 1 FROM users WHERE id=$1 AND principal_type='SYSTEM' AND service_code='AUTH_SERVICE'", [AUTH_SERVICE]);
    if (!serviceIdentity.rowCount) throw new Error('Required internal authentication-service identity is unavailable.');
    const company = await readCompany(client);
    if (company.company_code !== companyCode) throw new Error(`The existing production onboarding marker is for ${company.company_code}, not ${companyCode}; no data was changed.`);
    if (!company.company_active || !company.admin_active || !company.membership_active || company.principal_type !== 'HUMAN') {
      throw new Error('The initial company administrator or membership is inactive/unavailable; refusing owner-seeded product-reference attribution.');
    }
    const priorRun = (await client.query('SELECT completed_at FROM production_company_scaffolds WHERE company_id=$1 AND template_code=$2', [company.company_id,TEMPLATE_CODE])).rows[0];
    if (priorRun) {
      await client.query('COMMIT');
      return {alreadySeeded:true,companyId:company.company_id,companyCode:company.company_code,completedAt:priorRun.completed_at};
    }

    await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true)", [AUTH_SERVICE,company.company_id]);
    const temporaryRoleId = randomUUID();
    const temporaryRoleName = `Temporary starter-reference setup ${requestId}`;
    // The existing bootstrap administrator may predate products:manage. Grant it
    // only through a unique temporary role in this transaction; remove that role
    // before commit. Each created catalog reference still records the real human
    // admin as its governed actor and gets its exact row snapshot in the audit.
    await client.query('INSERT INTO roles(id,company_id,name,created_by) VALUES($1,$2,$3,$4)', [temporaryRoleId,company.company_id,temporaryRoleName,AUTH_SERVICE]);
    await client.query("INSERT INTO role_permissions(company_id,role_id,permission_code) VALUES($1,$2,'products:manage')", [company.company_id,temporaryRoleId]);
    await client.query('INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)', [company.company_id,company.admin_id,temporaryRoleId]);

    const seededAccounts = await seedChartOfAccounts(client,company.company_id,AUTH_SERVICE);
    const seededYears = await seedFiscalPeriods(client,company.company_id,AUTH_SERVICE);
    await seedMainWarehouse(client,company.company_id,company.branch_id,company.branch_name,AUTH_SERVICE);
    const setupDetails = {
      template:TEMPLATE_CODE, companyCode:company.company_code, branchId:company.branch_id,
      adminActorId:company.admin_id, temporaryProductsManageRole:true,
      chartAccounts:seededAccounts, expectedFiscalYears:seededYears,
      warehouseCode:'MAIN', productReferenceCodes:['EA','KG','GENERAL','SERVICE','Unbranded'],
      policy:'additive only; existing rows are never overwritten; no taxes, registered business masters, inventory, transactions or opening balances'
    };
    const reason='Operator-confirmed additive starter scaffold for existing production company';
    await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true),set_config('app.reason',$3,true)", [AUTH_SERVICE,company.company_id,reason]);
    await client.query(`INSERT INTO audit_logs(company_id,actor_id,action,module,entity_type,entity_id,request_id,new_values,reason)
      VALUES($1,$2,'PRODUCTION_STARTER_SCAFFOLD','CORE','COMPANY_SETUP',$1,$3,jsonb_build_object('before',NULL,'after',$4::jsonb),$5)`,
    [company.company_id,AUTH_SERVICE,requestId,JSON.stringify(setupDetails),reason]);
    await client.query(`INSERT INTO production_company_scaffolds(company_id,template_code,completed_by,request_id,details)
      VALUES($1,$2,$3,$4,$5::jsonb)`, [company.company_id,TEMPLATE_CODE,AUTH_SERVICE,requestId,JSON.stringify(setupDetails)]);

    // Keep as the final audited data operation. The governed-reference audit
    // constraints are deferred and require the human actor context at COMMIT.
    const references = await seedStarterProductReferences(client,company.company_id,company.admin_id);
    await client.query('DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2 AND role_id=$3', [company.company_id,company.admin_id,temporaryRoleId]);
    await client.query('DELETE FROM role_permissions WHERE company_id=$1 AND role_id=$2', [company.company_id,temporaryRoleId]);
    await client.query('DELETE FROM roles WHERE company_id=$1 AND id=$2', [company.company_id,temporaryRoleId]);
    await client.query('COMMIT');
    return {alreadySeeded:false,companyId:company.company_id,companyCode:company.company_code,branchId:company.branch_id,initialAdminId:company.admin_id,seededYears,referenceCounts:{units:references.units.length,categories:references.categories.length,brands:1}};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    if (createdPool) await pool.end();
  }
}

async function main() {
  assertSeedConfiguration();
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run starter seeding from an interactive terminal so the operator can review and confirm the existing company.');
  const pool = new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  try {
    const preview = await previewExistingCompany(pool);
    stdout.write('\nKaribu ERP — one-time additive starter scaffold\n');
    stdout.write(`  Existing production company: ${preview.company_name} [${preview.company_code}]\n`);
    stdout.write(`  Initial branch: ${preview.branch_name}\n`);
    if (preview.alreadySeeded) {
      stdout.write(`Starter scaffold is already recorded as complete (${preview.completedAt}); nothing changed.\n`);
      return;
    }
    stdout.write('  Adds: missing starter chart accounts, non-overlapping prior/current/next calendar years, MAIN warehouse, and audited governed unit/category/brand references.\n');
    stdout.write('  Preserves existing rows; a temporary products:manage role is removed before commit.\n');
    stdout.write('  Does not add tax rules, customers, registered products, stock, transactions, or opening balances.\n');
    const rl = readline.createInterface({input:stdin,output:stdout});
    let answer;
    try { answer=(await rl.question(`Type SEED STARTER ${preview.company_code} to confirm: `)).trim(); }
    finally { rl.close(); }
    const result = await seedExistingCompany({companyCode:preview.company_code,confirmation:answer},{pool});
    if (result.alreadySeeded) stdout.write(`Starter scaffold already completed at ${result.completedAt}; nothing changed.\n`);
    else {
      stdout.write('\nStarter scaffold committed atomically.\n');
      stdout.write(`Company ID: ${result.companyId}\nStarter fiscal years considered: ${result.seededYears.join(', ')}\n`);
      stdout.write('Review preserved existing chart/period/warehouse values and configure company-specific tax and operational masters before financial use. No balances or transactions were created.\n');
    }
  } finally { await pool.end(); }
}

module.exports={assertSeedConfiguration,normalizeCompanyCode,previewExistingCompany,seedExistingCompany};
if(require.main===module)main().catch(error=>{console.error(error.message||'Starter scaffold failed. No credentials were printed.');process.exitCode=1;});
