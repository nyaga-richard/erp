# Moving weighted-average inventory: contract before implementation

Status: IN_PROGRESS. The initial arithmetic kernel is VERIFIED within its pure scope; **no inventory API, stock posting or balance-editing screen exists**. This document is not operational verification.

## Reuse, entities and authority

Reuse `products` and governed base units (017/016), `source_documents`, `inventory_movements`, the rebuildable `inventory_balances` projection, existing workflow/CommandService, reviewed posting-rule resolver/materializer and immutable journal engine. Do not introduce another ledger or tax calculator. Product purchase reference price is **not** authoritative valuation or an opening balance.

A stock pool is (company, warehouse, product), initially STOCK items in their governed base unit. Batch/serial/expiry, alternate units, FX, landed-cost allocation and reservations need separate contracts before activation. Pure valuation receives **trusted** normalized values from a future domain transaction, never HTTP authority.

## Arithmetic decisions

- Exact decimal strings only. Quantity and unit-cost domains are numeric(20,6); monetary value is numeric(20,2). Accept up to14 integer and6 fractional quantity digits, and18 integer and2 fractional money digits. Enforce configured unit precision0–6. Reject exponent notation, negative values, floats, empty/overprecision values and unknown keys.
- State contains nonnegative base quantity Q and functional-currency value V. Q=0 requires V=0. Positive zero-valued stock is mathematically valid, but this does **not** authorize a zero-value operational source.
- RECEIVE trusted positive q and nonnegative cent value v: Q′=Q+q, V′=V+v. v must eventually come from approved receipt/adjustment logic, not a supplied product cost or editable balance.
- ISSUE positive q≤Q: if q=Q, cost=V; otherwise cost=HALF_UP(V×q/Q,2). Compute directly from full exact state; **never multiply by a rounded six-place average**. Q′=Q−q, V′=V−cost. Quantity/value deltas are negative for an issue.
- Last depletion consumes every remaining cent. Earlier rounding remains visible in immutable movement values; no invisible corrective journal or orphan zero-quantity value is permitted.
- Six-place movement unit cost is abs(value delta)/q, rounded HALF_UP, for attribution/display. The authoritative monetary effect is the signed cent value, not unit cost×quantity. Derived average costs are informational only. Reject results outside current domain capacities, including unit cost; do not silently cap.
- Functional currency is explicit ISO uppercase code, scale2 only. No conversion and no hardcoded KES rate. Return a detached deeply frozen versioned input/output snapshot. Use a local Decimal constructor so global accounting rounding is unchanged.
- The first helper supports RECEIVE and ISSUE only. Returns, reversals and supplier returns must use retained original movement cost and cumulative limits, **not** an ISSUE at today's average. Transfers must conserve exact source value between both locked pools; cross-branch rules and in-transit ownership remain a separate workflow.

## Future transactional workflow (NOT_STARTED)

1. Attributed DRAFT source with stock lines, reason, warehouse, product and effective date; submission snapshots reviewed policy. No stock effects in DRAFT/PENDING_APPROVAL. Independent configured approval is required before posting. Retain creator/editor/approver/poster/reverser separately; system actions retain original human initiator.
2. Posting authenticates granular event authority and scope, checks source revision/state/period, governed product and live warehouse. Never trust supplied actors, balances, aggregate values, averages or posting accounts. Prices/costs require their own view/proposal/approval authorities; no role-name checks.
3. Serialize a deterministic sorted set of company/warehouse/product pool locks, including creation of absent projections; re-read source/stock/configuration under lock. Idempotency keys and movement uniqueness suppress duplicates. Forbid negative stock under concurrency. Reject dates earlier than the latest valued date until an explicit recalculation policy exists; same-day posting order is retained by projection version.
4. Domain service computes trusted receipt value or issue cost with this helper, resolves current approved symbolic mappings, materializes balanced lines through the existing engine, and persists the source snapshot, immutable movements, derived projection version, journal, attribution, audit and idempotency result **in one local transaction**. Any child/audit/journal failure rolls back everything.
5. No generic direct balance CRUD. Database guards must bind projection deltas to complete immutable movement sets and bind stock-control journal value to the same signed cent effect. Runtime grants remain absent until these guards/tests exist. A future all-zero financial effect requires a deliberate source contract: existing `inventory_movements.journal_id NOT NULL` must not be bypassed with a fake zero journal.
6. Reversals are new linked approved sources with original amounts, cumulative quantity/value bounds and independent traceability. Never mutate/delete posted stock or GL history. For unavailable returned/reversed stock, fail visibly rather than silently creating negative inventory.
7. Reconciliation recomputes balances from movements and matches valuation to stock-control GL, with visible discrepancies and drilldown. Operational stock, COGS and inventory reports are not released until that reconciliation passes.

Planned API and UI follow database/HTTP acceptance: source draft/submit/review/post/reverse endpoints; read-only stock search/movement drilldown; governed pickers, exact quantities and costs; no quantity-on-hand form. Endpoint names, initial event contracts and permissions must be finalized with the first source workflow rather than advertising nonexistent routes.

## Acceptance order

First pure tests: receipt/issue weighted average, full depletion, fractional-unit precision, large exact cents, zero-value state, overflow/negative-stock rejection, strict schemas, detached immutable replay and arithmetic matrices. Then isolated PostgreSQL/HTTP tests **before** migration018: permissions/tenant/branch, current reference/cost-policy checks, conflicting dates, projection creation and issue races, idempotency, exact native snapshots, source/movement/GL/audit coupling, forged SQL refusal, forced rollback and reconciliation. Only then implement a stock UI and real browser scenarios. Fresh backup plus isolated restore remain mandatory.


## Executed kernel evidence — 29 September 2026

Test-first missing-module RED preceded `apps/api/src/inventory-valuation.ts`. Twelve tests now pass, including3,000 full depletion states (46,500 issue steps), exact large cents, precision/capacity/negative-stock refusals, retained cent residual, no rounded-average multiplication, immutable replay and unchanged global Decimal settings. The first freeze test incorrectly expected sloppy-mode assignment to throw; corrected it to assert `Reflect.set` fails and the frozen value remains unchanged. Full backend suite:214 passing tests,73 top-level,42,442.863354ms. Evidence: `docs/testing/inventory-valuation-results.txt`, `docs/test-results.txt` and `docs/testing/red-evidence/inventory-valuation.txt`.

No PostgreSQL movement writes, stock API, UI, source authorization, idempotency/concurrency locks, original-cost returns, reconciliation or operational journal binding are supplied by this helper. Existing movement `journal_id NOT NULL` and the journal materializer's narrower per-line input capacity remain explicit integration gates. Next: finalize the first stock source contract and write isolated database/HTTP failures before any018 migration or operational endpoint.
