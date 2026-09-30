# Increment 0.3 contract — preview authentication and branch configuration

Written before implementation. Phase 1 stays open. No operational balance or stock writes.

## Preview authentication correction

Observed: a successful login is in server history during the user's reported failure. Current session cookies are SameSite=Strict, which are unsuitable for a cross-site embedded preview. A raw e2b hostname also returns a platform traffic-token 403 without Arena's preview authorization; do not publish a raw hostname as a universally usable login link.

Reproduce cross-site iframe authentication in Chromium using a local HTTPS reverse proxy and a separately hosted parent origin. Add an explicit SESSION_COOKIE_MODE=partitioned deployment option: HttpOnly, Secure, SameSite=None, Partitioned. Default stays same-origin strict. Reject insecure partitioned configuration. Never expose the session token in JSON or browser storage, weaken CSRF checks, or add permissive CORS. Logout must use matching cookie attributes. A successful password followed by absent session must produce an actionable cookie/preview diagnostic, not misleading invalid-password advice. Use Arena's live preview/open-in-new-tab controls; platform traffic authorization is not an ERP credential.

Tests: strict default, secure partitioned opt-in, invalid insecure configuration, cookie flags, session survival/reload and logout in a genuinely cross-site iframe, CSRF still denied. Test the existing three-user accounting flow as a regression.

## Branch configuration slice

Workflow: permissioned organization viewer searches current-company branches; an explicitly delegated organization manager creates or revises code/name/active state with a reason and optimistic version. Branch creation gives nobody automatic access. Existing branch-scope assignment remains the member administrator's workflow. No hard-coded role-name authorization.

Entities: existing company → branch → warehouse/source/journal relations. Add branch version/created_at/updated_by/updated_at; preserve original creator. Code is immutable once created. No delete command. Company/base currency, warehouses, COA, accounting rules and numbering configuration remain subsequent slices.

Permissions: organization:view and organization:manage; current-company membership required. Add permissions to catalog, not automatically to arbitrary existing roles. Demo seed explicitly grants the development administrator these permissions and delegation entries.

Commands: GET /admin/branches?q=&page=&limit=; POST /admin/branches; POST /admin/branches/:id/revise. Strict DTOs reject frontend actors and company IDs. Commands use the existing idempotency/atomic-audit coordinator and exclusive company configuration lock; accounting takes the shared lock, preventing deactivation/post races. New branch defaults active. New access is never inferred from administrative authority.

Effects: no GL, stock, tax or subledger effect. Creator cannot be overwritten. Revision records before/after and reason in immutable audit. Deactivation blocks new financial work and branch scope selection; reject deactivation if pending unposted sources or active warehouses exist. Posted history remains readable. Correction is another attributed version; no destructive rollback. Direct runtime SQL guards protect immutable code/company/creator and version increments.

Tests before UI: read-only denial, company isolation, impersonation/unknown fields, idempotent retry and changed-body conflict, duplicate code, stale version, creator preservation, pending-work/warehouse deactivation guard, inactive-branch posting denial, existing journal counts unchanged, audit coverage and SQL identity mutation denial. Then a browser create → revise → deactivate → reactivate flow; no dummy balances.


## Verified implementation checkpoint

At the increment 0.3 checkpoint, these controls were implemented and deployed to the development preview. 49 backend tests passed; four browser workflows passed, including branch create/revise/deactivate/reactivate and a genuinely cross-site TLS iframe. The cookie names are distinct: strict `erp_session`, partitioned `__Host-erp_preview`. Tests also verify that an old cookie from the other mode cannot shadow the authenticated identity. Insecure production or partitioned configuration fails at startup. Matching logout cookie attributes clear the correct partition.

The two local HTTPS origins are 127.0.0.1 and localhost on an ephemeral test proxy. The first attempt using a public-looking synthetic parent was correctly stopped by Chromium's local-network access rules; the final test keeps both endpoints local but cross-site, without disabling browser cookie protections. Test private keys stay in excluded .cache. Arena's traffic token is never read or bypassed by this test.

Branch revision uses runtime-only updatable column grants and a deferred atomic-audit constraint; owner bootstrap is explicitly separate. Existing inactive scopes can be retained, never newly granted, and new members start with no branch scopes selected. Seed permissions are development fixtures, not a production delegation-owner API. Company/warehouse/COA/rule/numbering administration, MFA, production mail and full release security remain unfinished.


### Integrated accounting acceptance extension

Branch-scoped source/journal numbers can repeat across branches. Read projections and the UI must display the immutable branch code alongside the number. Verify a journal in the newly configured branch through submission, approval and posting, then deactivate the now-idle branch and prove the immutable posting is still readable to already-scoped users but not an out-of-scope auditor. No journal is changed by deactivation.
