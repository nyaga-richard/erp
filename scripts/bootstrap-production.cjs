#!/usr/bin/env node
'use strict';

// One-time, owner-credential production tenant/admin bootstrap.
// Never use this script to import opening balances or development/demo data.
const {Pool} = require('pg');
const argon2 = require('argon2');
const {randomBytes, randomUUID, createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const {stdin, stdout} = require('node:process');

const AUTH_SERVICE = '00000000-0000-4000-8000-000000000001';
const BOOTSTRAP_LOCK = 738194205;
const CORE_PERMISSIONS = [
  'workspace:view', 'users:view', 'users:manage', 'roles:view', 'roles:manage',
  'organization:view', 'organization:manage', 'organization:profile:manage',
  'warehouses:view', 'warehouses:manage', 'approvals:view', 'approvals:manage',
  'audit:view', 'security:view', 'accounts:configuration:view'
];

function validateInputs(input) {
  const companyCode = String(input.companyCode ?? '').trim().toUpperCase();
  const companyName = String(input.companyName ?? '').trim();
  const baseCurrency = String(input.baseCurrency ?? '').trim().toUpperCase();
  const branchCode = String(input.branchCode ?? '').trim().toUpperCase();
  const branchName = String(input.branchName ?? '').trim();
  const adminName = String(input.adminName ?? '').trim();
  const adminEmail = String(input.adminEmail ?? '').trim().toLowerCase();
  const errors = [];
  if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(companyCode)) errors.push('Company code must be 2–24 uppercase letters, digits, underscores or hyphens.');
  if (companyName.length < 2 || companyName.length > 120) errors.push('Company name must be 2–120 characters.');
  if (!['KES', 'USD', 'EUR'].includes(baseCurrency)) errors.push('Base currency must be KES, USD or EUR.');
  if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(branchCode)) errors.push('Branch code must be 2–24 uppercase letters, digits, underscores or hyphens.');
  if (branchName.length < 2 || branchName.length > 120) errors.push('Branch name must be 2–120 characters.');
  if (adminName.length < 2 || adminName.length > 100) errors.push('Administrator name must be 2–100 characters.');
  if (adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) errors.push('Enter a valid administrator email address.');
  if (errors.length) throw new Error(errors.join('\n'));
  return {companyCode, companyName, baseCurrency, branchCode, branchName, adminName, adminEmail};
}

function bootstrapAdminPermissions(available) {
  const all = [...new Set(available)];
  const missing = CORE_PERMISSIONS.filter(code => !all.includes(code));
  if (missing.length) throw new Error('Required permissions are missing after migration: ' + missing.join(', '));
  // The first admin may inspect and propose setup, and administer access. Review,
  // approval, posting, reversal, period close and operational-write rights are not
  // assigned to this identity. They can be delegated to distinct authorized users.
  return all.filter(code => CORE_PERMISSIONS.includes(code) || code.endsWith(':view') || code.endsWith(':propose'));
}

