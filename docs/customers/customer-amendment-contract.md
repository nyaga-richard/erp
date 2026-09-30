# Reviewed customer profile and credit-policy amendments (020)

Status: VERIFIED for this bounded metadata amendment workflow, 30 September 2026. Design preceded implementation; applied001–020 are immutable. This increment changes reviewed master metadata, not AR balances, transactions or credit-sale authority.

## Bounded workflow

An authorized proposer opens a governed customer, reads its current integer version, and proposes the complete replacement editable profile: name, optional phone/email/address, credit limit, terms days and credit hold. PENDING → APPLIED/REJECTED by a different authorized reviewer. No direct PATCH of the master. Pending proposals are inert; applied/rejected requests and their exact before/after snapshots are immutable. Multiple proposals against one version are allowed; only the first approved one can apply. Stale proposals may be rejected, not rebased invisibly. To change them, create a new reviewed proposal.

Number, company, customer type, currency, tax PIN/category, active state, original publication/maker/reviewer and AR-control binding remain unchanged. WALK_IN retains zero limit/terms, no hold and no personal contact data. No account remapping, deactivation, financial FX or tax identity amendment is enabled. Zero credit limit means no credit. A hold or lower limit does not erase debt; operational credit enforcement is unreleased. Until AR source/commitment integration exists, credit-policy amendment fails closed if any customer_transactions or sales/order/return/payment operational reference exists; do not claim an empty-ledger sum is a complete exposure check. Profile-only edits can retain existing account metadata but never alter original financial snapshots.

## Authorization, locks, attribution

Read/history requires customers:view. Propose/review requires separate customers:amend:propose/approve. Any changed limit, terms or hold additionally requires customers:credit:propose/approve at both proposal and decision time. No role-name authority; current session/membership/permissions checked inside CommandService. Independent reviewer mandatory even with both grants. The API rejects actor, balance, account, tax, currency, active and arbitrary fields. Original creator and original publisher remain unchanged; amendment creator/reviewer are retained separately in the normalized request and audit. Native guards recheck live grants and reason.

Reuse exclusive company configuration lock77 and row locks, serializing policy changes against current configuration and concurrent approvals. Future transactional credit sources must share the documented company/customer locking discipline before activation. No unlocked exposure preview becomes posting authority.

## Schema/integrity

Add customer_amendment_requests with tenant/customer link, expected_version, proposed editable fields, exact SQL-captured before_snapshot, state, original proposer/time/reason and independent reviewer/time/reason. Partial unique index on applied(customer,expected_version) and version+1 update prevent two approvals at one version. Keep existing customers version, relax only its version upper bound through020. Keep original row structure and initial identity; record latest amendment attribution through history, not overwriting original approved_by.

The existing initial-registration guards remain for INSERT; UPDATE of governed customers requires the exact matching APPLIED amendment in the same transaction. All noneditable fields compare unchanged; native expected after snapshot is derived from the immutable before snapshot plus proposed fields/version. BEFORE and deferred final-row guards reject unaudited updates, forged requests and post-BEFORE-trigger sabotage. Customer-account bindings remain immutable. Deferred request/row guards verify exact final master and audit; any later failure rolls back request decision, customer update, audit and idempotency result together.

Freeze initial publication semantics: customer_publication_snapshot continues to return the original published snapshot after amendments, using the first applied amendment's immutable preimage. Historical registration audit must not be rewritten or compared to mutable latest metadata. Current snapshot is a separate function. Restoration tests independently compare original registration, amendment chain, current version and retained exact audits.

## Implemented API/UI

GET /customers/{id}/amendments: paginated company-scoped history with exact proposed/preimage monetary strings, actor display names and review reasons. POST /customers/{id}/amendments: strict expectedVersion and full editable replacement plus reason; server captures current preimage. POST /customers/amendments/{id}/decide: independent APPROVE/REJECT and reason; no proposed amounts accepted at decision.

After native/API green, customer detail offers Propose amendment and Amendment history. Explicit version, before/after comparisons and credit-change warning; disabled current-policy edits when credit authority absent, no balance input. Retained actor identities and exact decimals; confirmation, errors/loading/empty/success, keyboard/mobile/dark. Reuse existing request/idempotency adapter and dialog behavior.

## Acceptance

Real missing-route RED, then DB/HTTP tests for strict fields, current scoped permissions, both-grants maker denial, inert proposal, exact large decimals, no-op refusal, idempotency and changed-payload conflict, concurrent version race, stale rejection, credit grant revocation, operational dependency refusal, snapshot/audit/master sabotage rollback and same-key retry, original publication preservation and no financial/stock effects. Browser independent workflow plus restricted profile/credit controls; full regressions and actual020 encrypted isolated restore before bounded verification. Never edit an applied migration.


## Executed evidence

261 backend tests pass (amendment suite11 including parent): granular current permissions, CSRF/scope/strict fields, optimistic races, independent review, retained exact original/audit, unsupported operational references, WALK_IN anonymity/zero-credit and deliberate late request/master/audit sabotage with rollback/retry. Genuine API and browser RED retained. All23 browser suites pass on frozen020 baseline2026-09-30T06:04:06.478Z; read-only/profile-only/workflow plus loaded mobile-dark screenshot inspected. Optimized web build/typecheck/presentation/production-web smoke and generic recovery tests pass. Actual encrypted020 restore2026-09-30T06:05:07.619Z verifies original publication, contiguous applied chain, current policy/version and exact original proposal plus approve/reject audit, with zero checked discrepancies. Evidence: `../test-results.txt`, `../testing/browser-regression.json`, `../testing/customer-amendment-restoration.json`, `../deployment/customer-amendment-build-results.txt`. No AR or production completion claim.
