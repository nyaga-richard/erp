'use strict';

// Shared starter scaffold for the development seed and explicit first-tenant
// production onboarding. It contains no postings, balances, tax rates, customers,
// or real products. Production bootstrap must clearly disclose it to the operator.
const {randomUUID} = require('node:crypto');

const STARTER_ACCOUNTS = [
  ['1000','Assets','ASSET',null,false],
  ['1100','Cash drawers','ASSET','CASH',true],
  ['1200','Bank','ASSET','PAYMENT',true],
  ['1210','M-Pesa wallet','ASSET','PAYMENT',true],
  ['1300','Trade receivables','ASSET','AR',true],
  ['1400','Merchandise inventory','ASSET','INVENTORY',true],
  ['1500','Recoverable input VAT','ASSET','TAX',true],
  ['2000','Liabilities','LIABILITY',null,false],
  ['2100','Trade payables','LIABILITY','AP',true],
  ['2110','Goods received not invoiced','LIABILITY','GRNI',true],
  ['2120','Customer deposits','LIABILITY','DEPOSITS',true],
  ['2200','Output VAT','LIABILITY','TAX',true],
  ['3000','Equity','EQUITY',null,false],
  ['3100','Opening equity','EQUITY',null,true],
  ['3200','Retained earnings','EQUITY',null,true],
  ['4000','Sales revenue','REVENUE',null,true],
  ['5000','Cost of goods sold','EXPENSE',null,true],
  ['5100','Stock loss / damage','EXPENSE',null,true],
  ['6000','Operating expenses','EXPENSE',null,false],
  ['6100','Rent','EXPENSE',null,true],
  ['6200','Utilities','EXPENSE',null,true],
  ['6300','Cash over / short','EXPENSE',null,true],
];

function starterFiscalYears(currentYear = new Date().getUTCFullYear()) {
  return [currentYear - 1, currentYear, currentYear + 1].filter(year => year >= 1 && year <= 9999);
}

async function seedChartOfAccounts(client, companyId, createdBy) {
  for (const [code, name, type, control, postable] of STARTER_ACCOUNTS) {
    await client.query(`INSERT INTO accounts(company_id,code,name,account_type,control_type,postable,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(company_id,code) DO NOTHING`,
    [companyId, code, name, type, control, postable, createdBy]);
  }
  for (const prefix of ['1','2','3','6']) {
    await client.query(`UPDATE accounts child SET parent_id=parent.id
      FROM accounts parent
      WHERE child.company_id=$1 AND parent.company_id=$1 AND parent.code=$2
        AND child.code LIKE $3 AND child.code<>$2 AND child.parent_id IS NULL
        AND child.code=ANY($4::text[])`,
    [companyId, prefix + '000', prefix + '%', STARTER_ACCOUNTS.map(account => account[0])]);
  }
  return STARTER_ACCOUNTS.length;
}

async function seedFiscalPeriods(client, companyId, createdBy, currentYear) {
  const years = starterFiscalYears(currentYear);
  for (const year of years) {
    const startsOn = `${year}-01-01`;
    const endsOn = `${year}-12-31`;
    await client.query(`INSERT INTO financial_periods(company_id,name,starts_on,ends_on,created_by)
      SELECT $1,$2,$3::date,$4::date,$5
      WHERE NOT EXISTS (
        SELECT 1 FROM financial_periods WHERE company_id=$1
          AND daterange(starts_on,ends_on,'[]') && daterange($3::date,$4::date,'[]')
      )`, [companyId, `FY ${year}`, startsOn, endsOn, createdBy]);
  }
  return years;
}

async function seedMainWarehouse(client, companyId, branchId, branchName, createdBy) {
  await client.query(`INSERT INTO warehouses(company_id,branch_id,code,name,location_type,created_by)
    SELECT $1,$2,'MAIN',$3,'SELLABLE',$4
    WHERE NOT EXISTS(SELECT 1 FROM warehouses WHERE company_id=$1 AND code='MAIN')`,
  [companyId, branchId, `${branchName} — Main warehouse`, createdBy]);
}

async function seedProductReference(client, {kind, companyId, actorId, code = null, name, quantityScale}) {
  const table = kind === 'UNIT' ? 'units_of_measure' : kind === 'CATEGORY' ? 'product_categories' : kind === 'BRAND' ? 'brands' : null;
  if (!table) throw new Error(`Unsupported starter reference kind: ${kind}`);
  const lookup = kind === 'BRAND' ? 'name=$2' : 'code=$2';
  const lookupValue = kind === 'BRAND' ? name : code;
  const existing = (await client.query(`SELECT id,catalog_version FROM ${table} WHERE company_id=$1 AND ${lookup}`,
    [companyId, lookupValue])).rows[0];
  if (existing) {
    if (existing.catalog_version !== 1) throw new Error(`Existing legacy ${kind} reference conflicts with starter setup; refusing to promote or overwrite it.`);
    return existing.id;
  }

  const reason = 'Starter company setup — governed product reference';
  await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true),set_config('app.reason',$3,true)",
    [actorId, companyId, reason]);
  let snapshot;
  if (kind === 'UNIT') {
    snapshot = (await client.query(`INSERT INTO units_of_measure(company_id,created_by,name,catalog_version,code,quantity_scale)
      VALUES($1,$2,$3,1,$4,$5) RETURNING to_jsonb(units_of_measure) AS snapshot`,
    [companyId, actorId, name, code, quantityScale])).rows[0].snapshot;
  } else if (kind === 'CATEGORY') {
    snapshot = (await client.query(`INSERT INTO product_categories(company_id,created_by,name,catalog_version,code,parent_id)
      VALUES($1,$2,$3,1,$4,NULL) RETURNING to_jsonb(product_categories) AS snapshot`,
    [companyId, actorId, name, code])).rows[0].snapshot;
  } else {
    snapshot = (await client.query(`INSERT INTO brands(company_id,created_by,name,catalog_version)
      VALUES($1,$2,$3,1) RETURNING to_jsonb(brands) AS snapshot`,
    [companyId, actorId, name])).rows[0].snapshot;
  }
  await client.query(`INSERT INTO audit_logs(company_id,actor_id,action,module,entity_type,entity_id,request_id,new_values,reason)
    VALUES($1,$2,'PRODUCT_REFERENCE_CREATE','CORE','PRODUCT_REFERENCE',$3,$4,
      jsonb_build_object('before',NULL,'after',$5::jsonb,'kind',$6),$7)`,
  [companyId, actorId, snapshot.id, randomUUID(), JSON.stringify(snapshot), kind, reason]);
  return snapshot.id;
}

async function seedStarterProductReferences(client, companyId, actorId) {
  const units = [
    await seedProductReference(client, {kind:'UNIT', companyId, actorId, code:'EA', name:'Each', quantityScale:0}),
    await seedProductReference(client, {kind:'UNIT', companyId, actorId, code:'KG', name:'Kilogram', quantityScale:3}),
  ];
  const categories = [
    await seedProductReference(client, {kind:'CATEGORY', companyId, actorId, code:'GENERAL', name:'General merchandise'}),
    await seedProductReference(client, {kind:'CATEGORY', companyId, actorId, code:'SERVICE', name:'Services'}),
  ];
  const brand = await seedProductReference(client, {kind:'BRAND', companyId, actorId, name:'Unbranded'});
  return {units, categories, brand};
}

module.exports = {STARTER_ACCOUNTS, starterFiscalYears, seedChartOfAccounts, seedFiscalPeriods, seedMainWarehouse, seedProductReference, seedStarterProductReferences};
