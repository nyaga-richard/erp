# Resumable execution checkpoint — 29 September 2026

**FULL ERP NOT COMPLETE. Production readiness is false. Continue autonomously; no final completion report or new archive.**

## Current phase and immediate next task

Inventory and customers/AR remain **IN_PROGRESS overall**. Bounded reviewed single-product stock gain/loss/full reversal and initial customer registration are **VERIFIED within the explicit scope below**. The next customer/AR component, exact credit eligibility/calendar terms arithmetic, is **VERIFIED in isolation only**, with no endpoint, database write, reservation or posting authority.

**Next:** implement reviewed versioned customer metadata/credit-policy amendments and holds (design before migration020), then native transactional company/customer credit-exposure/commitment integration and actual AR source coupling. Read `docs/customers/credit-and-ar-next.md`; do not expose a client-driven credit quote as posting authority. Reuse existing customers/customer_accounts/customer_transactions, CommandService, workflow, accounting/rule/tax/valuation engines. Continue supplier/AP → purchasing → POS/cashiers → unified payments/M-Pesa → returns → expenses/reports/full operational reconciliation while retaining unresolved earlier lifecycle/security/deployment gates.

## Applied migrations and data

**001–019 applied and immutable.** Corrections require020+.018 adds stock source/valuation/movement/projection/GL/audit integrity;019 adds independently reviewed immutable initial customer publication and AR-account binding. Neither fabricates opening balances or production business activity. Demo fixtures are explicitly identified and retained.

## Completed this execution cycle

- Stock UI now displays actual posted debit/credit and retained policy/step quorum, refreshes parent summaries after commands, and opens stock sources from GL/audit instead of the manual-journal editor. Added bounded first-column wrapping on mobile.
- Stock restricted-reader browser test: no costs/source/balances/reconciliation without cost permission; explicit cost grant enables read-only stock UI without finance/mutation authority. Backend403 and audit redaction verified. Real reset-mail identity; fixture membership retired.
- Customer contract and genuine missing-route404 RED before backend.019 native immutable requests/publications/bindings, independent review, current company/account/classification eligibility, exact credit strings and complete audit. Deferred guards recheck final rows after deliberately corrupting BEFORE triggers. No AR transactions, opening balance or credit-sale authority.
- Customer service/controller and UI: scoped catalog/requests, initial proposal/review, AR/classification pickers, attribution, read-only detail, least-privilege navigation. Customer snapshots redacted from generic audit without customers:view.
- Browser inspection corrected the credit-limit accessible label and reusable ConfigurationPicker query separator when paths do not already contain '?'. Customer workflow and isolated reader pass; desktop/mobile/dark screenshots inspected.
- Continued beyond registration with `customer-credit.ts`: pure exact-decimal positive-credit eligibility, zero-limit/hold/inactive/walk-in denial, bounded source commitment replacement arithmetic, capacity refusal, detached immutable snapshots and calendar due dates. No public route, locks, reservations, financial entries or integration yet.

## Executed verification

- **250 backend tests pass, zero failures**,86 top-level,47,304.927504ms in `docs/test-results.txt`; API build passes. Includes stock15/customer10 and pure credit10 tests. Credit cases include3,465 deterministic cent combinations, large exact values, Decimal-global isolation, replay/freeze and leap/year/calendar overflow. Genuine RED retained in `docs/testing/red-evidence/customer-credit.txt`.
- **All21 browser suites passed** on one frozen application/migration baseline, completed17:08:38.661Z: `docs/testing/browser-regression.{json,txt}`. Runner safely paused across the natural login-throttle expiry and resumed with matching source fingerprint. No failed suite in this successful run. The pure, unreferenced credit helper was added afterward; UI and exposed APIs are unchanged. Do not describe the old source fingerprint as including that later helper; its evidence is the250-test backend run.
- New individual receipts: `docs/browser-stock-result.json`, `browser-stock-access-result.json`, `browser-customers-result.json`, `browser-customer-access-result.json`. Stock exercises real reviewed mappings, independent actors, gain10/100→loss4/40→full original-cost reversal→10/100, exact posted lines/policy quorum, GL/audit drilldown and reconciliation PASS. Customer exercises inert proposal→independent exact publication, no implicit finance, original maker/reviewer, keyboard/mobile/dark. All consoleErrors arrays empty.
- Final customer web typecheck, optimized build, six exact-presentation tests, production-web CSP/nonce/hydration/private API proxy smoke and six generic encrypted DB/file recovery tests pass after the picker/label fixes: `docs/deployment/customer-final-build-results.txt`, `docs/deployment/next-production-result.json`, `docs/backups/restore-verification.json`. Production backend and Docker remain unverified.
- **Actual encrypted019 isolated restoration after the browser sweep**: `docs/testing/customer-restoration.json`,17:08:54.528Z. Retained56 sources/43 journals/86 lines/950 audits,15 stock sources/15 valuations/13 movements/five pools/four reversals and two reviewed customers/two bindings/zero AR transactions. All19 migration hashes match; zero projection/inventory-GL/link/original-cost reversal/posted-stock-audit/customer-audit/customer-identity discrepancies. Live DB untouched.
- Earlier actual018 restoration preserved separately in `docs/testing/stock018-restoration.json`. `.runtime/latest-backup.json` points at latest verified019 backup; `.runtime/pre019-backup.json` retains the encrypted pre019 checkpoint. Backup creation alone is never restore evidence.
- Exported schema135 tables/1453 columns/579 foreign keys; OpenAPI95 paths. Architecture book regeneration includes stock and customer contracts; HTML viewport inspected, PDF text/layout structure checked (65 pages,367957 bytes after final refresh). Latest delivery inspection: `docs/testing/stock-customer-delivery-inspection.json`;353 requirement rows.

