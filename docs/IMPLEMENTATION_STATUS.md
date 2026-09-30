# Live implementation status

**NOT COMPLETE — production readiness is not claimed.**

Statuses: NOT_STARTED / IN_PROGRESS / IMPLEMENTED / TESTING / VERIFIED / BLOCKED. VERIFIED is evidence-scoped; a verified core capability does not verify an unreleased operational module. Design tables alone do not count as implementation.

## Current execution checkpoint

# Execution checkpoint — 30 September 2026

**Full ERP NOT COMPLETE; productionReady=false. Continue autonomously.** Historical019 checkpoint: `docs/history/checkpoint-through019.md`. Migrations001–020 are immutable; production-onboarding migrations021–022 are authored but have not been applied to production or runtime-tested there. No credentials, history, rate buckets or issued numbers may be reset to speed development.

## Production first-tenant onboarding — scaffold implemented, verification pending

`db/021-production-onboarding.sql`, `db/022-bootstrap-audit-permission.sql`, `scripts/bootstrap-production.cjs`, the isolated Compose `onboarding` profile, `scripts/company-setup-template.cjs` and `erpctl bootstrap` define the one-time production workflow. It requires the `erp_owner` migration role, matching checksums, a fresh auth-worker heartbeat and a pristine tenant database; an advisory lock and immutable marker prevent concurrent/repeated runs. The single transaction creates the first company/branch/admin and restricted setup role, an undisclosed random password hash plus SMTP reset flow, atomic audit/security events, a starter chart of accounts, prior/current/next calendar fiscal years, main warehouse, and audited governed unit/category/brand references. The same no-balance scaffold helper is used by the separate development-only demo seed; that seed remains forbidden when `NODE_ENV=production`. Tax rates/rules, registered customers/products, stock, transactions and opening balances are not fabricated. Focused local verification passed: API TypeScript build; 11 tests across production onboarding, shared fiscal-year helper and development-seed safety (8 production-onboarding tests, 0 failures), recorded in `docs/deployment/production-onboarding-test.json`. Runtime was Node v20.20.2 despite the Node >=22 requirement. No real PostgreSQL/deferred-trigger execution, Docker image build, production database or live SMTP test has run; production readiness remains false.

## Completed current bounded scope

Reviewed versioned customer profile and credit-policy amendments: `db/020-reviewed-customer-amendments.sql`, `apps/api/src/customer-amendments.ts`, `CustomerAmendments.tsx`. Strict expected version and exact before/after, inert proposal, independent maker/reviewer even with both grants, separate profile/credit permissions, current authorization, immutable original registration/binding/history, final-row request/master/audit guards. Operational foreign-key dependencies conservatively deny credit changes; profile-only changes remain allowed. WALK_IN remains anonymous/zero-credit. No editable balance, AR posting or credit-sale enforcement. Pure credit kernel remains unintegrated.

Customer-only read-only browser users see history but no mutation; forged proposal/review403. Profile-only users have disabled credit fields/backend403, permitted name/contact proposal and no self-review. New workflow test creates a new independently registered fixture per run. An early exploratory shared-fixture amendment was restored through a genuine independent amendment to version3; no history deleted. Current mobile screenshot waits for loaded rows and checks viewport-contained dialog; horizontally scrollable table is intentional.

## Executed verification (not inferred)

- **261 backend tests passed,0 failed,87 top-level,61,938.674847ms**, API compile PASS: `docs/test-results.txt`. Amendment suite11 including parent; added WALK_IN and late request-row corruption, in addition to master/audit rollback/retry. Genuine API/browser RED retained under `docs/testing/red-evidence/`.
- **All23 browser suites PASS**, frozen source fingerprint, finished **2026-09-30T06:04:06.478Z**: `docs/testing/browser-regression.{json,txt}`. Login60/15min observed with natural pause/resume; no rate reset. Prior21-suite receipt archived as `customer019-browser-regression.{json,txt}`.
- Latest amendment workflow PASS06:03:56.390Z, fixture customer `0fba8034-02b2-4cf3-ae2a-7cad31381cfa`, amendment `8c6c05e4-471c-4123-b90b-299122cdf4ba`,version2. Exact12500.75→14000.25,45days,hold; original identity and independent attribution. Profile-only browser PASS06:04:06.372Z. Both consoleErrors[]. Loaded desktop/mobile-dark screenshots inspected.
- Web typecheck,6 presentation tests, optimized Next build, production-web CSP/nonce/hydration/private-proxy smoke and6 generic recovery tests PASS: `docs/deployment/customer-amendment-build-results.txt`. Production backend/Docker claims remain false.
- **Actual encrypted020 restore PASS06:05:07.619Z**: `docs/testing/customer-amendment-restoration.json`.62sources48journals96lines1088audits;18stock sources/18valuations/16movements/6pools/5reversals;5customers/5bindings/zeroAR;6amendments(4applied/2rejected).20 hashes match. Zero stock/projection/GL/reversal/original-publication/current-master/contiguous-chain/exact proposal-and-decision audit discrepancies; balanced journal arithmetic PASS. Encrypted backup `database-2026-09-30T06-05-06-103Z-fe9ac88f-d0de-4726-a8c7-bf725883c13e.erpbackup`, SHA256 `a3b80803f62a212e4416e6358280410ceb2c5a8257b778f09a8428d00822d1ca`. Latest private pointer `.runtime/latest-backup.json`; pre020 pointer preserved separately. Production-host/offsite/PITR not tested.
- Schema export136tables1473columns583FK; OpenAPI97paths.354 requirement rows. Health ready=true,productionReady=false. Schema counts are not completion evidence.