function assertProductionConfiguration(env = process.env) {
  if (env.NODE_ENV !== 'production') throw new Error('Production onboarding is available only with NODE_ENV=production.');
  if (!env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required; runtime credentials are not accepted.');
  if (env.AUTH_MAIL_MODE !== 'smtp' || !env.SMTP_URL || !env.SMTP_FROM) throw new Error('Configure production SMTP before onboarding the administrator.');
  if (!/^https:\/\/[^/]+$/.test(env.PUBLIC_WEB_ORIGIN || '')) throw new Error('PUBLIC_WEB_ORIGIN must be a trusted HTTPS origin.');
  if (!/^[a-fA-F0-9]{64}$/.test(env.RESET_ENCRYPTION_KEY || '')) throw new Error('RESET_ENCRYPTION_KEY must be a 32-byte hex key.');
}

async function verifyMigrations(client) {
  const dir = path.resolve(__dirname, '../db');
  const names = fs.readdirSync(dir).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  const rows = (await client.query('SELECT name, checksum FROM schema_migrations')).rows;
  if (rows.length !== names.length) throw new Error('Database migration manifest differs from this release; deploy/migrate before onboarding.');
  const applied = new Map(rows.map(row => [row.name, row.checksum]));
  for (const name of names) {
    const checksum = createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
    if (applied.get(name) !== checksum) throw new Error(`Database migrations are not current (${name}); deploy/migrate before onboarding.`);
  }
}

async function collectInputs() {
  const rl = readline.createInterface({input: stdin, output: stdout});
  try {
    stdout.write('\nKaribu ERP — one-time production tenant onboarding\n');
    stdout.write('This creates a real company, its first branch and initial administrator. It does not import financial records.\n\n');
    return validateInputs({
      companyCode: await rl.question('Permanent company code (e.g. ACME): '),
      companyName: await rl.question('Registered company name: '),
      baseCurrency: await rl.question('Base currency [KES/USD/EUR]: '),
      branchCode: await rl.question('First branch code: '),
      branchName: await rl.question('First branch name: '),
      adminName: await rl.question('Initial administrator full name: '),
      adminEmail: await rl.question('Initial administrator work email: ')
    });
  } finally { rl.close(); }
}

async function bootstrap(input, options = {}) {
  assertProductionConfiguration();
  const company = validateInputs(input);
  const pool = options.pool || new Pool({connectionString: process.env.MIGRATION_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 15000});
  const client = await pool.connect();
  const createdPool = !options.pool;
  const requestId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    const identity = (await client.query('SELECT current_user AS role, current_database() AS database')).rows[0];
    if (identity.role !== 'erp_owner') throw new Error('Onboarding must connect as the dedicated erp_owner migration role.');
    await verifyMigrations(client);
    const serviceIdentity = await client.query("SELECT 1 FROM users WHERE id=$1 AND principal_type='SYSTEM' AND service_code='AUTH_SERVICE'", [AUTH_SERVICE]);
    if (!serviceIdentity.rowCount) throw new Error('Required internal authentication-service identity is unavailable.');
    const marker = (await client.query('SELECT singleton FROM production_onboarding WHERE singleton=1')).rowCount;
    if (marker) throw new Error('Production onboarding has already been completed; refusing to create another tenant.');
    const counts = (await client.query(`SELECT
      (SELECT count(*)::int FROM companies) AS companies,
      (SELECT count(*)::int FROM memberships) AS memberships,
      (SELECT count(*)::int FROM users WHERE principal_type='HUMAN') AS humans`)).rows[0];
    if (counts.companies !== 0 || counts.memberships !== 0 || counts.humans !== 0) {
      throw new Error('Database is not pristine (company, membership or human identity already exists). Refusing bootstrap to protect existing production data.');
    }
    const worker = (await client.query("SELECT last_seen_at > now()-interval '60 seconds' AND last_seen_at <= now()+interval '5 seconds' AS fresh FROM service_heartbeats WHERE service_name='auth-mail'")).rows[0];
    if (!worker?.fresh) throw new Error('Production auth-mail worker is not healthy; configure SMTP and wait for its fresh heartbeat before onboarding.');
    const allowedCurrencies = (await client.query('SELECT code FROM currencies WHERE code=ANY($1::text[])', [[company.baseCurrency]])).rows;
    if (!allowedCurrencies.length) throw new Error(`Base currency ${company.baseCurrency} is not installed in system catalogs.`);
    const permissionRows = (await client.query('SELECT code FROM permissions ORDER BY code')).rows;
    const rolePermissions = bootstrapAdminPermissions(permissionRows.map(row => row.code));
    const adminHash = await argon2.hash(randomBytes(48).toString('base64url'), {type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1});
    const adminId = randomUUID();
    const companyId = randomUUID();
    const branchId = randomUUID();
    const roleId = randomUUID();

    await client.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)', [adminId, company.adminEmail, company.adminName, adminHash]);
    await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true)", [AUTH_SERVICE, companyId]);
    await client.query('INSERT INTO companies(id,code,name,base_currency,created_by) VALUES($1,$2,$3,$4,$5)', [companyId, company.companyCode, company.companyName, company.baseCurrency, AUTH_SERVICE]);
    await client.query('INSERT INTO branches(id,company_id,code,name,created_by) VALUES($1,$2,$3,$4,$5)', [branchId, companyId, company.branchCode, company.branchName, AUTH_SERVICE]);
    await client.query('INSERT INTO memberships(company_id,user_id,created_by) VALUES($1,$2,$3)', [companyId, adminId, AUTH_SERVICE]);
    await client.query('INSERT INTO roles(id,company_id,name,created_by) VALUES($1,$2,$3,$4)', [roleId, companyId, 'Initial company administrator', AUTH_SERVICE]);
    for (const permission of rolePermissions) await client.query('INSERT INTO role_permissions(company_id,role_id,permission_code) VALUES($1,$2,$3)', [companyId, roleId, permission]);
    await client.query('INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)', [companyId, adminId, roleId]);
    await client.query('INSERT INTO user_branch_scopes(company_id,user_id,branch_id) VALUES($1,$2,$3)', [companyId, adminId, branchId]);
    // The initial company administrator can deliberately delegate the catalogued
    // permission set to separately named people; self-access changes remain blocked.
    await client.query('INSERT INTO permission_delegations(company_id,user_id,permission_code,granted_by) SELECT $1,$2,code,$2 FROM permissions', [companyId, adminId]);

    const auditValues = {companyId, companyCode: company.companyCode, companyName: company.companyName, baseCurrency: company.baseCurrency, branchId, branchCode: company.branchCode, initialAdminId: adminId, requestId};
    await client.query(`INSERT INTO audit_logs(company_id,actor_id,action,module,entity_type,entity_id,request_id,new_values,reason)
      VALUES($1,$2,'PRODUCTION_ONBOARDING','CORE','COMPANY',$3,$4,$5,'Operator-confirmed first-company and initial administrator bootstrap')`, [companyId, AUTH_SERVICE, companyId, requestId, JSON.stringify({after: auditValues})]);
    await client.query(`INSERT INTO security_events(company_id,actor_id,subject_user_id,action,outcome,request_id,details)
      VALUES($1,$2,$3,'PRODUCTION_ONBOARDING','SUCCESS',$4,$5)`, [companyId, AUTH_SERVICE, adminId, requestId, JSON.stringify({companyCode: company.companyCode, branchCode: company.branchCode, initialAdminId: adminId})]);
    await client.query(`INSERT INTO production_onboarding(singleton,company_id,branch_id,initial_admin_id,completed_by,request_id)
      VALUES(1,$1,$2,$3,$4,$5)`, [companyId, branchId, adminId, AUTH_SERVICE, requestId]);
    await client.query('COMMIT');
    return {companyId, branchId, initialAdminId: adminId, roleId, grantedPermissions: rolePermissions.length};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    if (createdPool) await pool.end();
  }
}

