# Kenya Retail ERP — Architecture & implementation contract

Baseline 0.1, accompanied by increments 0.2–0.5 controls · 26 September 2026 · PostgreSQL / NestJS / React / TypeScript

**Status:** engineering blueprint, not a certification of production readiness. Database structures are a target baseline. Only capabilities listed as tested in `STATUS.md` are implemented. No live payment or fiscal integration is implied. Retail/wholesale, KES functional currency initially, online-only POS, perpetual weighted-average costing. Other currencies are designed but must remain disabled until settlement/revaluation tests pass.

## Deliverable map

| Requested deliverable | Location |
|---|---|
| 1 Overall architecture; 2 Module architecture | §1–2 |
| 3 ERD; 4 Complete database schema | `02-data-model.md`, `db/001-core.sql`, `db/002-domains.sql`, additive migrations `db/003-hardening.sql` through `db/006-company-and-warehouses.sql` |
| 5 Accounting; 6 COA; 7 Rule engine | §3–5 |
| 8 POS; 9 Purchasing; 10 Inventory; 11 Customer; 12 Supplier | §6–10 |
| 13 Payments; 14 M-Pesa; 15 Tax; 16 Cashier; 17 Expenses | §11–15 |
| 18 Approvals; 19 Attribution; 20 Audit; 21 State machines | §16–19 |
| 22 Permission matrix; 23 API | `03-api-security.md` |
| 24 Sequence diagrams | §20 |
| 25 Reversals; 26 Reconciliation | §21–22 |
| 27 Testing; 28 Phases | `04-delivery-quality.md` |

“Complete schema” here means the full target table baseline, not that every constraint or business service has been implemented. Domain-specific posting guards, fiscal mapping, reporting views and migrations will be refined and tested before those domains are released. The implementation status is deliberately separate from the design.

## 1. Overall architecture

Use a **modular monolith**, not independently committing microservices. PostgreSQL is the financial system of record. A command changes its document, ledgers, movements, tax facts, journal, audit and outbox within one database transaction. Async workers may deliver external side effects; they never independently invent ledger balances.

```
React workspace / POS
    │ HTTPS + secure authenticated session + CSRF
NestJS API
    │ Validation → Authentication → Membership → Permission → Scope
Command / TransactionCoordinator
    ├─ WorkflowService / ApprovalService / NumberingService
    ├─ PricingService / TaxService / InventoryService
    ├─ CustomerLedgerService / SupplierLedgerService
    ├─ PaymentService / CashierService
    ├─ AccountingService (single posting gateway)
    └─ AuditService / OutboxService
    │ one connection, one transaction, company scope
PostgreSQL — relational documents + append-only ledgers + snapshots
    ├─ outbox → workers → M-Pesa / eTIMS / email / object storage
    └─ read models → dashboards / reports / exports
```

Transactions receive an immutable context: authenticated actor, effective company, permitted branches, session, request ID, trusted IP, action, reason and idempotency key. Frontend actor fields are rejected, not ignored. No database writes use a client-supplied creator. UUID source registry with a real foreign key replaces unconstrained `source_type/source_id` polymorphism.

Deployment target: separate API and workers, static web, managed PostgreSQL with PITR, private object storage, TLS ingress, secret manager, telemetry and alerting. Redis can support throttling/work queues but is not financial authority. Containers run non-root. App DB role is neither owner nor superuser; migrations use separate credentials. Company RLS is defense in depth; authorization is still mandatory. Restore drills, load tests and independent security/accounting sign-off precede production.

## 2. Modules and ownership

| Domain | Owns | May request effects from |
|---|---|---|
| Identity | users, sessions, role grants, security events | Audit |
| Organization | company, branch, warehouse, terminal | Identity, Audit |
| Core workflow | document registry, transitions, numbering, approvals | Audit |
| Catalog | products, UOM, categories, barcodes, price lists | Tax configuration |
| Inventory | movements, reservations, lots, counts, valuation | Accounting |
| Procurement | requisitions, PO, GRN, matching, supplier invoices | Inventory, AP, Tax, Accounting |
| Sales/POS | quotes, orders, invoices, sale lines, returns | Inventory, AR, Payments, Tax, Accounting |
| Partners | customers, suppliers, credit policy | Subledger |
| Payments | intents, confirmations, allocation, reconciliation | AR/AP, Cashier, Accounting |
| Cash management | shifts, floats, transfers, petty cash | Payments, Accounting |
| Expenses | requests, category/cost center, receipts | Tax, AP/Payments, Accounting |
| Accounting | accounts, rules, periods, journals, GL | Core/Audit |
| Tax/Fiscal | effective rules, tax facts, eTIMS submissions | Outbox, Accounting |
| Reporting | projections, reconciliations, exports | Read-only ledger contracts |

