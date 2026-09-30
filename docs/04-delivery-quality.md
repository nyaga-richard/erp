# Delivery gates, test strategy and operations

## Phase order and acceptance

| Phase | Build | Required exit evidence |
|---|---|---|
| 0 Design | 28 artifacts, target schema, explicit invariants | Executable DDL on PostgreSQL; design coverage and unresolved decisions |
| 1 Core | identity, RBAC/scope, organization, attribution/audit, periods, COA, numbering, journal posting | DB-enforced balance/immutability; unauthorized/cross-company tests; repeat/concurrent posting; creator/approver/poster trace; security lifecycle tests |
| 2 Inventory | catalog, searchable barcodes, UOM/prices/tax category, movement/valuation/reservation, transfers/counts | Concurrency no oversell, ending value at zero qty, movement=GL, approved adjustments, serial/batch controls |
| 3 Purchasing | requisition→PO→approval→partial GRN→match→AP→payment | No double inventory, GRNI reconciliation, overreceipt/duplicate invoice/variance controls |
| 4 POS/sales | cart→tender→stock→tax→journal→receipt | Cash/credit/walk-in/mixed tender atomicity, permissions/discount, receipt retry |
| 5 Customers | accounts, allocation, credit limits, statements/aging | AR reconciliation, serialized credit checks, advance/FX policy |
| 6 Returns | partial/full sales and supplier returns, notes/refunds | No excess cumulative return; original cost/tax; reversal dependencies |
| 7 Expenses/cash | approvals, petty cash, drawer reconciliation | All floats/transfers funded, variance reviewed, drawer=GL movements |
| 8 Tax | complete versioning, reports, Kenya/eTIMS mapping | Historical rules unchanged, categories/eligibility/tax point incl. advances; fiscal certification gate |
| 9 Integrations | verified M-Pesa/card/bank adapters | Sandbox success/failure/timeout/late success/duplicate/reversal; settlement matches |
| 10 Reports | operational/financial/user exports, reconciliation, close | Every control account reconciles, filters/exports agree, performance and UAT |

Dependencies are real: minimum tax/pricing/AR/payment contracts must exist before sales/purchasing posting. Phase 8 expands tax compliance; it does not defer basic tax correctness until after sales. Phase 5 expands customer functionality; Phase 4 credit checkout remains disabled until AR/credit services pass their tests. No placeholders may silently post zero tax, zero COGS or unverifiable payments.

## Before each domain implementation

Write workflow, entities/FKs, state graph, permissions/scope, attribution, policy/approval version, inventory/subledger/payment/tax/GL effects, reversal dependencies, audit/redaction, endpoint contracts and tests. Implement backend and database constraints first; run integration tests; only then implement UI and end-to-end tests. Update STATUS with actual evidence rather than declaring the whole module complete because tables exist.

## Test pyramid

- Unit: Decimal arithmetic, tax incl/excl and discount apportionment, account rule specificity, workflow transitions, credit exposure, weighted average/last-unit residual, approval thresholds.
- PostgreSQL integration: migrations from empty DB; checks/FKs/RLS; deferred balance constraints; period lock race; journal immutability; rollback at injected failures; posting uniqueness; idempotency hash mismatch; negative inventory/over-allocation prevention; actor membership and attribution; config history.
- HTTP integration: missing/expired/revoked sessions; CSRF; rate limits; inactive user; invalid permission/company/branch; forged creator rejected; request bounds; state conflicts; source drilldown; no leaked credentials/SQL.
- Concurrency: synchronized parallel workers attempting last stock, same idempotency key, same document, same receipt/provider ID, same credit limit, same invoice allocation, period close vs posting. Assert final authoritative ledgers rather than only HTTP status.
- Property tests: generated tax/discount/cost values at precision boundaries; debit=credit per event; every return sum ≤ original; movement reversal net quantity/value; permutations of callbacks give one receipt.
- E2E: three distinct users create/approve/post, view trial balance and source audit; cashier opens/checkout/reprints/reconciles; warehouse partial receive/transfer/count; manager exception review. Playwright desktop/tablet and keyboard-only paths.
- Reconciliation: AR, AP, inventory, GRNI, tax, payments, drawer, advances, allocations, GL. Inject a deliberately missing effect into disposable test DB and verify exception detection. Empty ledger equality is not coverage.
- Security/load: dependency scan, SAST/DAST, tenant-isolation fuzzing, upload attacks, reset enumeration, session fixation, XSS/CSRF, permission escalation, payment spoof/replay. Load checkout at agreed volume with repeatable fixtures; record p95/p99 and lock time.

