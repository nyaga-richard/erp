# Increment 0.2 — Phase 1 access and approval controls

Implementation contract, written before code. Scope: strengthen the existing accounting kernel, not add operational CRUD or enable live inventory/payment posting.

## Workflows, permissions and financial effects

| Workflow | Command / permission | Effects | Reversal / history |
|---|---|---|---|
| Provision a new human | users:manage | New global identity with random unusable initial password, company membership, explicitly delegated roles/branch scope, audit. No balance or GL effect. Password established through reset. Existing identities cannot be silently attached/taken over. | Membership deactivation, not deletion |
| Change company access | users:manage, expected membership version, reason | Active membership, roles and allowed branches replaced atomically. Cannot change self, grant outside explicit delegation or remove the last active users:manage administrator. | New audited access change; identities and historical documents remain |
| Create/revise role | roles:manage, expected role version | Permission set must be within explicit per-administrator delegation allowlist, including existing grants on revision. Cannot edit a role the acting administrator holds. All users retain historical activity. | Versioned audit of old/new grants; no role deletion |
| Revoke own session(s) | Authenticated session + CSRF | Single-session or all-session revocation, security event. Does not change another company's membership. | Re-authenticate; revoked tokens never revive |
| Request/reset password | Public generic response; limited by email digest and trusted IP | Durable encrypted delivery record, hashed expiring single-use token. Consumption atomically changes password, consumes outstanding reset tokens and revokes every session. | Reset again; original requests/completion retained in security audit |
| Draft policy | approvals:manage | New immutable policy version, functional-currency threshold and ordered permission steps. No ledger effect. | Supersede with independently published new version |
| Publish policy | approvals:publish, different human than creator | Activate policy; supersede previous active version at the same threshold. Does not affect already submitted documents. | Publish another version; never mutate historical rules |
| Submit source | journals:create, original creator | Resolve highest active threshold not exceeding debit total. Snapshot policy, amount, separation flags, required steps and revision. If no configured threshold applies, use explicit company-baseline one-step policy snapshot. | Reject/revise/cancel before posting |
| Approve source | journals:approve plus active step's permission | Append decision; move APPROVED only when all ordered quorums satisfied. Distinct humans across a revision. Poster exclusion considers every approver, not only the final approver. | Reject before full approval, or revise; prior decisions retained |
| Revise source | journals:edit, original creator, expected revision, reason | Increment revision, archive old contents/approval metadata, clear effective approvals and return DRAFT. No journal effect. Reversal quantities/accounts remain immutable. | Another revision; posted/cancelled sources cannot be revised |
| Reject/cancel source | journals:reject / journals:cancel, expected revision, reason | Controlled transition with actor/time; no financial effect. Posted sources cannot be cancelled. | Rejected → new draft revision; cancellation terminal |

Role names are not authorization rules. Delegation grants are provisioned explicitly, not inferred from an administrator's own posting powers. Administrators cannot assign themselves roles, edit their own roles or grant delegation rights through these APIs. Changing a company membership does not globally deactivate an identity or revoke sessions used for other companies. Global user deactivation/identity federation is outside this increment.

## Transaction and concurrency model

Extract a shared CommandService from AccountingService so administrative commands use the same idempotency and audit boundary without depending on accounting controllers. Financial/workflow commands take a shared company authorization lock; access/role changes take its exclusive form. Revalidate live session, active identity, membership, required permission and branch scope inside that boundary. Hold share locks on actor identity/session through commit so completed revocation/password reset cannot leave a later command posting with a stale session. Consistent lock ordering and integration tests are mandatory. No provider calls inside these database transactions.

Password reset and login lock the same user before updating credentials/sessions. Reset token consumption locks user then token to prevent deadlocks and duplicate consumption. Public requests always acknowledge generically; bounded rate-limit buckets are enforced atomically. Rate-limit data is not an accounting balance. Public requests are attributed to the AUTH_SERVICE principal, not to the unverified email's human owner.

## Schema changes (additive migration 004)

