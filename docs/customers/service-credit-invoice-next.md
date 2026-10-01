# First AR source: reviewed service credit invoice — contract and implementation checkpoint

Status: IN_PROGRESS (inert draft create/read and typed immutable valuation submission into PENDING_APPROVAL implemented; review/post/reversal, serialized exposure authorization, AR posting and tax register remain unreleased). Preserve applied001–023; migrations024–025 are authored but not runtime-applied or verified. The first AR source must represent an actual business event, not an invented opening balance or an unlocked credit-check endpoint.

## Why this source is next

Customer masters, explicit AR bindings, versioned reviewed credit policy, exact credit/date arithmetic and the central tax/rule/journal engines now exist. A bounded single SERVICE-product credit invoice provides a coherent first receivable/revenue/tax transaction without pretending stock was sold. Restrict to governed active SERVICE products; no STOCK or NON_STOCK ambiguity, inventory movement, COGS, cashier session or payment tender. Sales of goods and mixed/cash payments remain later integrated contracts. Reuse source_documents, existing sales/sale_lines where their semantics fit, customer_transactions, tax_transactions and journal lines. Do not create another AR or tax balance table.

## Source workflow and authority

Creator proposes assigned branch, eligible customer, SERVICE product/base-unit quantity, business date and reason. The server resolves base currency, reviewed AR binding, current customer policy/version, commercial price/profile and effective tax schedules. No account, actor, exchange rate, unit price, tax factor, debt/exposure, paid amount or override flag is accepted from the frontend in this bounded source. Discount/price override requires a separate reviewed policy and is not silently enabled.

DRAFT → submitted immutable valuation/tax and customer-policy snapshot → policy-driven independent review → APPROVED → POSTED. The current submit route freezes a typed valuation and approval-policy snapshot only; it creates no exposure reservation and does not prove available credit headroom. Follow the existing CommandService, workflow snapshots/quorum, allocator and prepared journal writer. Stale product price/tax/rule/customer policy/credit exposure requires refresh and reapproval; never silently post a different reviewed total. Posting must re-read authoritative eligibility and credit under locks even if an informational preview was recently approved. A rejected/cancelled pending source has no financial effect.

Due date is business date plus retained calendar-day terms using customerDueDate; immutable invoice customer identity, terms and policy revision persist across later profile changes. Zero limit, hold, inactive or WALK_IN customers fail credit eligibility. No fiscal compliance is inferred from account posting or a syntactically valid KRA PIN.

## Exact amounts and accounting

Use the existing exact tax calculator with server-resolved effective product tax profile and governed schedules; freeze its reproducible complete output. Functional-currency-only invoice; no foreign-currency FX fiction. Positive gross only; zero-cent source posting and compounded taxes remain unsupported until separately defined. Quantity respects governed base-unit precision; pure-service invoices have no stock movement/COGS and must explicitly assert that absence.

Introduce a sealed posting event contract through a new migration. Proposed symbolic legs: AR debit for gross; revenue credit for net; output-tax control credits for exact classified tax components. Zero components must not create fake zero journal lines. Tax-exempt/zero-rated/non-taxable remain distinct immutable classifications, not a hardcoded 0% shortcut. Extend/reuse the materializer only with test-first evidence if its current contract cannot express optional/multiple tax legs; do not bypass it with unchecked client lines.

The rule-selected AR account must match the customer's independently reviewed binding. No fallback to a hardcoded account number or arbitrary customer-specific override. Until customer-selector rules are released, incompatible branch/company mappings fail visibly. Tax control mappings must match the authoritative tax definition/profile and current account eligibility. Actual journal lines, customer subledger and tax ledger must carry the same source/company/branch/currency and exact signed amounts. Native constraints independently validate these links and reject balanced-but-wrong journals.

## Credit exposure and locking

Lock the company configuration scope using the common coordinator, then the source and company/customer credit scope in a documented consistent order. Every future writer that changes credit availability must participate. Financial periods and account eligibility are checked in the same transaction. No source is authorized merely by creator approval or frontend-calculated headroom.

For the first bounded invoice/full-reversal source set, derive debt from the actual released invoice/reversal customer subledger and assert that no unknown customer financial source or active commitment is omitted. Commitments, arbitrary payments/credits and order conversion are not released yet. Do not treat the absence of a new reservations table as proof of zero exposure if older/unreleased operational references exist. Fail closed for those dependencies.

Use evaluateCustomerCredit only after authoritative amounts/policy are resolved and locked. Its output is an arithmetic snapshot, not authorization. Compare reviewed credit state against current source-compatible debt; two simultaneous invoices cannot both spend the same headroom. Posting creates the receivable, so it may not also leave a duplicate commitment. If reservations are introduced before this source, their source/expiry/cancellation/conversion/native guards and reconciliation must be completed first.

020 conservatively blocks credit-policy edits for operationally referenced customers. A later migration may replace that blanket refusal only with explicit current-exposure-aware amendment rules under the same locks. Lowering a limit below debt or placing a hold must never erase debt; new credit must remain blocked. This change requires its own native race/rollback tests and visible warnings.

## Atomic effects and reversal

One local transaction commits approved source state, invoice header/line/customer/tax/credit snapshots, exact balanced journal, one linked customer transaction per AR line, exact tax transactions per component, posting-rule application, attributable event/audit and idempotency result. Deliberate failure at each stage rolls everything back. No mutable customer balance, paid flag or backdoor manual AR journal.

Before calling this invoice lifecycle verified, implement a linked full original-value reversal using the original stored net/tax/gross, original AR/revenue/tax lines and original customer/tax identities. No current-price/current-rate recalculation. One active reversal per original; no chains. Check current eligibility and periods. When allocations/payments later exist, the original reversal must not strand them; block until the original-linked allocation/refund contract can unwind them atomically. A reversal is not a generic customer credit unrelated to an invoice.

