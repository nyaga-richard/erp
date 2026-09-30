# API, authorization and user experience contracts

## Contract conventions

Target API `/api/v1`; money/quantity/rates are decimal **strings**, never JSON floating point. UUID IDs; ISO UTC timestamps; ISO local business dates use Africa/Nairobi unless company overrides. Company selected by `X-Company-ID` but accepted only after membership validation. Branch/warehouse/terminal scope is checked independently. Pagination defaults 25, maximum 100, stable allow-listed sorting and cursor (or bounded offset in foundation); `q` length bounded and SQL values parameterized. Search indexes cover normalized identifiers, phone, PIN, barcode and trigram name. All responses avoid secrets and unnecessary PII.

Write commands require `Idempotency-Key` (bounded opaque identifier) and optimistic revision where editable. Scope idempotency to company+actor+command+key; canonical body hash must match on replay, otherwise 409. A completed command returns its original source identifier. Provider deduplication is additionally unique by company/provider merchant/external transaction ID, independent of human request keys. Accounting posting is unique by source/event. No duplicate posting on retry.

Errors: 400 malformed/invalid; 401 no valid session; 403 denied permission/scope; 404 not visible/found; 409 state/version/idempotency conflict; 422 valid input failing business policy; 429 rate limit; 503 external/temporary unavailable. Error object: `{code,message,requestId,details?}`. Validation responses expose safe field-level details; no SQL, stack, token or cross-company information. Financial failures are never represented as 200 success. 202 is only accepted-for-processing and must include status URL.

## Foundation API (see implementation status for exact coverage)

| Method / path | Permission | Purpose |
|---|---|---|
| POST /auth/login | public, throttled | Email/password → opaque session + CSRF token |
| POST /auth/logout | authenticated + CSRF | Revoke current session |
| GET /auth/me | authenticated | User, companies, permissions; no token hashes |
| GET /accounts | accounting:view | Company chart |
| GET /periods | accounting:view | Company periods |
| POST /periods/:id/close | periods:close | Lock/check/close with audit |
| POST /periods/:id/reopen | periods:reopen | Reasoned reopening, audited |
| POST /journals/drafts | journals:create | Create source document + immutable creator |
| POST /documents/:id/submit | journals:create | Creator submits draft |
| POST /documents/:id/approve | journals:approve | Independent approval |
| POST /documents/:id/post | journals:post | Post balanced non-control manual journal |
| POST /journals/:id/reversal-drafts | journals:reverse | Create request; approval/post required |
| GET /documents | journals:view | Paginated/searchable sources |
| GET /documents/:id | journals:view | Attribution, transitions, journal drilldown |
| GET /journals | accounting:view | Immutable posted journals |
| GET /reports/trial-balance | accounting:view | Derived account debit/credit totals |
| GET /reports/integrity | accounting:view | Core journal/source invariants only |
| GET /audit | audit:view | Company-filtered events |

## Target domain command catalog (not implemented by merely declaring routes)

| Domain | Read/search resources | Commands |
|---|---|---|
| Identity | users, roles, permissions, login-history, sessions | activate/deactivate, grant/revoke, reset request/consume, revoke session |
| Organization | companies, branches, warehouses, terminals | configure, deactivate; audited |
| Catalog | products, categories, prices, barcodes, tax-categories | create, revise, activate/deactivate |
| Sales/POS | carts, holds, quotations, orders, sales, receipts | quote, hold, resume, reserve, checkout, release, cancel draft, reprint |
| Customers | customers, accounts, statements, aging, open-items | onboard, change-credit-policy, credit-hold, migrate-opening |
| Suppliers | suppliers, accounts, statements, aging, invoices | onboard, change-bank-details, migrate-opening |
| Purchasing | requests, orders, receipts, invoices, match-exceptions | submit/approve/reject, receive, match, approve-variance, post |
| Returns | sale-returns, purchase-returns, credit/debit-notes | request, approve, receive/dispatch, post-credit, refund |
| Inventory | on-hand, movements, valuation, reservations, lots | reserve/release, dispatch/receive-transfer, start/count/approve/post-count, adjust-value |
| Payments | intents, attempts, allocations, settlement | initiate, verify, allocate/unallocate, approve-disbursement, reverse, reconcile |
| Cashiers | sessions, cash movements, cash counts | open, activate, record-tender, reconcile, approve-variance, close |
| Expenses | expenses, categories, petty-cash | submit/approve/post, replenish, count, reverse |
| Tax | rules, versions, facts, fiscal-submissions | schedule-version, validate-configuration, submit-fiscal, retry, credit-note |
| Accounting | accounts, rules, periods, journals, GL | configure/version, draft, submit/approve/post, reverse, close/reopen |
| Reporting | sales, purchases, cash, inventory, GL, P&L, BS, cash flow, aging | request export, poll job, retrieve signed download |
| Audit/attachments | events, file metadata | upload-ticket, scan, link, retrieve-authorized; no posted delete |