Required operational fixtures: cash/credit/walk-in/mixed sale; cash/bank/card/M-Pesa receipt; partial/full return and refund; partial/full GRN; supplier match/variance/return/payment; advance/unallocated allocations; transfer with discrepancy; blind count; expense with eligible/ineligible tax; multi-user attribution. Each successful fixture asserts all downstream effects and all failure fixtures assert none committed.

## Production readiness gates

1. Accountant signs account/rule/tax mappings and opening balances; trial balance and every control reconcile.
2. KRA integration and tax classifications validated against current authoritative specifications; no compliance claim based solely on a VAT calculation.
3. M-Pesa merchant credentials and authenticated verification/settlement validated; secrets managed outside source.
4. RBAC/segregation approved, MFA/step-up, password reset delivery and session lifecycle independently tested.
5. Backup + PITR restore drill on separate instance, documented RPO/RTO, disaster-recovery ownership.
6. Migration rollback/forward plan; month/year close, fiscal failure and payment ambiguity runbooks exercised.
7. Load/concurrency/soak and independent penetration test; actionable observability and pager route.
8. PII retention, audit WORM export, attachment scanning and export/download audit approved.
9. Signed UAT with at least one complete procurement-to-cash and return/refund cycle per company.
10. Deployment keys/cookies/TLS restricted, DB runtime role non-owner, no seed/demo credentials and no exposed management ports.

Suggested objectives for owner agreement, not verified guarantees: RPO ≤ 15 minutes; RTO ≤ 4 hours; online checkout p95 < 1 second excluding provider round trips; primary financial commands auditable 100%. No benchmark claims are made for the delivered foundation.

## Operations

Structured logs correlate request/source/journal/payment/provider event IDs without PAN, PIN, passwords or tokens. Metrics: posting failures, deadlock/retry counts, outbox age, unreconciled amounts, fiscal failures, pending payment age, audit export lag, auth anomalies. Alert on imbalance attempts even when rejected. Retry serialization/deadlock failures at transaction boundary with bounded backoff; never retry external initiation blindly.

Outbox workers claim jobs using SKIP LOCKED leases, bounded retries and dead-letter review. Object uploads and provider calls are outside DB transaction; orphan quarantine objects expire through audited lifecycle jobs. Reports use repeatable-read cut-offs or read replica watermark; no financially inconsistent mixed snapshots. Close export jobs retain filter/schema version, actor and content hash. Excel/CSV escape formula injection; PDF assets are local and print layouts repeat headings.

## Decisions to confirm before corresponding release

Legal company names/PINs and VAT registration; branches/warehouses/terminals; actual product tax mapping; opening stock cost and stock cut-off; approval thresholds and required separation; returns windows/quarantine rules; bank/M-Pesa/card settlement accounts and merchant contracts; currencies and FX source; fiscal provider mode; hosting/RPO/RTO; retention and email/MFA providers. These do not block blueprint/core tests but block live operation.


## Increment 0.2 evidence

Access administration, recovery/session lifecycle, threshold/quorum approval snapshots and source revision controls were implemented under the separate [preimplementation contract](05-phase1-controls.md). Backend tests precede browser acceptance; the two current Chromium evidence files cover accounting and controls/recovery respectively. Production SMTP, MFA, organization/COA/rule/numbering controls and operational modules remain open. Exact current counts and limitations are maintained in [STATUS](../STATUS.md), not inferred from the target schema.
