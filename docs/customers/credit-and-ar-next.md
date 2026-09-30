# Customer credit and AR continuation — design before operational code

Status: IN_PROGRESS. Pure eligibility/calendar component now VERIFIED in isolation; transactional credit/AR integration remains design-only. Initial customer registration019 is a dependency, not an AR engine. Never edit001–019. No credit-sale, invoice, receipt, allocation or balance-write endpoint is authorized by this document. All APIs below are planned, not released.

## Reuse, not a parallel ledger

Use existing customers/customer_accounts, customer_transactions, source_documents, journal_entries/lines, payments/payment_allocations and the central CommandService, workflow, allocator, rule resolver/materializer, tax calculator and inventory valuation writer. customer_transactions already links a source, customer, control account and a unique journal line; strengthen that native linkage rather than inventing a mutable customer balance table. Current ledger scale remains two decimals and functional-currency-only posting; an operational FX contract must precede foreign-currency receipts or allocations.

Split implementation into individually evidenced stages:
1. Reviewed versioned customer metadata/credit-policy lifecycle, with current account eligibility and explicit credit-hold/limit/terms history. Never retrofit changes into historical invoice snapshots.
2. Exact credit eligibility/aging/allocation arithmetic components with immutable replayable outputs, independently tested; these alone authorize no posting.
3. Transactional credit commitments and a source-integrated AR posting writer, with native source/customer/control/journal/tax/stock/audit coupling. First actual source must define a legally coherent invoice/credit-note workflow; do not seed AR with synthetic manual journals.
4. Unified verified payment posting and immutable allocations/reversals. Only after these sources exist release statements, aging and operational AR reconciliation with meaningful nonempty scenarios.

## Credit policy and exposure

Company/customer is the credit-policy scope, not the cashier's currently selected branch. Source branch scope still governs who can transact. Authorized exposure reads cannot silently omit other branches and then approve a company-wide limit. An operator sees only the exposure information permitted for credit decisions; public customer profile reads do not imply unrestricted statements or financial reports.

Zero credit limit means zero authorized credit exposure. A hold denies new credit even when the numeric limit has headroom. WALK_IN cannot receive a credit commitment or AR-control binding. Current inactive customers/accounts fail closed. Existing debt does not disappear when a limit is reduced below exposure; the policy change must expose that fact and prohibit further credit until compliant. Policy changes remain reviewed and attributable.

Define exposure from posted unsettled debit obligations plus active source-backed credit commitments. Settlement is recognized only through posted, correctly matched payments/credit notes and immutable allocations. Do not subtract unverified callbacks, pending STK requests, drafts, voided tenders, unrelated customer/currency credits or unallocated deposits from debt. A customer deposit is a distinct liability until the approved allocation/posting contract applies it. This avoids treating an arbitrary negative ledger total as unlimited spending capacity.

An informational preview is never posting authority. At final source commit, lock the customer credit scope and re-read current policy, authoritative unsettled debt and active commitments. Replacing a commitment with its invoice must release that exact commitment atomically, not double-count it or release another source's reservation. Concurrent credit requests may not each approve against the same stale headroom. Credit limits, holds, commitments, invoice posting and settlement/allocations affecting available credit must use the same lock discipline. Introduce no reservation write path before its lifecycle/expiry/cancel/reverse rules and native guards are complete.

Exact decimal-string inputs/outputs only. Reject NaN/infinity, signs/exponents, excess precision/capacity and negative obligations. No client debt, balance, exposure, account, actor, rate or override flag is trusted. Any future exception/over-limit authority is a separately reviewed source with explicit bounded authorization and expiry, never a role-name bypass or checkbox.

## Source and accounting boundaries

The eventual sales invoice freezes customer identity, current credit-policy revision, terms and due date, exact price/tax/FX snapshots, valuation and reviewed posting mapping. AR posting is the actual credit-funded receivable portion, not the total of a cash/mixed sale by assumption. Cash/card/M-Pesa tenders follow the unified verified-payment contract. Revenue/output tax and stock/COGS must post in the same local business transaction where applicable. No source can leave AR without its GL line, or GL without the corresponding subledger/stock/tax effects.