Nested effects never receive their own public “set balance” routes. Unimplemented APIs must return 404/501 rather than mocked success.

## Permission matrix (starter grants, editable data)

C=create, V=view, E=edit draft, A=approve, P=post, R=reverse/return. These are descriptions; stored keys remain granular action permissions. Roles are data, not special cases in controllers.

| Domain | Cashier | Storekeeper | Purchasing | Accountant | Manager | Auditor |
|---|---|---|---|---|---|---|
| POS/sales | CV, scoped checkout | V | — | V | V/A discounts | V |
| Customers | V/search, C permitted | — | — | CV, credit proposal | A credit | V |
| Refunds/returns | C request | Receive authorized | C supplier return | P approved | A | V |
| Stock | V assigned store | CV counts/transfers | V | V valuation | A adjustments | V |
| Purchasing | — | V/receive approved | CVE/submit | V match/P invoice | A PO/variance | V |
| Payments | Receive assigned shift | — | Propose supplier | CV/P approved | A disbursements | V |
| Expenses | Request only | Request only | Request only | CV/P | A | V |
| Journals/periods | — | — | — | CVE/P, close proposal | A/reopen separately | V |
| Reports | Own session | Assigned stores | Purchasing | Finance | Company | Company V/export |
| Identity/configuration | — | — | — | V finance config | — | V changes |
| Audit | Own receipt activity | Own stock activity | Own purchasing | Finance V | Company V | Company V |

Security administrator manages users/roles but has no automatic financial-posting powers. Break-glass is time-bound, independently approved and prominently audited. Role assignment cannot escalate beyond assigner's delegated permission set. Branch scope constrains grants; explicit company membership is required. Segregation rules apply even if a user has every permission.

## Authentication and security target

Argon2id password hashing, unique normalized email, breached/common password checks, password reset single-use hash with expiry, generic reset response, revoke all sessions after reset/deactivation. Opaque random session token, hash stored in DB, absolute and idle timeout, server-side revocation; HttpOnly Secure SameSite cookies in production with CSRF for writes. Session fixation prevented by new random token at login. Successful login history and failed attempts recorded without plaintext secrets. Rate limits keyed by normalized account and trusted IP; bounded lockout avoids indefinite denial of service. MFA/step-up required before high-risk production actions (future release gate).

Machine principals use managed credentials/workload identity, scoped permissions and short-lived access; they are not anonymous users. Tenant context is transaction-local and not reused across pool checkout. RLS app role cannot bypass policies. Composite foreign keys prevent attaching another company's account/customer/warehouse even when a caller knows its UUID. Tests must attack cross-tenant reads and writes.

Uploads: allow-listed types, magic-byte checks, bounded size, random object names, malware quarantine, private bucket, short-lived authorized downloads, content disposition, no user executable SVG/HTML inline. No frontend storage of payment secrets; card integration uses provider tokenization and never stores PAN/CVV. Strict CSP, safe headers, allow-listed CORS, TLS and no public DB. Dependency scanning/SBOM, secret rotation and signed release artifacts.

## UI/UX target

Workspace with company/branch switcher, persistent user/session identity, dashboard and permission-filtered nav. Large searchable inputs with debounced server query, cursor pagination, keyboard-selectable results; no thousand-item dropdown. Tables support filter chips, stable sort, explicit timezone, current scope, user and source drilldown. Loading skeleton, empty explanation, recoverable error and request ID. Show money in currency, never abbreviate exact document totals.

Document view includes workflow banner, timeline of creator/approver/poster/reverser, line totals, operational links, tax snapshot, payment state and balanced-journal panel. Display action permissions and reason for disabled action; backend repeats validation. Dirty-form warnings, explicit destructive/financial confirmation, idempotent retry after network failure. Light/dark themes, WCAG keyboard/focus/contrast, desktop/tablet layouts. POS optimizes scan focus and cashier speed while preventing Enter from accidentally re-submitting a posting.

Offline checkout is disabled initially. Future offline mode requires device identity, signed queued commands, durable local encrypted queue, temporary IDs and deterministic idempotency. Offline displays provisional receipt only; server validates pricing/stock/credit/fiscal policy and may quarantine conflicts. It must not claim committed stock or payment before synchronization.


## Increment 0.2 implemented additions

Member and delegated role administration, independently published threshold/quorum policies, company security events, own-session lifecycle, encrypted password recovery/change, and reasoned source revision/rejection/cancellation are implemented. At increment 0.2 the generated OpenAPI documented 36 paths. Access edits share the command transaction/idempotency boundary with accounting but require exclusive company authorization locks. Public recovery never returns reset tokens; login requires application/json. See [the preimplementation control contract and verification checkpoint](05-phase1-controls.md) and [current status](../STATUS.md). Read payloads still use generic Record schemas in parts of the reference specification; this is not an exhaustive generated client SDK.