- Global append-only `security_events`, service principal, `auth_rate_limits`, encrypted `auth_delivery_outbox`.
- User/member/role version and attribution fields, explicit company-scoped `permission_delegations`.
- Existing approval policy/step tables promoted to immutable published configuration; decisions extended with step number and revision-level distinct-actor uniqueness.
- `source_documents.approval_snapshot`; append-only `source_revisions` archive old contents, approval metadata and editor/reason.
- Update source state/approval guards. Preserve all existing posted documents and journals; do not replace applied 001–003 migrations.
- Runtime grants restricted to supported core/control tables. New domain services still cannot write inventory, payments, tax or subledgers.

## Reset delivery boundary

No reset token is returned in public API responses, written in audit, logged or stored plaintext in database. Use AES-256-GCM with a separately configured 32-byte key; only its hash belongs in the token table. The outbox worker can deliver via configured SMTP or an explicit development file sink with private filesystem permissions. Delivery is at-least-once (a crash after sending may resend the same link, never mint a second token); consumption is single-use. Do not claim production email/MFA is configured. If no delivery key/adapter is configured, disable the feature clearly rather than silently pretending reset email was sent. Email templates use a configured trusted web origin; never the incoming Host header. Expired jobs must not send usable links.

## UI and API

Add a Control center for members, roles, delegation visibility, policy versions and security events; add own-session management and password reset/change screens. Company financial pages remain permissioned. Administrative users do not receive journal-posting rights by default. Show policy/revision decisions on source timeline; revision/cancellation/rejection dialogs require reasons and expected version. Search/paginate member lists; role/permission/account selection is searchable and bounded.

New API families: `/admin/users`, `/admin/roles`, `/admin/permissions`, `/admin/approval-policies`, `/admin/security-events`; `/auth/sessions`, `/auth/password-reset/request`, `/auth/password-reset/consume`, `/auth/password/change`; `/documents/:id/revise|reject|cancel`. All write DTOs reject supplied actor fields. Financial journals remain immutable.

## Required tests before UI

Existing accounting tests remain green. Add: read-only and company-isolation checks; no self-escalation; no permission grant beyond delegation; stale access/role version; last-admin protection; deactivated membership denial; revoked/expired session denial; single-use/expired/concurrent reset; generic unknown-email response; no plaintext reset secrets in DB/audit; reset invalidates sessions; change-password current-password check; reset rate limits; independently published policy; threshold selection; ordered quorum and unique approvers; creator/poster exclusions across all approvers; policy change cannot alter submitted snapshot; revision preserves creator and all prior decisions while invalidating effective approvals; posted/cancelled edits blocked; durable failure audit; idempotent admin retry; database constraints prevent bypass. Browser-test the actual control-center workflow after backend tests.

Remaining release gates: MFA/step-up, production SMTP/secrets/WORM/monitoring, organization/COA/rule/numbering administration, complete operational close controls, penetration/load/restore tests. Phase 1 remains open until these are addressed; Phase 2 inventory must not bypass the accounting boundary.


## Implementation and verification checkpoint — 26 September 2026

Backend and frontend for this contract are implemented in increment 0.2.0. A shared command coordinator, additive migration 004, recovery worker and two Chromium acceptance scripts accompany the release. Real PostgreSQL/HTTP tests pass, including a separate delegated manager's unsuccessful attempt to remove the last user administrator. Accounting browser coverage now includes revision archival. Control browser coverage includes independent policy publication and actual encrypted-outbox→private-file→reset→login→revoke-all delivery, not just database token inspection. See `test-results.txt`, `browser-test-result.json`, `browser-controls-result.json` and `../STATUS.md` for exact evidence and remaining gates.

Administrative catalogs are bounded rather than fully searchable in this increment: members support server-side search/pagination, roles/policies/branch options and sessions cap at 100. UI forms do not grant the administrator delegation rights they do not already hold. Provisioning an existing global identity, global account deactivation and delegation-owner administration remain deliberately outside the company administrator's API.

Recovery links are stripped from the address bar on initial load and on an in-tab hash navigation. Login requires application/json. Worker success/failure logs omit mail content and recipient address. Production SMTP, key rotation/retention, dedicated worker privileges, MFA and release security review are not completed by the development-file delivery test. Modal focus trapping/accessibility and broader network-failure browser coverage remain open.
