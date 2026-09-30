# Security implementation and open gates

Read the original [API/security contract](../03-api-security.md), [phase-one controls](../05-phase1-controls.md) and [preview recovery contract](../08-preview-session-recovery.md) alongside the live requirement matrix. The latter distinguishes tested core controls from unfinished operational modules.

## Executed controls

- Real password verification, hashed server sessions, expiry/inactivity limits, CSRF, logout/self-revocation, password change/reset, company membership and branch scope. Login/reset responses do not disclose raw stored hashes.
- Permissions are explicit grants; neither role names nor client-supplied actor IDs authorize commands. CommandService rechecks current user/session/membership/grants after acquiring the transaction lock, preventing stale permissions from being used after a concurrent access change.
- Runtime PostgreSQL principal is `erp_runtime`, not the owner. Composite tenant FKs, RLS, deferred balanced-journal/source/audit constraints and immutable posted data reinforce application checks. Owner migration/recovery access remains a privileged trust boundary; do not expose its connection string to the API.
- Auth delivery uses a separate `erp_auth_worker` principal with narrow outbox/token/heartbeat/security-event permissions. Migration 009 rejects a human actor, wrong audit action or unmatched job metadata from that role. It cannot read financial journal data. Encryption keys/provider credentials are operator secrets, never release artifacts.
- Number allocator guards require monotonically increasing counters, immutable established formats and a matching source/journal in the allocation transaction. Financial rollback also rolls back allocation.
- Optional JSON HTTP logs include only generated request ID, route template, method, status, duration and authenticated actor. Errors omit SQL, credentials, stack traces and payload bodies. Failed financial commands are separately audited after rollback; a failed audit persistence attempt emits an operational alert rather than silently pretending success.

## Browser and ingress

Next production pages use a fresh nonce CSP/strict-dynamic and deny framing. Cookie sessions are Secure/HttpOnly in production and the development memory transport is forbidden at startup. Native local development can use explicitly configured non-Secure cookies; Arena's private development iframe uses explicit memory transport because cookie availability differs by browser/platform. Memory credentials are JavaScript-readable and **not equivalent to HttpOnly**; they never enter storage/URLs/logs and disappear on reload.

Do not loosen CORS, enable blanket trust-proxy, expose infrastructure ports, or reuse preview traffic tokens to solve sign-in. The API currently avoids trusting arbitrary forwarded IP headers. Exact Cloudflare→tunnel→Next→Nest client-IP attribution/rate-limit behavior must be reviewed and tested on the real ingress topology before production acceptance.

## Open gates

Production SMTP delivery/monitoring; MFA and sensitive-action step-up; complete onboarding/account lifecycle; trusted ingress review; container/digest/dependency provenance and security scanning; externally exercised production authentication; business-specific permissions/approval thresholds for unreleased modules; full reconciliation/concurrency/rollback coverage across operational workflows. Current local health, unit tests and iframe simulations are not a penetration test or a production security certificate.

Private paths excluded from source releases include `.env*` except `.env.example`, `.runtime`, `.cache`, mail, backups, TLS keys, DEMO_ACCESS and generated builds. Keep per-environment credentials independent and rotate them through the documented operator path. Do not copy a development seed or its credentials into a production company.

## Demo-seed production boundary

The development seed rejects NODE_ENV=production before opening a database connection and remains separate from real-company onboarding. Production `erpctl bootstrap` is an interactive, one-time first-tenant flow using `erp_owner`, migration checksum validation, a pristine-database check, fresh auth-worker heartbeat, an immutable completion marker and atomic audit. It seeds only a starter chart, three calendar fiscal years, main warehouse and governed product references—never tax rules, registered products/customers, stock, transactions or balances. Local regression and image validation are pending for the latest scaffold integration; no live production database/SMTP run has occurred. This does not certify production readiness.