Controllers invoke services. Shared services take a transaction connection rather than opening nested transactions. Domain modules cannot insert arbitrary journal lines outside AccountingService. Reports never mutate ledgers. Materialized caches are rebuildable and cannot be edited through an API.

## 3. Accounting architecture

Journal headers link exactly one source document and company, branch, currency, exchange-rate snapshot, accounting date, period and actor. Lines hold account, transaction debit/credit, functional debit/credit and dimensions (partner, warehouse, item, cost center as applicable). Both debit/credit totals must balance **exactly at currency scale**. A line has precisely one positive side, not both. Zero-value lines are omitted. Non-posting parent/inactive accounts are blocked.

A journal is constructed inside the database transaction, validated and sealed POSTED before commit. It must not be possible to commit an unsealed journal. Posted headers and lines are immutable at DB level. Reversal creates a new source and a new opposite journal; a relation marks the original as reversed without modifying its amount, author, date or lines. Draft manual journals are document payloads, not posted journal tables.

Closed-period guards hold a share lock on the selected period until commit. Close/reopen takes an exclusive row lock and therefore serializes with posting. Non-overlapping company periods use exclusion constraints. Period close requires reconciliation, pending posting review, accrual review and approval. LOCKED periods have no ordinary reopen command; exceptional administrative unlocking requires separate dual-controlled procedure.

Never allow standalone manual entries to AR, AP, inventory, cash-payment or tax control accounts. Authorized opening and correction services must create matching subledger/movement/tax/payment entries. The initial manual-journal API blocks all control accounts. An accountant can use non-control expense/equity accounts while operational services are unfinished.

Functional currency balances are authoritative for consolidated company books; original currency remains available. Foreign currency settlement uses historical carrying value and books FX differences to configured realized gain/loss. Period-end revaluation is reversible and explicitly linked. Intercompany transactions produce two separately balanced company journals under a linked workflow; never one journal spanning companies.

## 4. Configurable chart of accounts

Example starter structure (codes are configuration, not application constants):

| Code | Name | Type | Control use |
|---|---|---|---|
| 1000 | Assets | ASSET | Parent, not postable |
| 1100 | Cash drawers | ASSET | Cash movement |
| 1110 | Petty cash | ASSET | Cash movement |
| 1200 | Bank | ASSET | Payment |
| 1210 | M-Pesa wallet | ASSET | Payment |
| 1220 | Card clearing | ASSET | Payment |
| 1300 | Trade receivables | ASSET | AR |
| 1310 | Supplier advances | ASSET | Supplier advances |
| 1400 | Merchandise inventory | ASSET | Inventory |
| 1410 | Inventory in transit | ASSET | Inventory |
| 1500 | Recoverable input VAT | ASSET | Tax |
| 2000 | Liabilities | LIABILITY | Parent |
| 2100 | Trade payables | LIABILITY | AP |
| 2110 | Goods received not invoiced | LIABILITY | GRNI |
| 2120 | Customer deposits | LIABILITY | Customer advances |
| 2200 | Output VAT | LIABILITY | Tax |
| 3000 | Equity | EQUITY | Parent |
| 3100 | Opening equity | EQUITY | Controlled migration |
| 3200 | Retained earnings | EQUITY | Year close |
| 4000 | Sales | REVENUE | Posting |
| 4010 | Sales returns | REVENUE | Contra revenue |
| 5000 | Cost of goods sold | EXPENSE | Posting |
| 5100 | Stock loss / damage | EXPENSE | Posting |
| 5200 | Purchase price variance | EXPENSE | Posting |
| 6000 | Operating expenses | EXPENSE | Parent |
| 6100 | Rent | EXPENSE | Posting |
| 6200 | Utilities | EXPENSE | Posting |
| 6300 | Cash over/short | EXPENSE | Approved variance |
| 6400 | Merchant fees | EXPENSE | Posting |
| 6500 | FX gain/loss | EXPENSE | Posting |