## Increment 0.3 additions

At increment 0.3 the API documented 38 paths, adding branch list/create/revise. `organization:view` and `organization:manage` are explicit grants. Branch configuration shares the idempotency and atomic audit coordinator and serializes with financial commands; no delete or balance-changing endpoint exists. Session-cookie configuration defaults strict; the hosted preview opts into Secure/HttpOnly/Partitioned cookies under a separate `__Host-erp_preview` name with CSRF unchanged. See [preview/organization contract](06-preview-and-organization.md).


## Increment 0.4 additions

At increment 0.4 the implemented specification had 43 paths, adding company profile/name revision and warehouse list/active-parent options/create/revise. `organization:profile:manage` is separate from branch management; warehouses use `warehouses:view` / `warehouses:manage`. No location migration, stock opening, balance, company lifecycle or legal-identity change is exposed. Warehouse deactivation is blocked by any current operational reference until a tested operational close workflow replaces the conservative guard. See [the design and verification contract](07-company-and-warehouses.md).

## Increment 0.4.1 preview recovery

44 paths including public GET /auth/config. An explicitly enabled development-only transport negotiates a memory session with X-ERP-Session-Transport: memory at password login and sends X-ERP-Session on subsequent requests. The same session, CSRF, RBAC and scope checks apply. Invalid/disabled header credentials cannot fall back to a cookie. Authentication responses are no-store. Default remains cookies; production startup rejects ENABLE_PREVIEW_MEMORY_SESSION=true. See [security tradeoff, lifecycle and executed evidence](08-preview-session-recovery.md). The earlier local partitioned-cookie test did not resolve the user's actual Arena/browser issue.

## Increment 0.5: controlled account changes

48 implemented paths. GET `/admin/accounts`, `/admin/accounts/parents`, `/admin/account-changes` require `accounts:configuration:view`; POST `/admin/account-changes` requires `accounts:propose`; POST `/admin/account-changes/:id/decide` requires `accounts:approve`, a different actor, CSRF and idempotency. Proposals are strict CREATE/RENAME unions and never accept creator/reviewer fields. No configuration-only grant implies journal posting. See [the full state/permission/atomicity contract](09-chart-of-accounts-controls.md).

## Implemented initial product endpoints (017)

Current OpenAPI contains76 paths. Seven new admin routes: GET products, products/:id and products/lookup; GET/POST product-changes; POST product-changes/:id/decide and products/:id/tax-preview. products:view enables bounded reads and stored-price informational preview, not stock operations. products:propose and products:approve are separate, with current products:cost:view additionally required for approval. Cost-free readers receive null purchase_price; product audit snapshots require the cost grant even with audit:view. Authorized product audit price fields are projected as exact strings before JSON parsing; original native audits remain immutable. All supplied actor/balance/rate/preview-price fields are rejected. The moving weighted-average helper is internal, not an API.

## Implemented stock endpoints (018)

`GET /inventory/{adjustments,balances,products,warehouses,reconciliation}` and source detail require inventory:view plus inventory:cost:view. Bounded paging/search and assigned branches apply. POST adjustments requires inventory:create; source submit/refresh, approve/reject, post, cancel and reversal-drafts require corresponding explicit permissions and cost visibility. Source actors resolve from the authenticated session; CSRF, stable idempotency, strict bodies, independent policy decisions and native guards remain authoritative. Reversal accepts date/reason only and negates original costs, not current average. Manual document routes exclude stock; stock audit snapshots are redacted without cost permission. OpenAPI now89 paths; decimal payloads remain strings.

## Implemented customer registration endpoints (019)

GET `/customers`, `/customers/changes`, `/customers/:id`, `/customers/accounts` and `/customers/tax-categories` require customers:view. POST `/customers/changes` and `/customers/changes/:id/decide` require customers:propose and customers:approve respectively, CSRF/idempotency/current company authority and independent review. No actor, balance, arbitrary currency or posting override fields are accepted. Generic audit masks customer snapshots without customers:view. Company-scoped master registration and AR-account metadata do not grant AR posting or generic financial reads. Current OpenAPI has95 paths.


###020 reviewed customer amendments

`GET /customers/:id/amendments` requires customers:view and supports bounded page/limit. `POST /customers/:id/amendments` requires customers:amend:propose; strict complete name/contact/limit/terms/hold fields plus expectedVersion/reason. Additional customers:credit:propose is required when any credit-policy value changes. `POST /customers/amendments/:id/decide` requires customers:amend:approve and, for credit-policy requests, customers:credit:approve. Maker cannot approve/reject their own request. No client actor, account, tax identity, balance, currency or active flag accepted. Used-customer credit changes fail closed. PENDING/APPLIED/REJECTED history is immutable; original registration stays frozen, current version advances exactly once. New audit entity CUSTOMER_AMENDMENT is redacted without customers:view. No endpoint here authorizes an invoice or creates AR.