## Incidents resolved and important boundaries

- Next development host can auto-restart near its memory threshold; fresh stable host passed. Do not edit during browser runs. Stop dev host before heavy optimized builds; production host deliberately blocks iframe embedding, so never weaken CSP to use it as Arena preview.
- Prior combined run hit unchanged60-logins/15min throttle; waited naturally, never cleared buckets. Stock test now uses three isolated authenticated browser sessions (five logins rather than eleven). `scripts/browser-regression.cjs` observes available budget and pauses before exhaustion; it rejects resumption after application/migration source changes.
- Interrupted stock source **75be0db8-a3e9-470a-839c-5284ec480698 / SG-2026-000004** was cancelled through Amina's authenticated API after expiry, with explicit reason. Posted fixtures/history remain. The access administrator was correctly denied stock cleanup; failure cleanup now uses the existing creator session, not widened privileges.
- Customer browser failures were selector ambiguity and picker URL construction, fixed and retested before progression. No failed run had published a customer. Current two published customers are deliberate successful DEMO acceptance fixtures.
- Customer restoration harness initially used an unquoted mixed-case SQL alias; corrected harness, then actual restore rerun passed. Architecture renderer needed markdown installed into `.cache/python-tools`; first stale-PDF attempt was discarded by successful full regeneration. Smooth-scroll screenshot timeout was fixed in the inspection harness, not by changing the application.

## Runtime and resume

Workspace `/home/user/kenya-erp`, no git. Node22 executable `/home/user/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`. Live API `erp-api-6a8d964e`, port3000, `.cache/api.log`; Next development preview **`karibu-erp-e0284345`**, port5173,384MB/no-source-maps; PostgreSQL and auth mail worker active. Latest readiness passed with database/migrations/worker OK and productionReady false. API currently exposes019 services; pure credit helper is unreferenced and needs no activation.

Runtime/cache/build/dependencies are excluded from snapshots. After reset restore latest encrypted checkpoint into an isolated database, verify, promote only if live DB is absent; preserve credentials and audit history. Never package `.env`, private access file, keys, mail, `.runtime` backups or caches. Renderer dependency: `PYTHONPATH=.cache/python-tools python scripts/render-design.py`; install markdown/pypdf there again if absent, then render PDF with Playwright.

Actual user-side Arena routing/login remains unconfirmed. Memory-mode sandbox sessions avoid cookies but still enforce expiry, revocation, CSRF and permissions. Reload requires sign-in. Do not reset credentials or claim local iframe tests prove external access.

## Remaining production gates

Full operational procurement-to-cash/credit/returns/payment/expense scenario and reconciled ledgers; remaining inventory/customer/supplier/security/organization/account/tax lifecycle; production-host Docker/Ubuntu/Tunnel reboot/recreation/update/rollback verification; offsite/PITR/retention and issuance-continuity policy; external SMTP/M-Pesa/eTIMS contracts/credentials; broader security/load/soak/accessibility proof. Docker runtime blocked here by TAP privileges, not verified. No production payment success or transactions fabricated. Continue feasible work without asking whether to continue.