Each company owns its own tree. Parent cycles are forbidden. Accounts used historically cannot be deleted or repurposed. Bank/wallet accounts are mapped to an account and currency; bank account details are protected from ordinary cashiers. Financial statement mappings are versioned, separate from account codes.

## 5. Rule engine

A versioned rule set maps symbolic legs to company-owned accounts. Select by transaction type and effective date, then optional branch, warehouse, product, category, payment method and tax category. Priority and specificity must resolve to exactly one rule; ambiguity or missing mapping blocks posting. Snapshot selected rule/version/account IDs with every journal. Never execute arbitrary rule code or `eval` expressions; allow-listed leg definitions select named totals computed by domain services.

| Event | Debit | Credit |
|---|---|---|
| Cash sale | Tender accounts (net cash after change) | Revenue, output tax |
| Credit sale | AR | Revenue, output tax |
| Goods sold | COGS | Inventory at issued carrying cost |
| Customer receipt | Cash/bank/wallet | AR; deposits for unallocated advances |
| GRN | Inventory at provisional receipt cost | GRNI |
| Matched supplier invoice | GRNI, recoverable tax; inventory/variance if needed | AP |
| Direct non-stock invoice | Expense, recoverable tax | AP |
| Supplier payment | AP; supplier advances for excess | Cash/bank/wallet |
| Expense paid immediately | Expense, eligible input tax | Tender |
| Inventory shortage | Stock loss | Inventory |
| Inventory excess | Inventory | Approved stock-gain account |
| Internal cash transfer | Destination cash | Source cash |

**No double inventory capitalization:** purchase invoice does not debit the entire Inventory a second time after a GRN. Match GRNI; split subsequent price differences between stock remaining and COGS/variance under an approved policy. GRNI remains reconciled by receipt line. Purchase-order approval itself creates no journal. Receipt taxation and invoice input VAT timing follow the configured tax policy, not blanket assumptions.

## 6. POS and sales workflow

1. Authenticated cashier opens/uses their own terminal session. One open session per terminal. Opening float is a posted transfer from safe, not unexplained cash creation.
2. Scan keyboard barcode, enter SKU or server-side search. Exact barcode match first. Unknown barcode shows controlled exception; never invent a price or product. F2 search, F4 customer, F6 tender, F8 hold, F9 submit, Escape close dialog. Per-user key mapping can override defaults.
3. Cart quotes use server pricing/tax and stock visibility; they do not post. Walk-in requires no permanent party and cannot receive credit. Holds persist cart version and expire reservations; they are not sales.
4. Server revalidates catalog, price policy, discount approval, tax date, active warehouse, session ownership, reservation, customer credit and tender facts.
5. Cash amount tendered is distinct from applied amount and change. Mixed tenders must sum to invoice total; non-cash overpayment is an advance, never automatic change. Card requires verified provider confirmation or a controlled manual settlement workflow.
6. Lock stock valuation keys in deterministic company/warehouse/product/lot order. Lock customer credit exposure and allocations. Check available stock/credit including active reservations.
7. In one transaction create source/sale/lines, applied payments, movement/cost snapshots, AR if credit, tax facts, cash movements, balanced journal(s), audit and outbox. Post once, then return receipt.
8. Print via local browser/receipt bridge. Reprint marks COPY and audits. Transport/printing failure does not undo a committed sale; retry retrieves the existing idempotent result.

Receipt shows company/branch, number, date, cashier, terminal, item quantities/prices/discounts/tax, total, tender, change and fiscal status. Fiscal reference/QR appears only when real fiscal confirmation is obtained. UI must not label pending fiscal output as a compliant tax invoice.

## 7. Purchasing workflow

Requisition → approved PO → partial/full GRN → matched supplier invoice → AP → allocated payment. Ordered/received/invoiced/returned quantities derive from line links, not manually editable header booleans. Overage requires authorization. Rejected/damaged items enter quarantine when physically accepted, otherwise do not inflate sellable stock.