## Fiscal/external boundary

An internal accounted invoice is not evidence of eTIMS acceptance. Keep fiscal state separate and explicit (unconfigured/pending/accepted/rejected where implemented). No fake eTIMS identifier, receipt, callback or successful provider response. Activation requires the current contracted provider specification, credentials and accountant approval. Development source fixtures must remain visibly DEMO/non-fiscal. If legal fiscal issuance timing requires blocking a production action, implement that gate rather than silently printing a compliant-looking invoice. External calls stay outside the local DB transaction with an attributable idempotent outbox/adapter; do not fabricate production success.

## Read UI and reconciliation after backend green

Separate AR/source permissions, financial visibility and customer-profile access; PII and credit snapshots must not leak through generic audit or legacy manual-document routes. Bounded server pickers/search/pagination, immutable detailed snapshots, separate maker/reviewer/poster/reverser, actual AR/GL/tax drilldown, errors/loading/empty/confirmation and keyboard/mobile/dark.

Single-snapshot AR control versus customer subledger reconciliation with visible missing/mismatched source/customer/amount links; separate tax-control/ledger reconciliation and whole-journal arithmetic. Existing inventory reconciliation must remain unchanged and still pass. A non-stock source must assert no inventory effects, not ignore the inventory ledger. Statements/aging and payments are not verified merely because a first invoice posts.

## Acceptance before migration activation/UI

- Inert draft create/read and submit routes: strict actor/price/account/rate/exposure/paid-field rejection; exact immutable typed valuation and tax snapshot; native current-master, arithmetic, policy, idempotency, event/audit, CSRF/company/branch checks. Full lifecycle acceptance must prove independent review and posting authority.
- SERVICE-only governed product, quantity/date/period/profile gaps, exact price/tax/currency capacities and no inventory effects.
- Locking: two simultaneous invoices near limit; invoice versus policy/hold/rule/period changes; stale snapshots/reapproval; idempotent concurrent posting and mismatch refusal.
- Native forged subledger/customer/control/journal/tax/snapshot/audit, including post-BEFORE-trigger mutation, rollback and same-key retry.
- Original-cost/value full invoice reversal, duplicate/reversal-chain refusal and original identity retained after later master changes.
- Meaningful nonempty AR/GL/tax reconciliation and injected discrepancies, no hidden adjustment. Actual encrypted restoration of all source/subledger/tax/journal/audit/reversal chains.
- Independent operational browser/access/mobile workflow, full regressions/build/docs; no parent AR/POS/tax or production completion claim until their remaining flows and full reconciled scenario pass.


## Repository inspection and concrete integration choices (30 September)

- `AccountingService.postPrepared` remains the existing sole prepared journal writer (period locking, numbering, balanced lines, posting, linked reversals and outbox). Establish native domain authority before invoking it. No manual control-account bypass.
- `TaxConfigurationService.calculateConfigured(c, ctx, body)` resolves governed effective schedules in the caller transaction. `ProductConfigurationService.resolveServiceInvoiceProduct(c, ctx, productId, {date,quantity})` now resolves an active published SERVICE product, base-unit precision, dated immutable price/profile, and configured tax calculation under the shared company configuration lock in the caller transaction. The standalone preview delegates to the same resolver while preserving its response shape. Focused tests cover server-owned inputs, SERVICE-only rejection, quantity precision, and preview compatibility. Invoice input still accepts neither tax IDs/factors nor preview output.
- `materializePostingLines` already omits zero-valued legs after validating complete mappings and amount keys; no new optional-leg engine is needed. The first source can use one sealed AR/revenue/output-tax three-leg contract. All effective rate output accounts must match its output-tax leg. Different output accounts fail explicitly until a multi-control contract is designed. Exempt/non-taxable sources still validate the complete configured mapping but create no zero tax journal line.
- Reuse sales/sale_lines: CREDIT, no terminal/cashier/order, SERVICE product, zero COGS; assigned active sellable warehouse is branch/configuration scope only, not a stock movement. Derive totals/due date; normalized immutable revision snapshots, not editable JSON posting authority.
- Reuse customer_transactions with its unique journal-line link; tighten native customer/source/account/amount completeness and immutability, not a parallel ledger.
- tax_transactions currently requires rate_id/rate_snapshot/account_id. Rated/zero-rated components have actual reviewed references; zero tax has no fake journal line. Exempt/non-taxable classification/base must remain in source snapshots and reports; never invent a zero-rate ID. Decide/test a normalized base register or constrained nullable fields before claiming the complete register. This schema decision remains open.
- Shared company lock77 already serializes commands against exclusive master changes. Add documented customer credit locking before deriving debt. Unknown operational references fail closed; explicitly distinguish inert drafts from commitments and do not double-count the current invoice.

Acceptance API target `/customer-invoices`, `/:id/submit|approve|reject|post|refresh|cancel`, `/:id/reversal-drafts`; implemented source routes are branch-scoped `GET /customer-invoices`, `GET /customer-invoices/:id`, strict inert-draft `POST /customer-invoices`, and `POST /customer-invoices/:id/submit` to freeze an immutable typed valuation and approval policy snapshot. Migrations024–025 register the source contract and typed snapshot/native guards. Credit-limit/hold/terms fields in detail require the separate `customer-invoices:credit:view` permission; generic audit remains free of the customer snapshot. Approval/rejection/post/reversal/reconciliation routes are not implemented. Submit does not check/hold credit headroom. Fixtures use synthetic prices/taxes, not statutory defaults.