## Runtime and recovery

DB `erp-development-database-529a5a8a`; API `erp-api-ad2f07c4` port3000; auth worker `authentication-mail-worker-ac624dfd`; Next preview **`karibu-erp-00d607f1`** port5173. Node22 `/home/user/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`. Next384MB; stop development before heavy builds, restart with0.0.0.0. Production CSP intentionally refuses frame embedding; Arena preview stays development/tab-memory auth. Actual user-side successful Arena login remains unconfirmed despite embedded/cookie-stripping tests.

This cycle recovered a reset sandbox by restoring verified019 into an isolated DB and promoting it only because erp was absent; all19 hashes and56sources43journals86lines950audits retained before020. No reseed/password reset. PG/dependencies/Chromium OS libraries were reinstalled. Persistent state now captured in020 encrypted backup. Use the amendment-aware restoration script; the initial-registration script now also compares the frozen initial snapshot rather than incorrectly comparing initial policy to amended current policy.

## Current task / next dependency

Generated book refreshed/inspected:70pages394241bytes; `docs/testing/customer-amendment-document-check.json`. Frozen23-suite source fingerprint rechecked without rerunning suites; runner now preserves the original completion timestamp when already complete. Now implementing **first coherent transactional customer AR source** acceptance. Preimplementation contract: `docs/customers/service-credit-invoice-next.md` (design-only). Inspect/reuse existing sales/source/customer_transactions/tax_transactions tables and central tax/materialization/journal/approval/numbering engines. First bounded service credit invoice must prove full invoice→AR/revenue/tax→linked original-value reversal, serialized authoritative credit/exposure, exact snapshots and native rollback before editing UI. No standalone credit quote is posting authority. Verify production fiscal/eTIMS gate explicitly; never fabricate acceptance.