Three-way match compares supplier, SKU/UOM, received-minus-already-invoiced quantity, unit cost, tax basis/rate, currency and invoice uniqueness. Company+supplier+normalized supplier invoice number is unique. Quantity/price/tax tolerances are versioned; over-tolerance moves to exception approval, never silently writes off a discrepancy. GRN locks PO lines. Invoice locks receipt allocations. Backorders remain visible. Landed costs create cost-adjustment movements and journals, never mutate historical movements.

Supplier returns reference receipt and cost allocation. Block quantities greater than accepted less previous returns. Physical dispatch can create a supplier claim/clearing balance pending supplier credit note; AP/input-tax effects depend on the accepted fiscal credit document. Do not imply supplier acceptance merely because stock was sent back.

## 8. Inventory and valuation workflow

Authoritative stock = sum signed movements by company, warehouse, product, lot/serial and ownership/status. A balance/valuation projection can be locked for performance; no UI CRUD for it. Movement includes source line, quantity, functional value, actor and original movement for reversals. Zero-quantity value adjustments are permitted only via a specialized valuation command, never ordinary stock receipt/issue.

Weighted average per company/warehouse/product valuation pool: receipt adds quantity and carrying value; issue cost is current value / quantity at high precision, rounded to base currency at posting; issuing the final quantity consumes the entire remaining value. Transfers preserve carrying cost; not selling price. At zero quantity, carrying value must be exactly zero. Stock reservations affect available quantity but not on-hand or GL. Negative stock is disabled initially. Backdated cost-impacting commands are blocked before the last valuation event; do not silently recalculate previous COGS. FIFO is a future cost-layer implementation, not a selectable non-working option.

Transfer request → approval → dispatch to transit → partial receipts → discrepancy decision → completion. Transit is a real location and GL dimension. No goods disappear between branches. Cross-company movement is intercompany procurement/sale, not an internal transfer. Counts freeze scope or record cut-off movements; independent blind count and approved variance precede stock and GL adjustments. Serial uniqueness, batch expiry, quarantine eligibility and sale UOM conversions are enforced at posting. Expired/quarantined stock cannot be sold through ordinary POS.

## 9. Customer workflow

Create identifiable party and account; credit permission controls terms/limit changes with audit. Credit exposure = open receivables + configured commitments/reservations, adjusted for eligible credits. Lock account before checking new credit. Terms and due dates snapshot on invoices. Opening balances enter through approved migration documents with AR reconciliation, never a customer.balance field.

Invoices debit customer subledger/AR; receipts and credit notes credit it. Advances map to customer-deposit liability and are separately presented until applied. Allocations are immutable events linking receipt/credit to invoice with reversal records. Lock both open items before allocation; do not over-allocate, cross-company allocate or silently mix currencies. Aging uses unallocated residual amounts and due-date buckets, not net customer balance. Statements include original and reversing events with running balance.

## 10. Supplier workflow

Vendor onboarding and bank-detail changes need stronger permissions/approval. Supplier invoices credit AP; payments and recognized credit notes debit AP. Supplier advances are asset open items until allocated. Supplier statement liability balance is credits minus debits. Invoice duplicate checking is independent of idempotency. Payment approval is distinct from invoice approval and bank release. Payment/export initiator must not approve their own disbursement where policy requires independent users.

## 11. Central payments workflow

Separate **intent**, **provider attempt**, **verified receipt/disbursement**, **allocation**, **settlement** and **accounting reversal**. Tender methods select company-owned bank/wallet/cash/clearing accounts. Each payment retains initiator and verifier/poster origin, amount/currency, provider references and source. Ledger records reflect actual movement, not merely requested movement.

States: PENDING → SUCCESSFUL | FAILED | CANCELLED | TIMEOUT; SUCCESSFUL → REVERSED only after actual confirmed reversal and reversing entries. TIMEOUT is unresolved until queried; a late success is retained and must not be lost. UI cancellation does not cancel external funds. Card charges settle through clearing; merchant fees are separate expense entries, not unexplained netting. Settlement allocation matches provider statement rows with tolerance exceptions requiring approval.

## 12. M-Pesa workflow and external atomicity

