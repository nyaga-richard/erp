# Stock adjustments and initial customer registration

Development workflows only. These are not the full inventory, sales or AR modules. Use explicitly DEMO fixtures, never a real commercial tenant for browser acceptance scripts. Do not edit stock/customer balances in the database.

## Sign in and permissions

Open the Karibu ERP live preview and sign in with your existing private development credentials. Sandbox sessions live only in tab memory; reload requires another sign-in. A successful password screen is not enough to claim the user's external Arena routing works; report the visible error/request reference if it still fails. Never share passwords or session tokens in screenshots.

The access administrator manages explicit grants, not role-name shortcuts. Stock needs inventory:view and inventory:cost:view, plus each required create/submit/approve/post/cancel/reverse authority. The ordinary access administrator does not automatically have stock costs or posting authority. Customer profiles require customers:view; proposal and independent decision require customers:propose and customers:approve separately. None implies generic finance access.

## Reviewed stock gain/loss

1. Register the governed product through **Control center → Products**. This workflow currently supports active, nontracked STOCK products in their governed base unit. Initial commercial purchase price is not receipt valuation.
2. Ensure an assigned active SELLABLE warehouse, open financial period and explicitly reviewed applicable stock posting rules exist. Mapping accounts are selected through configuration; do not infer account numbers from this guide. Unconfigured rules fail visibly rather than picking defaults.
3. Open **Control center → Stock adjustments → New stock adjustment**. Select product/warehouse using server search. Choose gain or loss, positive quantity, business date and an explanatory reason. A gain proposes a positive total functional-currency value with documented basis. A loss accepts quantity only; the server derives weighted-average value from the locked pool. Zero-cent stock postings are not supported.
4. Create the draft. It has no stock/GL effect. Open it and **Submit valuation** with a reason. Inspect retained before/movement/after quantity/value, pool version, rule mapping and approval policy. The rounded unit-cost reference is not the authoritative cent amount.
5. A different authorized person reviews. Where policy requires multiple steps or approvers, the retained quorum display shows progress; incomplete review is not approval. The creator cannot self-approve when independent review applies.
6. An authorized independent poster posts. The backend atomically commits the source, movement, valuation, projection, journal and audit. The detail displays the actual posted debit/credit account lines, including reversal sides, rather than asking the browser to calculate them.

Changed stock or mappings can invalidate a submitted snapshot. Do not keep retrying with invented costs. The creator must **Refresh valuation**, resubmit and obtain fresh review. Historical decisions remain; only the current revision confers authority. To change initial immutable quantity/value fields, cancel the unposted proposal and create a new attributed draft. Posted sources cannot be edited or cancelled.

## Full original-cost reversal

Open a posted gain/loss and choose **Propose full reversal** with date/reason. It is a separate numbered source requiring submission, independent review and posting. It reverses the full original stored quantity/value and original GL mapping, not today's weighted-average cost or a newly chosen opposite account. The original source and journal remain unchanged and linked. Current account eligibility, date order and nonnegative resulting stock/value still apply.

Only one active full reversal per original is allowed. No reversal chains, partial stock returns, transfers, stock counts or supplier/customer return workflow is released by this button. A cancelled unposted reversal request can be replaced; never delete it.

## Balances, reconciliation and drilldown

**Stock balances** is read-only, movement-derived and cost-gated. Search by SKU/name/warehouse. On narrow screens the table scrolls within its container; there is no balance input.

**Reconcile stock** checks assigned-branch movement totals versus projections and reviewed inventory-control GL totals from one database snapshot. PASS does not certify AR/AP/tax/payment or the full ERP. Exceptions are displayed rather than silently corrected. Rerun on demand after other users post; a prior result is not a permanent guarantee.

General ledger rows and stock audit source links open the stock detail—not the manual journal editor. Cost-restricted users receive an explicit denial/redacted audit snapshot, not a hidden field that can be recovered through another endpoint.

## Initial customer registration

1. Open **Control center → Customers → Propose customer**. Choose a unique uppercase customer number and name. These are master identifiers, not fiscal invoice numbers.
2. For REGISTERED customers, explicitly select an eligible same-company AR-control account. Enter proposed credit limit and calendar-day payment terms; **zero limit is not unlimited credit**. Optional contact/address/KRA PIN reference is profile data; PIN format validation is not KRA verification.
3. Optional governed tax classification is metadata only. It does not override invoice rules, entitlement, rates or required legal documents.
4. WALK_IN is an anonymous company-unique cash-sale classification: zero credit/terms, no AR binding or personal identity. No cash sale is created by registering it.
5. Submit with a reason. **Customer requests** shows the immutable pending proposal. Another authorized reviewer chooses approve or reject with a reason. Approval publishes the exact customer and AR binding atomically; rejection retains history without publishing.
6. **Customer catalog → View customer** shows exact credit-policy values and distinct proposer/reviewer attribution. There is no balance editor. Read-only customer roles can inspect profiles without proposal, review or generic finance controls; backend permissions also deny those calls.

This first release does not amend/deactivate customers, enforce credit exposure, create AR invoices, allocate receipts, generate statements or post sales. The profile and AR-account binding alone do not authorize any such financial effect. Those workflows remain in development and must reconcile before release.

## Verification and recovery

The backend regression includes native forgery/rollback/concurrency checks. Browser evidence and screenshots live in `docs/browser-stock-result.json`, `browser-stock-access-result.json`, `browser-customers-result.json` and `browser-customer-access-result.json`. Recovery evidence is in `docs/testing/stock018-restoration.json` and `customer-restoration.json`; actual isolated encrypted restores were run, not merely backup-file creation.

Use `node scripts/browser-regression.cjs --new` for a fresh development regression. If it pauses for the unchanged login throttle, wait until the recorded natural expiry and rerun without `--new` to resume. Never clear rate buckets, widen privileges, or modify current sources to force a passing receipt. The runner refuses to resume under a different application/migration fingerprint.


## Reviewed customer amendments (020)

Open Customers, choose a published customer, then **Amendment history**. Read-only users can inspect history but cannot propose or review. A profile proposer may change name/contact; credit limit, terms and hold require separate credit-policy proposal permission. The server independently enforces these grants. WALK_IN customers stay anonymous with zero credit/terms and no hold.

A proposal retains the exact current version and before-image. It does not change the master until another authorized reviewer approves it. Inspect retained before/after values and both reasons. Even a user holding both grants cannot review their own proposal. A credit-policy reviewer grant is additionally required for credit changes. Conflicting/stale proposals must be rejected and replaced against the new version, never silently merged. Duplicate commands replay safely.

Original number/type/currency/tax identity/account binding/registration attribution remain unchanged. Original registration and all amendment decisions remain available. No editable balance or financial entry is created. Credit-policy edits for customers with operational references currently fail closed; profile-only edits remain possible. This is policy administration, **not yet invoice credit enforcement**. Holds are visible metadata until the transactional credit writer is integrated; do not infer that an unreleased sales module enforces them.