First genuine next-source RED is now recorded: `apps/api/acceptance/service-credit-invoice.test.ts`, `docs/testing/red-evidence/service-credit-invoice.txt`. Disposable DB applies001–020 and publishes governed UNIT/category, synthetic17.5% tax, SERVICE product at80.00 and REGISTERED customer limit1000/terms30 through real APIs before POST /customer-invoices returns404 instead of201. No live DB mutation. Acceptance is deliberately outside released test/*.test.ts; do not describe its failures as a passed invoice suite. Subsequent authored assertions (not reached yet) specify reviewed mapping, exact100+17.50=117.50, original due date, late AR-row rollback/retry, same-key concurrency, full original-value reversal and two invoices competing for headroom. Expand native/hold/race/privacy/fiscal-gate coverage and move into normal regression only when source implementation is complete. No customer-invoice/AR posting migration or operational route exists yet; migration021 is now reserved for the separate production first-tenant bootstrap.

Repository inspection notes in the next contract identify reusable product tax resolution, existing zero-leg omission (no duplicate materializer), sales/sale_lines, AR and tax tables, and unresolved exempt-base tax-register representation. Establish exact native schema and transaction protocol before implementation/UI. Unsupported operational dependencies/commitments fail closed, never assume a missing reservations table means no exposure. Migration020's used-customer credit-change denial remains until explicit exposure-aware replacement is tested under the common locks. New source must not break stock reconciliation, legacy document isolation, generic audit privacy or original financial snapshots. Do not mark broad Customers/AR, Inventory or tax complete from a bounded source.

## Remaining requirements and blockers

Inventory counts/transfers/reservations/tracking/multi-line commercial sources; credit exposure/commitments/invoices/allocations/statements/aging; supplier/AP and purchasing; POS/cashiers; unified payments/verified M-Pesa; returns; expenses/cash; full reports and reconciled operational E2E. Remaining master/security/organization lifecycle, tax registers/amendments/eTIMS, MFA/step-up, attachments, performance/security/accessibility, offsite/PITR/issuance continuity. SMTP/provider credentials and contracted specs are genuine activation dependencies. Rootless Docker runtime blocked by TAP privileges here; Ubuntu/Tunnel reboot/recreate/update/rollback/DR still unverified. Keep live statuses and original28-artifact/89-master requirements; no final24-point completion report.


## Requirement coverage

BLOCKED: 13, IMPLEMENTED: 2, IN_PROGRESS: 150, NOT_STARTED: 156, TESTING: 6, VERIFIED: 27

| ID | Requirement | Module | Status | Evidence / remaining work |
|---|---|---|---|---|
| 01.01 | Repository structure | Foundation | VERIFIED | Current regression: docs/test-results.txt (261 tests); docs/browser-*-result.json. Verification is confined to the named core capability. |
| 01.02 | Monorepo | Foundation | VERIFIED | Current regression: docs/test-results.txt (261 tests); docs/browser-*-result.json. Verification is confined to the named core capability. |
| 01.03 | TypeScript | Foundation | VERIFIED | Current regression: docs/test-results.txt (261 tests); docs/browser-*-result.json. Verification is confined to the named core capability. |
| 01.04 | Next.js | Foundation | VERIFIED | docs/deployment/next-production-result.json; browser-coa-result.json; browser-preview-memory-result.json |
| 01.05 | NestJS | Foundation | VERIFIED | Current regression: docs/test-results.txt (261 tests); docs/browser-*-result.json. Verification is confined to the named core capability. |
| 01.06 | PostgreSQL | Foundation | VERIFIED | Current regression: docs/test-results.txt (261 tests); docs/browser-*-result.json. Verification is confined to the named core capability. |
| 01.07 | Docker | Foundation | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 01.08 | Environment configuration | Foundation | IN_PROGRESS | No complete module evidence yet |
| 01.09 | Logging | Foundation | IN_PROGRESS | Redacted structured HTTP/500 logs, generated request IDs, safe validation/DB errors and failed-command audit implemented. Production log shipping/retention review remains open. |
| 01.10 | Error handling | Foundation | IN_PROGRESS | Redacted structured HTTP/500 logs, generated request IDs, safe validation/DB errors and failed-command audit implemented. Production log shipping/retention review remains open. |
| 01.11 | API architecture | Foundation | IN_PROGRESS | No complete module evidence yet |
| 01.12 | Database migrations | Foundation | IN_PROGRESS | Checksummed/advisory-locked migrations001–017 applied. Actual isolated017 restoration includes native product audit and checksum verification. Production-host upgrade/rollback remains. |
| 01.13 | Shared types | Foundation | IN_PROGRESS | No complete module evidence yet |
| 01.14 | Validation | Foundation | IN_PROGRESS | No complete module evidence yet |
| 01.15 | Testing infrastructure | Foundation | IN_PROGRESS | No complete module evidence yet |
| 02.01 | Authentication | Security | VERIFIED | docs/test-results.txt: current 97-test backend suite; all seven current Next browser suites. External SMTP and actual Arena traffic authorization not certified. |
| 02.02 | Sessions | Security | VERIFIED | docs/test-results.txt: current 97-test backend suite; all seven current Next browser suites. External SMTP and actual Arena traffic authorization not certified. |
| 02.03 | Users | Security | IN_PROGRESS | No complete module evidence yet |
| 02.04 | Roles | Security | IN_PROGRESS | No complete module evidence yet |
| 02.05 | Permissions | Security | IN_PROGRESS | No complete module evidence yet |
| 02.06 | RBAC middleware | Security | IN_PROGRESS | No complete module evidence yet |
| 02.07 | Password management | Security | VERIFIED | docs/test-results.txt: current 97-test backend suite; all seven current Next browser suites. External SMTP and actual Arena traffic authorization not certified. |
| 02.08 | Session expiration | Security | VERIFIED | docs/test-results.txt: current 97-test backend suite; all seven current Next browser suites. External SMTP and actual Arena traffic authorization not certified. |
| 02.09 | Logout | Security | VERIFIED | docs/test-results.txt: current 97-test backend suite; all seven current Next browser suites. External SMTP and actual Arena traffic authorization not certified. |
| 02.10 | Account activation/deactivation | Security | IN_PROGRESS | No complete module evidence yet |
| 02.11 | Audit logging | Security | IN_PROGRESS | No complete module evidence yet |
| 02.12 | Permission enforcement | Security | IN_PROGRESS | No complete module evidence yet Product cost permission now gates catalog/detail/history/lookup and product audit snapshots; audit:view alone is insufficient.17 product DB/HTTP tests and restricted-reader browser coverage. |
| 02.13 | MFA/step-up | Security | IN_PROGRESS | No complete module evidence yet |
| 02.14 | Breached password screening | Security | IN_PROGRESS | No complete module evidence yet |
| 03.01 | Companies | Organization | IN_PROGRESS | No complete module evidence yet |
| 03.02 | Branches | Organization | IN_PROGRESS | No complete module evidence yet |
| 03.03 | Warehouses | Organization | IN_PROGRESS | No complete module evidence yet |
| 03.04 | POS terminals | Organization | IN_PROGRESS | No complete module evidence yet |
| 03.05 | Financial periods | Organization | IN_PROGRESS | No complete module evidence yet |
| 03.06 | Currencies | Organization | IN_PROGRESS | No complete module evidence yet |
| 03.07 | Document sequences | Organization | IN_PROGRESS | Runtime allocator and reviewed configuration verified by database/browser tests (current NB59881447R-2028-00000001). Stale restore can rewind counters: production disaster-recovery issuance continuity remains unverified; docs/backups/sandbox-recovery-20260929.md. |
| 03.08 | Multi-branch scoping | Organization | IN_PROGRESS | No complete module evidence yet |
| 03.09 | Multi-warehouse scoping | Organization | IN_PROGRESS | No complete module evidence yet |
| 04.01 | Chart of Accounts | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.02 | Account hierarchy | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.03 | Journal entries | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.04 | Journal lines | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.05 | Posting engine | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.06 | Reversal engine | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.07 | General Ledger | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.08 | Accounting rules | Accounting | IN_PROGRESS | 250 backend regression, posting rule browser workflow/access, atomic reviewed stock mapping application and original-cost reversal tested. Scoped stock application released; commercial/purchasing/tax/payment selectors and modules remain unfinished. |
| 04.09 | Accounting validation | Accounting | VERIFIED | Current regression: docs/test-results.txt (261 tests); docs/browser-*-result.json. Verification is confined to the named core capability. |
| 04.10 | Reconciliation framework | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.11 | Trial Balance | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.12 | Profit and Loss | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.13 | Balance Sheet | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.14 | Cash Flow | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.15 | AR reconciliation | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.16 | AP reconciliation | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.17 | Inventory reconciliation | Accounting | IN_PROGRESS | Stock browser and backend discrepancy tests; actual018/019 restoration: zero movement/projection/GL mismatches. Broader operational stock module unfinished. |
| 04.18 | Tax reconciliation | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.19 | Cash reconciliation | Accounting | IN_PROGRESS | No complete module evidence yet |
| 04.20 | Document numbering | Accounting | IN_PROGRESS | 185-test backend suite; browser-numbering-result.json (15 checks); browser-numbering-access-result.json (5 checks); migrations 010–013. Verified for released types, not future operational integrations. Runtime configuration/allocation is verified within retained history; post-disaster issuance continuity remains unverified after observed stale-snapshot recovery. |
| 05.01 | Tax types | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.02 | Tax rates | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.03 | Tax categories | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.04 | Inclusive tax | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.05 | Exclusive tax | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.06 | Zero-rated | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.07 | Exempt | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.08 | Non-taxable | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.09 | Effective dates | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.10 | Tax accounts | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.11 | Product tax configuration | Tax | IN_PROGRESS | 017 initial registration VERIFIED: 17 product DB/HTTP tests (including parent), two new browser suites, actual product restoration; full214 backend/all17 browser green. Product/price/profile lifecycle, alternate units, supplier linkage and operational integrations remain. |
| 05.12 | Tax transaction records | Tax | NOT_STARTED | No complete module evidence yet |
| 05.13 | Immutable tax snapshots | Tax | IN_PROGRESS | 185-test backend regression includes 14 tax DB/HTTP tests and 11 exact calculator tests. Browser tax workflow and isolated tax-only access pass; all15 browser suites pass. Migration015 and actual restored publication links verified. Finite immutable schedules only: retirement/amendment, operational tax registers/posting, product assignment, return allocation and reconciliation remain unfinished. |
| 05.14 | eTIMS integration | Tax | BLOCKED | Provider contracts/current specifications, sandbox/production credentials and external acceptance required; local adapter work remains unfinished. |
| 06.01 | Product master | Inventory | IN_PROGRESS | 017 initial registration VERIFIED: 17 product DB/HTTP tests (including parent), two new browser suites, actual product restoration; full214 backend/all17 browser green. Product/price/profile lifecycle, alternate units, supplier linkage and operational integrations remain. |
| 06.02 | Categories | Inventory | IN_PROGRESS | 185-test regression includes 9 reference DB/HTTP tests: idempotency/uniqueness race, parent scope/depth, precision, immutability, unaudited SQL refusal and audit rollback. Browser creation/hierarchy/reader and minimal product-only access pass. Migration016, restored counts and exact reference audit links verified. Lifecycle/corrections and actual SKU/product/inventory workflows remain unfinished. |
| 06.03 | Brands | Inventory | IN_PROGRESS | 185-test regression includes 9 reference DB/HTTP tests: idempotency/uniqueness race, parent scope/depth, precision, immutability, unaudited SQL refusal and audit rollback. Browser creation/hierarchy/reader and minimal product-only access pass. Migration016, restored counts and exact reference audit links verified. Lifecycle/corrections and actual SKU/product/inventory workflows remain unfinished. |
| 06.04 | Units | Inventory | IN_PROGRESS | 185-test regression includes 9 reference DB/HTTP tests: idempotency/uniqueness race, parent scope/depth, precision, immutability, unaudited SQL refusal and audit rollback. Browser creation/hierarchy/reader and minimal product-only access pass. Migration016, restored counts and exact reference audit links verified. Lifecycle/corrections and actual SKU/product/inventory workflows remain unfinished. |
| 06.05 | Barcodes | Inventory | IN_PROGRESS | 017 initial registration VERIFIED: 17 product DB/HTTP tests (including parent), two new browser suites, actual product restoration; full214 backend/all17 browser green. Product/price/profile lifecycle, alternate units, supplier linkage and operational integrations remain. |
| 06.06 | Pricing | Inventory | IN_PROGRESS | 017 initial registration VERIFIED: 17 product DB/HTTP tests (including parent), two new browser suites, actual product restoration; full214 backend/all17 browser green. Product/price/profile lifecycle, alternate units, supplier linkage and operational integrations remain. |
| 06.07 | Product taxes | Inventory | IN_PROGRESS | 017 initial registration VERIFIED: 17 product DB/HTTP tests (including parent), two new browser suites, actual product restoration; full214 backend/all17 browser green. Product/price/profile lifecycle, alternate units, supplier linkage and operational integrations remain. |
| 06.08 | Inventory balances | Inventory | TESTING | 250 backend regression; stock workflow/access browser PASS including GL/audit drilldown and full original-cost reversal; actual018/019 encrypted restoration with zero stock/GL/audit discrepancies. All21 runtime/UI browser suites pass; later pure credit helper separately tested. |
| 06.09 | Inventory movements | Inventory | TESTING | 250 backend regression; stock workflow/access browser PASS including GL/audit drilldown and full original-cost reversal; actual018/019 encrypted restoration with zero stock/GL/audit discrepancies. All21 runtime/UI browser suites pass; later pure credit helper separately tested. |
| 06.10 | Stock transfers | Inventory | NOT_STARTED | No complete module evidence yet |
| 06.11 | Stock counts | Inventory | NOT_STARTED | No complete module evidence yet |
| 06.12 | Stock adjustments | Inventory | TESTING | 250 backend regression; stock workflow/access browser PASS including GL/audit drilldown and full original-cost reversal; actual018/019 encrypted restoration with zero stock/GL/audit discrepancies. All21 runtime/UI browser suites pass; later pure credit helper separately tested. |
| 06.13 | Inventory valuation | Inventory | TESTING | 250 backend regression; stock workflow/access browser PASS including GL/audit drilldown and full original-cost reversal; actual018/019 encrypted restoration with zero stock/GL/audit discrepancies. All21 runtime/UI browser suites pass; later pure credit helper separately tested. |
| 06.14 | Weighted average valuation | Inventory | TESTING | 250 backend regression; stock workflow/access browser PASS including GL/audit drilldown and full original-cost reversal; actual018/019 encrypted restoration with zero stock/GL/audit discrepancies. All21 runtime/UI browser suites pass; later pure credit helper separately tested. |
| 06.15 | Batches | Inventory | NOT_STARTED | No complete module evidence yet |
| 06.16 | Serials | Inventory | NOT_STARTED | No complete module evidence yet |
| 06.17 | Expiry | Inventory | NOT_STARTED | No complete module evidence yet |
| 06.18 | Reservations | Inventory | NOT_STARTED | No complete module evidence yet |
| 06.19 | Concurrent stock operations | Inventory | TESTING | 250 backend regression; stock workflow/access browser PASS including GL/audit drilldown and full original-cost reversal; actual018/019 encrypted restoration with zero stock/GL/audit discrepancies. All21 runtime/UI browser suites pass; later pure credit helper separately tested. |
| 06.20 | Bounded reviewed stock gain/loss/full original-cost reversal | Inventory | VERIFIED | Stock15 backend; workflow/access browser and all21 runtime/UI suites; actual018/019 restoration, zero discrepancies. Multi-line/counts/transfers/tracking/commercial integration excluded. |
| 07.01 | Customers | Customers and AR | IN_PROGRESS | 10 customer DB/HTTP/native tests and full250 regression; workflow and isolated-reader browser PASS; actual019 restoration. Amendment/deactivation/credit exposure and AR operations unfinished. |
| 07.02 | Walk-in customer | Customers and AR | IN_PROGRESS | 10 customer DB/HTTP/native tests and full250 regression; workflow and isolated-reader browser PASS; actual019 restoration. Amendment/deactivation/credit exposure and AR operations unfinished. |
| 07.03 | Customer accounts | Customers and AR | IN_PROGRESS | 10 customer DB/HTTP/native tests and full250 regression; workflow and isolated-reader browser PASS; actual019 restoration. Amendment/deactivation/credit exposure and AR operations unfinished. |
| 07.04 | Credit limits | Customers and AR | IN_PROGRESS | 10 customer DB/HTTP/native tests and full250 regression; workflow and isolated-reader browser PASS; actual019 restoration. Amendment/deactivation/credit exposure and AR operations unfinished. |
| 07.05 | Payment terms | Customers and AR | IN_PROGRESS | 10 customer DB/HTTP/native tests and full250 regression; workflow and isolated-reader browser PASS; actual019 restoration. Amendment/deactivation/credit exposure and AR operations unfinished. |
| 07.06 | Customer ledger | Customers and AR | NOT_STARTED | No complete module evidence yet |
| 07.07 | AR | Customers and AR | IN_PROGRESS | First service-credit invoice design and genuine isolated API RED: docs/customers/service-credit-invoice-next.md; apps/api/acceptance/service-credit-invoice.test.ts; docs/testing/red-evidence/service-credit-invoice.txt (404 versus201). Later atomic posting/reversal/concurrency assertions are authored but not reached. No AR source/ledger posting released. |
| 07.08 | Customer statements | Customers and AR | NOT_STARTED | No complete module evidence yet |
| 07.09 | Aging | Customers and AR | NOT_STARTED | No complete module evidence yet |
| 07.10 | Customer payments | Customers and AR | NOT_STARTED | No complete module evidence yet |
| 07.11 | Payment allocations | Customers and AR | NOT_STARTED | No complete module evidence yet |
| 07.12 | Customer credit notes | Customers and AR | NOT_STARTED | No complete module evidence yet |
| 07.13 | Customer debit notes | Customers and AR | NOT_STARTED | No complete module evidence yet |
| 07.14 | Bounded initial independently reviewed customer registration | Customers and AR | VERIFIED | 10 DB/HTTP/native tests; customer workflow/access and all21 runtime/UI browser suites; actual019 restore. Lifecycle and operational AR excluded. |
| 07.15 | Pure exact credit eligibility and calendar due-date component | Customers and AR | VERIFIED | 10 pure tests/3465 cent cases; full250 backend PASS. Real RED first. Transactional integration, concurrency/reservation ownership and AR posting NOT_STARTED. |
| 07.16 | Reviewed versioned customer profile and credit-policy amendments | Customers and AR | VERIFIED | 261 backend tests including WALK_IN and late request/master/audit sabotage; all23 frozen browser suites PASS2026-09-30T06:04:06.478Z. Actual encrypted020 restore PASS06:05:07.619Z verifies original/current/chain/exact proposal-and-decision audits. docs/testing/customer-amendment-restoration.json; docs/deployment/customer-amendment-build-results.txt. Bounded amendments only, not AR/credit-sale enforcement. |
| 08.01 | Suppliers | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.02 | Supplier accounts | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.03 | Supplier ledger | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.04 | AP | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.05 | Supplier statements | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.06 | Aging | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.07 | Supplier payments | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.08 | Payment allocations | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.09 | Supplier credit notes | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 08.10 | Supplier debit notes | Suppliers and AP | NOT_STARTED | No complete module evidence yet |
| 09.01 | Purchase requests | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.02 | Purchase orders | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.03 | PO approvals | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.04 | GRNs | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.05 | Supplier invoices | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.06 | Three-way matching | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.07 | Partial orders | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.08 | Partial receipts | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.09 | Partial invoicing | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.10 | Rejected quantities | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.11 | Damaged quantities | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.12 | Price variances | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.13 | Quantity variances | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.14 | Tax differences | Purchasing | NOT_STARTED | No complete module evidence yet |
| 09.15 | Duplicate invoice detection | Purchasing | NOT_STARTED | No complete module evidence yet |
| 10.01 | Barcode scanning | POS | NOT_STARTED | No complete module evidence yet |
| 10.02 | Manual barcode entry | POS | NOT_STARTED | No complete module evidence yet |
| 10.03 | Product search | POS | NOT_STARTED | No complete module evidence yet |
| 10.04 | Customer search | POS | NOT_STARTED | No complete module evidence yet |
| 10.05 | Walk-in cash sale | POS | NOT_STARTED | No complete module evidence yet |
| 10.06 | Registered customer sale | POS | NOT_STARTED | No complete module evidence yet |
| 10.07 | Credit sale | POS | NOT_STARTED | No complete module evidence yet |
| 10.08 | Sale cancellation | POS | NOT_STARTED | No complete module evidence yet |
| 10.09 | Discounts | POS | NOT_STARTED | No complete module evidence yet |
| 10.10 | Multiple payments | POS | NOT_STARTED | No complete module evidence yet |
| 10.11 | Split payments | POS | NOT_STARTED | No complete module evidence yet |
| 10.12 | Receipt printing | POS | NOT_STARTED | No complete module evidence yet |
| 10.13 | Receipt reprinting | POS | NOT_STARTED | No complete module evidence yet |
| 10.14 | Hold/resume sale | POS | NOT_STARTED | No complete module evidence yet |
| 10.15 | Fast cashier keyboard flow | POS | NOT_STARTED | No complete module evidence yet |
| 11.01 | Cashier sessions | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.02 | Opening float | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.03 | Cashier sales attribution | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.04 | Cashier payments | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.05 | Cashier refunds | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.06 | Cash movements | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.07 | Closing | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.08 | Expected versus actual cash | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.09 | Cashier reconciliation | Cashiers | NOT_STARTED | No complete module evidence yet |
| 11.10 | Variance approval | Cashiers | NOT_STARTED | No complete module evidence yet |
| 12.01 | Cash payments | Payments | NOT_STARTED | No complete module evidence yet |
| 12.02 | Bank payments | Payments | NOT_STARTED | No complete module evidence yet |
| 12.03 | Card payments | Payments | NOT_STARTED | No complete module evidence yet |
| 12.04 | Cheques | Payments | NOT_STARTED | No complete module evidence yet |
| 12.05 | EFT | Payments | NOT_STARTED | No complete module evidence yet |
| 12.06 | Mobile money | Payments | NOT_STARTED | No complete module evidence yet |
| 12.07 | Configurable payment methods | Payments | NOT_STARTED | No complete module evidence yet |
| 12.08 | Full payment | Payments | NOT_STARTED | No complete module evidence yet |
| 12.09 | Partial payment | Payments | NOT_STARTED | No complete module evidence yet |
| 12.10 | Split payment | Payments | NOT_STARTED | No complete module evidence yet |
| 12.11 | Advance payment | Payments | NOT_STARTED | No complete module evidence yet |
| 12.12 | Unallocated payment | Payments | NOT_STARTED | No complete module evidence yet |
| 12.13 | Payment allocation | Payments | NOT_STARTED | No complete module evidence yet |
| 12.14 | Payment reversal | Payments | NOT_STARTED | No complete module evidence yet |
| 12.15 | Payment idempotency | Payments | NOT_STARTED | No complete module evidence yet |
| 13.01 | Provider abstraction | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.02 | M-Pesa STK Push | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.03 | Pending payment | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.04 | Callback validation | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.05 | Transaction matching | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.06 | Payment posting | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.07 | Settlement reconciliation | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.08 | Duplicate callbacks | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.09 | Timeout | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.10 | Failure | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.11 | Cancellation | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.12 | Reversal | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.13 | Network errors | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.14 | Mock provider | M-Pesa | NOT_STARTED | No complete module evidence yet |
| 13.15 | Production provider activation | M-Pesa | BLOCKED | Provider contracts/current specifications, sandbox/production credentials and external acceptance required; local adapter work remains unfinished. |
| 14.01 | Full return | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.02 | Partial return | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.03 | Original invoice reference | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.04 | Stock return | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.05 | Customer credit | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.06 | Cash refund | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.07 | Payment reversal | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.08 | Tax reversal | Sales returns | NOT_STARTED | No complete module evidence yet |
| 14.09 | Accounting reversal | Sales returns | NOT_STARTED | No complete module evidence yet |
| 15.01 | Supplier return | Supplier returns | NOT_STARTED | No complete module evidence yet |
| 15.02 | Original purchase/GRN/invoice linkage | Supplier returns | NOT_STARTED | No complete module evidence yet |
| 15.03 | Inventory reduction | Supplier returns | NOT_STARTED | No complete module evidence yet |
| 15.04 | Supplier credit/debit note | Supplier returns | NOT_STARTED | No complete module evidence yet |
| 15.05 | AP adjustment | Supplier returns | NOT_STARTED | No complete module evidence yet |
| 15.06 | Tax adjustment | Supplier returns | NOT_STARTED | No complete module evidence yet |
| 15.07 | Accounting reversal | Supplier returns | NOT_STARTED | No complete module evidence yet |
| 16.01 | Business expenses | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 16.02 | Expense categories | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 16.03 | Expense approval | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 16.04 | Expense payments | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 16.05 | Expense tax treatment | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 16.06 | Petty cash | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 16.07 | Cash replenishment | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 16.08 | Cash reconciliation | Expenses and cash | NOT_STARTED | No complete module evidence yet |
| 17.01 | Sales summary | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.02 | Sales by product | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.03 | Sales by category | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.04 | Sales by customer | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.05 | Sales by cashier | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.06 | Sales by user | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.07 | Sales by branch | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.08 | Sales by payment method | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.09 | Returns report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.10 | Discount report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.11 | Sales tax report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.12 | Gross profit | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.13 | Stock balance | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.14 | Stock movement | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.15 | Stock valuation | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.16 | Stock aging | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.17 | Stock count variance | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.18 | Low stock | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.19 | Inventory profitability | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.20 | Customer statement | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.21 | Customer ledger | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.22 | Customer aging | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.23 | Outstanding customer invoices | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.24 | Customer payments report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.25 | Supplier statement | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.26 | Supplier ledger | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.27 | Supplier aging | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.28 | Outstanding supplier invoices | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.29 | Supplier payments report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.30 | Cashier session report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.31 | Cashier reconciliation report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.32 | Cashier payment summary | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.33 | Cashier variance | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.34 | Journal report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.35 | AR report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.36 | AP report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.37 | Tax report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.38 | Audit report | Reporting | NOT_STARTED | No complete module evidence yet |
| 17.39 | Export | Reporting | NOT_STARTED | No complete module evidence yet |
| 18.01 | Source-to-business-transaction drilldown | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.02 | Source-to-payment drilldown | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.03 | Source-to-inventory drilldown | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.04 | Source-to-customer/supplier-ledger drilldown | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.05 | Source-to-tax drilldown | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.06 | Source-to-journal drilldown | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.07 | Source-to-audit drilldown | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.08 | Created attribution | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.09 | Updated attribution | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.10 | Approved attribution | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.11 | Posted attribution | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.12 | Cancelled attribution | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.13 | Reversed attribution | Traceability | IN_PROGRESS | No complete module evidence yet |
| 18.14 | System/integration initiator retention | Traceability | IN_PROGRESS | No complete module evidence yet |
| 19.01 | Searchable customers | UX | IN_PROGRESS | No complete module evidence yet |
| 19.02 | Searchable suppliers | UX | IN_PROGRESS | No complete module evidence yet |
| 19.03 | Searchable products | UX | VERIFIED | 017 initial registration VERIFIED: 17 product DB/HTTP tests (including parent), two new browser suites, actual product restoration; full214 backend/all17 browser green. Product/price/profile lifecycle, alternate units, supplier linkage and operational integrations remain. |
| 19.04 | Searchable barcodes | UX | VERIFIED | 017 initial registration VERIFIED: 17 product DB/HTTP tests (including parent), two new browser suites, actual product restoration; full214 backend/all17 browser green. Product/price/profile lifecycle, alternate units, supplier linkage and operational integrations remain. |
| 19.05 | Searchable accounts | UX | IN_PROGRESS | No complete module evidence yet |
| 19.06 | Searchable users | UX | IN_PROGRESS | No complete module evidence yet |
| 19.07 | Searchable branches | UX | IN_PROGRESS | No complete module evidence yet |
| 19.08 | Searchable warehouses | UX | IN_PROGRESS | No complete module evidence yet |
| 19.09 | Searchable tax types | UX | IN_PROGRESS | No complete module evidence yet |
| 19.10 | Searchable payment methods | UX | IN_PROGRESS | No complete module evidence yet |
| 19.11 | Searchable documents | UX | IN_PROGRESS | No complete module evidence yet |
| 19.12 | Responsive UI | UX | IN_PROGRESS | No complete module evidence yet |
| 19.13 | Mobile UX | UX | IN_PROGRESS | No complete module evidence yet |
| 19.14 | Dark mode | UX | IN_PROGRESS | No complete module evidence yet |
| 19.15 | Form validation | UX | IN_PROGRESS | No complete module evidence yet |
| 19.16 | Error states | UX | IN_PROGRESS | No complete module evidence yet |
| 19.17 | Loading states | UX | IN_PROGRESS | No complete module evidence yet |
| 19.18 | Success states | UX | IN_PROGRESS | No complete module evidence yet |
| 19.19 | Empty states | UX | IN_PROGRESS | No complete module evidence yet |
| 19.20 | Action confirmations | UX | IN_PROGRESS | No complete module evidence yet |
| 19.21 | POS usability | UX | IN_PROGRESS | No complete module evidence yet |
| 20.01 | Tax unit tests | Testing | IN_PROGRESS | 11 exact-decimal kernel tests pass (3,000 combination checks). Effective resolver, return allocation and posting integration coverage pending. |
| 20.02 | Accounting unit tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.03 | Pricing unit tests | Testing | IN_PROGRESS | Exact initial reference prices, maximum20 significant digits/native and projected audits, API masking and stored-price preview tested in product suite. Tiered pricing/discount workflows and amendments remain. |
| 20.04 | Discount unit tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.05 | Inventory unit tests | Testing | IN_PROGRESS | 12 pure RECEIVE/ISSUE weighted-average tests pass,3000 states/46500 steps. No inventory transaction/concurrency integration evidence yet. |
| 20.06 | Allocation unit tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.07 | Aging unit tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.08 | Reconciliation unit tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.09 | Sales integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.10 | Purchasing integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.11 | Payments integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.12 | Inventory integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.13 | Accounting integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.14 | Customer integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.15 | Supplier integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.16 | M-Pesa integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.17 | RBAC integration | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.18 | Full operational E2E | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.19 | Concurrency tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.20 | Idempotency tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.21 | Security tests | Testing | IN_PROGRESS | Current 97-test backend suite and all seven browser suites, worker human-actor spoof rejection and numbering tamper/rollback cases. Full-system security review still pending. |
| 20.22 | Upload attack tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.23 | Privilege escalation tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.24 | Database integrity tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.25 | Financial rollback tests | Testing | IN_PROGRESS | No complete module evidence yet |
| 20.26 | Full-system reconciliation scenario | Testing | IN_PROGRESS | No complete module evidence yet |
| 21.01 | Production Dockerfile | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.02 | docker-compose.yml | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.03 | docker-compose.prod.yml | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.04 | PostgreSQL persistence | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. September29 sandbox actually restored an older encrypted checkpoint; later original demo history lost. Fresh encrypted checkpoint now retained. See docs/backups/sandbox-recovery-20260929.md; production continuity/persistence remains unverified. |
| 21.05 | Worker | Deployment | IN_PROGRESS | Restricted auth worker + heartbeat verified; operational outbox/payment/integration workers unfinished; SMTP acceptance external. |
| 21.06 | Health live | Deployment | VERIFIED | apps/api/test/health.test.ts: real HTTP 200 with DB unavailable |
| 21.07 | Health ready | Deployment | VERIFIED | apps/api/test/health.test.ts: checksum/DB/worker/storage cases and real HTTP 503 |
| 21.08 | Health database | Deployment | VERIFIED | Real live DB readiness + unavailable-DB HTTP regression |
| 21.09 | Health storage | Deployment | VERIFIED | Unit test performs real write/delete; missing required root fails. Business attachment storage not implemented. |
| 21.10 | Health worker | Deployment | VERIFIED | Fresh/stale heartbeat unit tests; live restricted worker heartbeat query |
| 21.11 | Ubuntu installation | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.12 | Ubuntu deployment | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.13 | Ubuntu migration | Deployment | IN_PROGRESS | No complete module evidence yet |
| 21.14 | Ubuntu rollback | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.15 | Ubuntu logs | Deployment | IN_PROGRESS | No complete module evidence yet |
| 21.16 | Ubuntu restart | Deployment | IN_PROGRESS | No complete module evidence yet |
| 21.17 | Server reboot survival | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.18 | Container recreation survival | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.19 | Cloudflare Tunnel | Deployment | BLOCKED | Native Docker Compose validation passed using CLI 29.8.1 / Compose 5.5.1; actual rootless daemon failed on TAP permission. Image/container/reboot/Ubuntu/tunnel execution still blocked. See docs/deployment/config-verification.json. |
| 21.20 | Private infrastructure network | Deployment | IN_PROGRESS | No complete module evidence yet |
| 21.21 | Database backup | Deployment | VERIFIED | docs/backups/restore-verification.json: encrypted exported snapshot, local scope |
| 21.22 | Database restore | Deployment | VERIFIED | docs/backups/test-results.txt: real isolated restore/counts/ACL/journal checks September29 sandbox actually restored an older encrypted checkpoint; later original demo history lost. Fresh encrypted checkpoint now retained. See docs/backups/sandbox-recovery-20260929.md; production continuity/persistence remains unverified. |
| 21.23 | File backup | Deployment | VERIFIED | docs/backups/test-results.txt: protected file archive primitive, not attachment module |
| 21.24 | File restore | Deployment | VERIFIED | docs/backups/test-results.txt: exact content + traversal/link/overwrite refusal |
| 21.25 | Backup retention | Deployment | IN_PROGRESS | No complete module evidence yet |
| 21.26 | Disaster recovery drill | Deployment | IN_PROGRESS | Actual local encrypted DB/file restoration passed after migration 011. Production-host/offsite/reboot and operational-subledger reconciliation drills remain open. September29 sandbox actually restored an older encrypted checkpoint; later original demo history lost. Fresh encrypted checkpoint now retained. See docs/backups/sandbox-recovery-20260929.md; production continuity/persistence remains unverified. |
| 21.27 | Redis where required | Deployment | IN_PROGRESS | Not justified by implemented modules yet; evaluate before adding infrastructure. Local storage currently contains development auth mail only. |
| 21.28 | MinIO where required | Deployment | IN_PROGRESS | Not justified by implemented modules yet; evaluate before adding infrastructure. Local storage currently contains development auth mail only. |
| 22.01 | Architecture documentation | Documentation | IN_PROGRESS | Current docs/architecture plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.02 | Accounting documentation | Documentation | IN_PROGRESS | Current docs/accounting plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.03 | Workflow documentation | Documentation | IN_PROGRESS | Current docs/workflows plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.04 | Database documentation | Documentation | IN_PROGRESS | Current docs/database plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.05 | API documentation | Documentation | IN_PROGRESS | Current docs/api plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.06 | Security documentation | Documentation | IN_PROGRESS | Current docs/security plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.07 | Deployment documentation | Documentation | IN_PROGRESS | Current docs/deployment plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.08 | Backup documentation | Documentation | IN_PROGRESS | Current docs/backups plus original design pack. Documentation of future operational modules grows with implementation; not complete. |
| 22.09 | Troubleshooting | Documentation | IN_PROGRESS | Current implemented-scope guide exists in docs/troubleshooting/README.md. Full operational guide unfinished. |
| 22.10 | User guide | Documentation | IN_PROGRESS | Current implemented-scope guide exists in docs/user-guide/README.md. Full operational guide unfinished. |
| 22.11 | Requirements matrix | Documentation | IMPLEMENTED | 354 individually tracked rows; catalog/checkpoint generated ledgers. VERIFIED stays evidence-scoped. |
| 22.12 | Implementation status | Documentation | IMPLEMENTED | 354 individually tracked rows; catalog/checkpoint generated ledgers. VERIFIED stays evidence-scoped. |
| 22.13 | Safe comprehensive demo seed | Documentation | IN_PROGRESS | Development seed preserves existing credentials and production mode now refuses before database connection (seed-safety.test.ts). Comprehensive operational scenario seed remains unfinished. |
| 22.14 | Production readiness review | Documentation | IN_PROGRESS | No complete module evidence yet |