In local transaction create payment intent and outbox, reserve cart stock and credit if required; commit before contacting provider. Worker initiates STK with retry-safe correlation and records request IDs. Ambiguous network timeout is queried/reconciled before retrying initiation. Raw callback is untrusted input: size/type validation, expected request lookup, expected merchant identity, amount/currency/phone reference checks where available, durable inbox and unique provider receipt key. **Do not assume an HMAC signature exists in a provider interface.** Select verification mechanisms from the actual contracted API; source IP controls are only defense in depth. Independently verify payment through available authenticated provider query/statement capability before financial success. If evidence is insufficient, hold for review rather than posting.

Verified result triggers a local atomic posting command attributed to integration service principal and original human initiator. Duplicate callback or retry returns previous outcome. If stock reservation expired or period closed, recognize verified funds as customer/unidentified receipt liability with explicit reconciliation exception; do not fabricate a sale or lose received money. Verified provider funds cannot be rolled back by rolling back the local database. Refund is a new external operation and local reversing/clearing process. Outbox/inbox processing is at least once with idempotent consumers, not a claim of global exactly-once delivery.

No live adapter is delivered in Phase 1. Safaricom portal access, shortcode ownership, sandbox fixtures and production approval must be supplied/verified before release. The attempted public Express query documentation URL did not expose a usable specification; protocol details remain a gate, not invented implementation.

## 13. Tax architecture and Kenya boundary

Central engine selects effective version from item category, partner eligibility, transaction type, location and tax point. Preserve taxable/zero-rated/exempt/non-taxable as distinct categories even when amount is zero. Store rate, version, basis, discount allocation, inclusive flag, rounding method, input eligibility, tax-point date, currency/base amounts and mapped account. Multiple taxes need defined ordering/compounding. Configuration changes create future versions; historical snapshots never change.

At the time of design, KRA's VAT page lists a 16% general rate and 0% zero-rate, distinguishes exempt supplies, and says the former petroleum 8% rate was deleted from 1 July 2023. Do not infer an item's legal category from its name. The same page describes tax point as the earliest applicable event, including receipt of part/full payment. Therefore advance-payment VAT must be modeled and cleared on final invoicing without double charging. Input VAT requires eligibility/supporting evidence; nonrecoverable tax is capitalized/expensed as appropriate. **No live tax rates are activated automatically by the foundation seed.**

Primary reference retrieved 26 September 2026: https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax . eTIMS entry point: https://www.kra.go.ke/online-services/etims . Obtain current legislation, KRA integration specification and accountant approval before activation. This design is not tax advice or eTIMS certification.

Tax rounds at documented line/currency scale, then sums. Inclusive net is gross/(1+rate), rounded per configured policy; tax = gross − net. Allocation of header discount uses largest-remainder distribution with stable line ordering. Rounding differences only use an explicit configured rounding leg within a documented tolerance; unexplained residuals fail posting.

Fiscal outbox stores immutable invoice snapshot/hash, reference, attempts, fiscal receipt/QR and failure status. Accounting date and fiscal issuance state are separate. Adapter-specific legal issuance rules can block final receipt or queue under an approved outage procedure. Retry cannot create a second fiscal invoice. Credit note references original fiscal invoice. Readiness includes eTIMS sandbox/approval, legal tax mapping and outage procedure.

## 14. Cashier and petty cash workflow

OPEN → ACTIVE → RECONCILIATION → CLOSED. Cashier owns terminal session. Expected cash derives from signed drawer movements: float + cash sales + collections + cash transfers in − cash refunds − paid-outs − transfers out. Credit/M-Pesa/card sales do not inflate cash expected. Physical count is blind and captured separately. Variance = actual − expected. Supervisor reviews reason/evidence, posts over/short and transfers counted cash to safe; never overwrites original movements. Late verified noncash payments remain linked to originating session with explicit late-settlement event, not forced into another cashier's cash.

Petty cash follows the same movement ledger with custodian/cash-account dimension. Replenishment is bank→petty cash; approved expense reduces petty cash. A counted shortage needs a variance transaction. Count, reconciler and approver are separate attribution fields.

## 15. Expense workflow

DRAFT → PENDING_APPROVAL → APPROVED → POSTED. Lines have category, expense account, cost center, net/tax/gross, eligibility and supplier/payee. Attachments go to quarantine before virus scanning; link object/hash/size/MIME/uploader and source. Approved revision invalidates previous approvals. Pay later creates AP; paid now uses payment engine in same posting transaction. Foreign supplier/WHT/other taxes require separately configured rules; unavailable rule blocks the relevant workflow. Reversal retains attachment and reason, and creates counter-entry/credit document rather than deleting expense.