A due date is business-date calendar arithmetic using the retained terms, not the browser timezone or mutable current terms. Changing a customer profile does not recalculate old due dates. Aged balances use a declared as-of business date and immutable posting/settlement cut-off. Future-dated allocations must not reduce past aging. Credits/deposits are displayed separately where they cannot be attributed to an invoice; never silently spread them across arbitrary debt to improve aging.

Native guards must verify customer/source/company/currency/control/journal-line identity, signed exact base/transaction amounts, current authorization and original human initiator. Posted subledger rows and allocations are append-only. Aggregate AR by company/branch/control account must reconcile to the GL from one consistent snapshot. Missing journal/subledger effects, wrong customer/account/currency and over-allocation must appear as discrepancies, never auto-repair.

## Allocation and reversal

Allocation requires verified posted funding and eligible outstanding invoices for the same customer/company/currency under the explicit policy. Lock funding and targets in deterministic order. Sum of active allocations must not exceed either available funding or outstanding obligation. Partial settlement keeps residual cents exactly; final settlement consumes the exact remainder. Duplicate IDs/callbacks/idempotency keys cannot allocate twice. Receipt reversal must explicitly unwind linked allocations before or atomically with financial reversal; retain original funding/invoice/allocation identities. Reversals negate original stored amounts/FX/tax where applicable, not current rates or today's cost.

No delete or mutable paid-amount field. Distinguish cancelled pending requests from reversal of posted receipts/allocations. A refund is not a reversal of an unrelated customer debt and cannot be posted merely because a mobile-provider request was accepted.

## Planned security and UI

Separate customers:credit:view/manage/approve, ar:view, source-specific proposal/review/post/reverse permissions and payment/allocation authorities. Names are tentative until the migration registers them; no existing role receives implied authority. Backend checks and native guards are mandatory. Customer-profile and generic audit readers must not gain financial or contact access through another projection.

After backend/native green: visible policy version and hold, authoritative credit preview with freshness warning, invoice/payment allocation forms, explicit confirmation/reason, residual/overdue display, statement/aging export and source/journal/stock/tax/audit drilldown. Server pagination/search; keyboard/mobile/dark and least-privilege routes. No editable opening/current balance.

## Acceptance gates

- Credit arithmetic boundaries, zero-limit/hold/walk-in semantics, exact capacities and immutable replay; randomized conservation checks.
- Parallel credit requests, policy change versus posting, duplicate commitment conversion, payment versus allocation/reversal races and shared deterministic lock order.
- Deliberately fail after every AR/GL/stock/tax/allocation write: no partial business effect, retry succeeds with the same key after repair.
- Native forged customer/account/amount/journal/audit/subledger/commitment/settlement refusal, including mutations after BEFORE guards.
- Cross-company/branch and current permission revocation; anonymous/CSRF/forged actor/price/exposure denial; retained original maker/reviewer/poster/reverser.
- Full cash/credit/mixed sale, partial/full settlement, advance/deposit allocation, original-linked credit note, reversal/refund and date-cutoff statement/aging scenarios. Nonempty GL/subledger reconciliation and deliberately injected visible discrepancy.
- Browser operational workflow/access/concurrency evidence, actual encrypted restoration and current schema/OpenAPI/requirements/docs before a bounded VERIFIED claim. Parent AR remains IN_PROGRESS until the complete workflow is demonstrated.

## First isolated component evidence

`apps/api/src/customer-credit.ts` reuses the shared immutable-snapshot helper and an isolated64-digit Decimal context. Strict inputs, positive requested credit portion, nonnegative debt/commitments, bounded exact replacement, zero-limit/hold/inactive/walk-in denial, numeric capacity refusal and calendar due-date boundaries. No rounding or Number conversion of money; no actor/override fields. The caller must still derive authoritative values under locks and prove replacement ownership; the helper cannot do that.

Ten tests pass, including3,465 cent combinations, a cent over the limit, existing excess, large values, Decimal-global isolation and immutable replay. Genuine missing-module RED retained. Full backend250 pass, zero failures; API compiles. The module is unreferenced by controllers/services and performs no database write. This is not a released credit-check endpoint or operational credit-sale protection.