async function main() {
  assertProductionConfiguration();
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run production onboarding from an interactive terminal so the operator can review and confirm the tenant details.');
  const input = await collectInputs();
  stdout.write('\nReview before proceeding (this cannot be repeated):\n');
  stdout.write(`  Company: ${input.companyName} [${input.companyCode}], base ${input.baseCurrency}\n`);
  stdout.write(`  First branch: ${input.branchName} [${input.branchCode}]\n`);
  stdout.write(`  Initial administrator: ${input.adminName} <${input.adminEmail}>\n`);
  stdout.write('  Data created: company, branch, administrator, restricted setup role and onboarding audit.\n');
  stdout.write('  Not created: chart of accounts, fiscal periods, tax configuration, customers, products, stock or opening balances.\n\n');
  const rl = readline.createInterface({input: stdin, output: stdout});
  try {
    const prompt = `Type CREATE ${input.companyCode} to confirm: `;
    const expected = `CREATE ${input.companyCode}`;
    const answer = (await rl.question(prompt)).trim();
    if (answer !== expected) throw new Error('Confirmation did not match. No tenant was created.');
  } finally { rl.close(); }
  const result = await bootstrap(input);
  stdout.write('\nProduction onboarding committed. No password or reset token was printed.\n');
  stdout.write(`Company ID: ${result.companyId}\nInitial administrator ID: ${result.initialAdminId}\n`);
  stdout.write(`The administrator must use “Forgot password” at ${process.env.PUBLIC_WEB_ORIGIN} to receive a single-use setup link by SMTP.\n`);
  stdout.write('Retain this release and the database backup. Configure reviewed fiscal periods, chart of accounts, tax settings and approved opening balances before financial use.\n');
}

module.exports = {validateInputs, bootstrapAdminPermissions, assertProductionConfiguration, verifyMigrations, bootstrap};
if (require.main === module) main().catch(error => { console.error(error.message || 'Production onboarding failed. No credentials were printed.'); process.exitCode = 1; });