## 16. Approval workflow

Versioned policies scoped to company/branch/event define currency, threshold, required steps, role/permission, creator-versus-approver and creator/approver-versus-poster separation. Threshold comparison uses documented functional amount, never a user-manipulable currency. Record policy version, decision, actor, timestamp, comments and document revision. Value/lines/currency changes invalidate pending approvals. A rejection records decision; revising creates new approval cycle. Delegations are time-bound, scoped and audited. No role name is hard-coded in service logic.

At least two-person approval is required for production configuration, opening balances, account/control mapping, period reopening, bank details, refunds, stock adjustment and high-value supplier payment. Three-person rules can be enabled. Initial foundation journal workflow implements independent creator/approver/poster when configured in its company policy; full multi-stage thresholds remain pending.

## 17. Attribution architecture

`users` includes non-login service principals with type HUMAN/SYSTEM/INTEGRATION and service code, so every creator/poster foreign key is non-null. HUMAN accounts authenticate; service principals are restricted to assigned machine workflows and cannot log into the UI. An `initiated_by` link preserves the initiating human. Created_by never changes. Each transition writes an append-only event with actor; header approval/posting metadata is derived or write-once. Database guards validate actor context for protected source/audit/journal inserts. Cross-company foreign keys include company ID. Actors must have active membership when commands execute; revocation is checked server-side on each request.

## 18. Audit architecture

Append-only audit records contain event ID, UTC timestamp, effective company, actor/type/service, initiating user, action, module/entity/source, request/session, trusted IP/device, redacted old/new values and reason. Do not copy secrets/tokens/passwords/provider credentials into audit. Record draft edits, approval, posting, reversal, permission change, period transition, security events, exports and receipt copies. Failed command/security audit uses an independent committed record because transaction rollback otherwise removes it.

Normal users and runtime DB roles cannot update/delete audit. Operational FK deletion is RESTRICT, not CASCADE. A privileged DBA can still tamper with a database; production must export signed audit batches to restricted immutable/WORM storage and monitor gaps. A local hash chain alone is not proof against administrators. Retention/legal holds and Kenyan privacy/ODPC obligations need owner approval; don't invent a blanket purge duration. PII access/export is permissioned and logged.

## 19. State machines

| Document | Allowed transitions | Financial effect |
|---|---|---|
| Quote/order/PO | DRAFT → PENDING_APPROVAL → APPROVED → PARTIAL → COMPLETED | Commitments only until fulfillment |
| Draft invoice/expense/manual journal | DRAFT → PENDING_APPROVAL → APPROVED → POSTED | Atomic posting only at final transition |
| Rejected draft | PENDING_APPROVAL → REJECTED → DRAFT (new revision) | None |
| Cancellation | DRAFT/PENDING_APPROVAL/APPROVED → CANCELLED, if no posted children | None; posted children require compensations |
| Posted source | POSTED + linked compensating source | Original immutable; effective display REVERSED or PARTIALLY_RETURNED |
| Stock transfer | DRAFT → APPROVED → DISPATCHED → IN_TRANSIT → PARTIAL → COMPLETED | Paired movements, preserving value |
| Count | DRAFT → COUNTING → SUBMITTED → APPROVED → POSTED | Approved variance only |
| Period | OPEN → CLOSED → LOCKED; CLOSED → OPEN authorized | Lock/audit, not arbitrary status patch |
| Payment | PENDING → SUCCESSFUL/FAILED/CANCELLED/TIMEOUT; verified late resolution | Only verified funds create money movement |
| Cashier | OPEN → ACTIVE → RECONCILIATION → CLOSED | Movements retained |

Transitions are domain commands with preconditions and version checks. There is no general `PATCH status` endpoint.

## 20. Transaction sequences

