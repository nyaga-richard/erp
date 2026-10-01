# Company super-admin

## Behavior

Super-admin is a **company-scoped membership entitlement**, not a global account role. When enabled, the original company administrator receives every permission code currently in the shared permission catalog; permission checks resolve the catalog dynamically, so newly added codes are included without editing a role. The admin also receives all active branches, and newly created branches are added automatically. Other companies remain inaccessible unless the identity has a separate membership there.

This is not a workflow bypass. Independent creator/reviewer/poster rules, approval quorums, accounting controls, audit requirements, and company/branch boundaries remain in force. In particular, an administrator cannot approve their own work where separation of duties is required.

The grant is deliberately not exposed as a browser/API field. The application database role cannot set the flag. The company member screen labels the entitlement and disables ordinary access editing for that member. The grant is written to both the company audit log and security event log.

## Grant the existing production administrator

The grant targets only `production_onboarding.initial_admin_id`; it cannot promote an arbitrary email. It requires the `erp_owner` credential, checks that the migration is installed and the initial account is active and still has `users:manage`, then asks the operator to type the displayed company code and email exactly.

After installing a specifically reviewed release that contains migration `026-company-super-admin.sql` and the promotion command, run:

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh superadmin
```

This command is **separate from bootstrap and seed-starter**. It does not create another identity, reset a password, alter the Tunnel, or run a production operation until an operator confirms the exact prompt. The administrator continues to sign in with the existing account/password; use the normal password-reset process if credentials need to be established or recovered.

## Recovery and deployment limits

Ordinary company member administration cannot remove or modify a super-admin entitlement. Any later revocation should be a separately reviewed owner-credential operation with an audit record; do not change the flag through the application runtime role or silently edit the database.

The migration and owner command are authored but have **not** been executed against PostgreSQL or production. The current development archive also includes unapplied/unverified invoice migrations `024–025`; do not use that archive wholesale as a production hotfix. Review and validate the complete migration chain before production rollout. No database, production account, deployment, or Tunnel change was made while implementing this feature.
