#!/usr/bin/env node
'use strict';

// Explicit Day-2 promotion of only the immutable initial production company admin.
// Uses the isolated migration/owner credential and requires a typed confirmation.
const {Pool} = require('pg');
const {randomUUID} = require('node:crypto');
const {stdin,stdout} = require('node:process');
const readline = require('node:readline/promises');
const AUTH_SERVICE = '00000000-0000-4000-8000-000000000001';

async function promoteInitialSuperAdmin(env=process.env, io={stdin,stdout}, PoolCtor=Pool) {
  if(env.NODE_ENV!=='production') throw new Error('Super-admin promotion is restricted to the production operator command.');
  if(!env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required; runtime credentials are not accepted.');
  const pool=new PoolCtor({connectionString:env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  const c=await pool.connect();
  try {
    const identity=(await c.query('SELECT current_user AS role')).rows[0];
    if(identity.role!=='erp_owner') throw new Error('Promotion must connect as the dedicated erp_owner migration role.');
    const migration=(await c.query("SELECT 1 FROM schema_migrations WHERE name='026-company-super-admin.sql'")).rowCount;
    if(!migration) throw new Error('The super-admin schema migration is not applied. Deploy and migrate the reviewed release first.');
    const admin=(await c.query(`SELECT c.id AS company_id,c.code AS company_code,c.name AS company_name,c.active AS company_active,
        u.id AS admin_id,u.email,u.display_name,u.active AS user_active,m.active AS membership_active,m.super_admin,
        EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id
          WHERE ur.company_id=m.company_id AND ur.user_id=m.user_id AND rp.permission_code='users:manage') AS can_manage_users
      FROM production_onboarding o JOIN companies c ON c.id=o.company_id
      JOIN users u ON u.id=o.initial_admin_id JOIN memberships m ON m.company_id=o.company_id AND m.user_id=o.initial_admin_id
      WHERE o.singleton=1`)).rows[0];
    if(!admin) throw new Error('No production-onboarding record found; this command only promotes the original initial company administrator.');
    if(!admin.company_active||!admin.user_active||!admin.membership_active) throw new Error('The initial administrator or company is inactive. Resolve access through the reviewed recovery process first.');
    if(!admin.can_manage_users) throw new Error('The initial administrator no longer has users:manage; refusing automatic privilege escalation.');
    if(admin.super_admin) return {alreadySuperAdmin:true,companyCode:admin.company_code,email:admin.email};
    stdout.write(`\nGrant company-scoped all-permissions super-admin access to the original administrator?\nCompany: ${admin.company_name} (${admin.company_code})\nUser: ${admin.display_name} <${admin.email}>\nThis does not cross company boundaries or bypass independent approvals.\nType exactly: GRANT SUPER ADMIN ${admin.company_code} ${admin.email}\n> `);
    const rl=readline.createInterface({input:io.stdin,output:io.stdout,terminal:Boolean(io.stdin.isTTY)});
    let answer; try { answer=await rl.question(''); } finally { rl.close(); }
    if(answer.trim()!==`GRANT SUPER ADMIN ${admin.company_code} ${admin.email}`) throw new Error('Confirmation did not match; no change was made.');

    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('company-super-admin-promotion',77))");
    const current=(await c.query('SELECT super_admin,active FROM memberships WHERE company_id=$1 AND user_id=$2 FOR UPDATE',[admin.company_id,admin.admin_id])).rows[0];
    if(!current?.active) throw new Error('Initial administrator membership became inactive; no change was made.');
    if(current.super_admin) { await c.query('COMMIT'); return {alreadySuperAdmin:true,companyCode:admin.company_code,email:admin.email}; }
    const requestId=randomUUID(),reason=`Operator-confirmed permanent super-admin grant to original administrator ${admin.email}`;
    await c.query("SELECT set_config('app.actor_id',$1,true),set_config('app.company_id',$2,true),set_config('app.reason',$3,true)",[AUTH_SERVICE,admin.company_id,reason]);
    await c.query('UPDATE memberships SET super_admin=true,version=version+1,updated_by=$3,updated_at=now() WHERE company_id=$1 AND user_id=$2',[admin.company_id,admin.admin_id,AUTH_SERVICE]);
    await c.query('INSERT INTO user_branch_scopes(company_id,user_id,branch_id) SELECT b.company_id,m.user_id,b.id FROM branches b JOIN memberships m ON m.company_id=b.company_id WHERE b.company_id=$1 AND m.user_id=$2 ON CONFLICT DO NOTHING',[admin.company_id,admin.admin_id]);
    const change={userId:admin.admin_id,email:admin.email,scope:'COMPANY',permissions:'ALL_CURRENT_AND_FUTURE_CATALOGUED',before:false,after:true};
    await c.query(`INSERT INTO audit_logs(company_id,actor_id,action,module,entity_type,entity_id,request_id,new_values,reason)
      VALUES($1,$2,'COMPANY_SUPERADMIN_GRANT','CORE','USER',$3,$4,$5::jsonb,$6)`,[admin.company_id,AUTH_SERVICE,admin.admin_id,requestId,JSON.stringify(change),reason]);
    await c.query(`INSERT INTO security_events(company_id,actor_id,subject_user_id,action,outcome,request_id,details)
      VALUES($1,$2,$3,'COMPANY_SUPERADMIN_GRANT','SUCCESS',$4,$5::jsonb)`,[admin.company_id,AUTH_SERVICE,admin.admin_id,requestId,JSON.stringify({companyCode:admin.company_code,scope:'COMPANY',reason})]);
    await c.query('COMMIT');
    return {alreadySuperAdmin:false,companyCode:admin.company_code,email:admin.email,permissions:'all current and future company permission codes'};
  } catch(e) {
    await c.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally { c.release(); await pool.end(); }
}
if(require.main===module) promoteInitialSuperAdmin().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={promoteInitialSuperAdmin};