```mermaid
sequenceDiagram
  participant U as Cashier
  participant A as API / SaleService
  participant D as PostgreSQL
  participant E as Shared engines
  U->>A: Complete sale (Idempotency-Key, cart revision)
  A->>A: Session, membership, permission, scope, validation
  A->>D: BEGIN; claim key; lock period/session/stock/customer
  A->>E: Price + discount policy + tax + available stock + credit
  E->>D: Sale + payment + inventory/cost + AR + tax
  E->>D: Balanced journal + audit + outbox
  A->>D: COMMIT (deferred integrity checks)
  A-->>U: Stable source/receipt/journal IDs
  Note over A,D: Any failure rolls back all local financial effects
```

```mermaid
sequenceDiagram
  participant B as Buyer
  participant P as PurchaseService
  participant D as PostgreSQL
  B->>P: Approved PO → receive selected lines
  P->>D: BEGIN; lock PO lines + valuation pools
  P->>D: GRN + quantity/value movement + Dr Inventory / Cr GRNI
  P->>D: Audit + COMMIT
  B->>P: Supplier invoice, receipt allocations
  P->>D: BEGIN; lock GRN allocations; duplicate check; three-way match
  alt Outside tolerance
    P->>D: Save exception for independent approval (no AP)
  else Matched/approved exception
    P->>D: Invoice + tax + AP + Dr GRNI/input VAT / Cr AP + audit
  end
  P->>D: COMMIT
```

```mermaid
sequenceDiagram
  participant C as Cashier
  participant A as PaymentService
  participant D as PostgreSQL
  participant W as Outbox worker
  participant M as M-Pesa
  C->>A: Initiate STK (human session)
  A->>D: Intent + stock reservation + outbox; COMMIT
  W->>M: Initiate provider request
  M-->>W: Request accepted (NOT payment)
  M->>A: Untrusted callback
  A->>D: Persist deduplicated inbox; acknowledge durable receipt
  W->>M: Verify using contracted authenticated capability
  M-->>W: Verification evidence
  W->>D: BEGIN; lock intent; claim receipt ID
  W->>D: Verified payment + sale or receipt liability + journals + audit
  W->>D: COMMIT
```

## 21. Reversal architecture

Original posted source is immutable; `document_links` and immutable reversal source establish reversal relationship. Full reversal allowed only once by uniqueness; partial returns track quantities/allocations against original lines and cumulative return limits. Reversal requires date in open period, independent approval as configured, permission and reason. Reverse source and journal preserve original tax and cost snapshots, not today's tax or selling cost. Sales return restocks at original issued value where physically returned and saleable; damaged returns enter quarantine and separate impairment if appropriate.

An exchange = return + new sale with explicitly allocated credit. Cash refund is separate payment movement tied to return. Allocated payment reversal first reverses allocations to reopen invoices; cannot leave paid invoices with cancelled funds. Reversing a GRN already invoiced/sold requires dependency-aware compensations, not blind negative stock. A supplier invoice already paid cannot be cancelled as if payment vanished. Posted manual journals may be reversed by an independently approved reversal request; no direct header/line edit.

## 22. Reconciliation architecture

Run on-demand and scheduled, same-company functional currency, consistent repeatable-read snapshot and cut-off. Store run ID, ledger watermarks, filters, rule version, expected, actual, difference and offending source IDs. No balancing plug. Alert owners; material unexplained differences block period close.

| Check | Authoritative comparison |
|---|---|
| AR | customer debit-credit subledger by control account = AR GL debit-credit |
| AP | supplier credit-debit subledger = AP GL credit-debit |
| Deposits/advances | respective open-item ledger = liability/asset GL |
| Inventory | signed movement value by valuation pool = Inventory GL; qty projection = signed movement qty |
| GRNI | uninvoiced receipt carrying values = GRNI liability |
| Tax | input/output tax signed facts separately = mapped tax GL |
| Payments | posted money-movement debit-credit by mapped account = payment-control GL, including fees/transfers/openings |
| Drawer | signed session cash movements = expected drawer cash; physical count separate |
| GL | every journal balanced and global trial balance debit-credit = 0 |
| Allocations | allocated totals ≤ settled receipt and open invoice amounts; reversals unwind exactly |
| Integration | provider settlement total = locally verified receipts/fees/refunds + explicit outstanding items |

Each control account has a permitted posting-origin set. Empty domains do not count as tested reconciliation: until their posting services are implemented, UI reports “not implemented”, not “all reconciled”. Report reads original and reversal journals, not only unreversed records.
