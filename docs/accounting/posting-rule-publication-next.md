# Posting-rule publication — database/API implementation plan

Status: **VERIFIED** for company/branch/warehouse configuration. Operational application remains **IN_PROGRESS**. Migration 014 is applied and must not be edited. Database/HTTP RED preceded backend implementation; missing-tab browser RED preceded the UI. Current evidence: 185 backend tests (16 configuration tests), 15 browser suites including proposal→independent approval→lookup→retirement and isolated rules-only access, optimized production-web build/smoke, and actual encrypted backup restoration. See `../user-guide/posting-rules.md` and `../testing/posting-rules-restoration.json`. The sections below retain the design contract implemented in this slice, not a claim that inventory events now post.

## Reuse and scope

Reuse `accounting_rule_sets`, `accounting_rule_legs`, `journal_entries.rule_snapshot`, existing account/organization tables, CommandService, configuration locks and immutable audit infrastructure. Manual journals remain explicit non-control entries. Rule configuration itself must never change a financial balance.

Initial centrally registered event contracts should cover the first inventory dependency: GOODS_RECEIVED, STOCK_LOSS and STOCK_GAIN. Register templates in reviewed migration-owned tables, not frontend constants or arbitrary administrator expressions. Mark them as configuration contracts, not released operational workflows. Do not expose receiving/adjustment posting merely because a mapping exists.

| Event | Symbolic leg | Side | Trusted amount key | Required account eligibility |
|---|---|---|---|---|
| GOODS_RECEIVED | INVENTORY | DEBIT | stockValue | Active postable ASSET / INVENTORY control |
| GOODS_RECEIVED | GRNI | CREDIT | stockValue | Active postable LIABILITY / GRNI control |
| STOCK_LOSS | LOSS | DEBIT | stockValue | Active postable EXPENSE / non-control |
| STOCK_LOSS | INVENTORY | CREDIT | stockValue | Active postable ASSET / INVENTORY control |
| STOCK_GAIN | INVENTORY | DEBIT | stockValue | Active postable ASSET / INVENTORY control |
| STOCK_GAIN | GAIN | CREDIT | stockValue | Active postable REVENUE or EXPENSE / non-control |

Account IDs/codes are company configuration, never constants in a domain module. `stockValue` will come from trusted receiving/valuation calculations, not a frontend total. Zero-value movement semantics require an explicit no-financial-effect contract in the inventory/source guards; do not invent a zero-sided journal or claim that the current source posting guard already supports it.

## Planned relational additions

- Migration-owned event contract/version and leg-contract tables: event, contract version, leg code, side, named amount key and eligible account classifications. Normalize eligible classification pairs rather than placing executable formulas in JSON. Runtime read-only. Record migration origin instead of inventing a human or authentication-service creator.
- `posting_rule_change_requests`: company/creator/time, kind CREATE or RETIRE, immutable reason/payload, PENDING/APPLIED/REJECTED, independent reviewer/time/reason, applied resource link. Tenant-composite FKs for every scope/reference. Generated intended new rule ID is an immutable reservation, not a counter or an already-existing FK target.
- `posting_rule_change_legs`: normalized immutable proposed leg/account pairs with company/request/account FKs and unique symbolic leg. CREATE proposals supply only legCode/accountId; side/amountKey come from the versioned registered contract. Require the complete exact leg set.
- Extend existing rule sets with registered contract version and publication-request linkage. Preserve their existing company/event/version uniqueness. Add any needed composite uniqueness for child contract FKs. Existing inactive owner-created test/domain placeholders must not be mistaken for reviewed active rules. Inspect existing fixtures before tightening NOT NULL/FK constraints; never erase rows to make a migration pass.
- `accounting_rule_retirements`: append-only reviewed effective-through records and per-rule retirement version. Each subsequent retirement may only shorten effective coverage, never edit a prior record or resurrect an old mapping. Store creator/reviewer/request linkage. Effective end is the minimum of the original valid_to and reviewed retirements.
- Normalized journal-rule application references will be required when domain posting is integrated, so retirement can check already-posted application dates without trusting caller JSON. Until then do not claim operational snapshot persistence is complete.

Published rule definitions/legs are immutable. Retirement changes effective selection by adding a separately reviewed record, not rewriting a historical mapping. A replacement is a new version with explicit non-overlapping dates. There is no hidden latest-version tie-breaker.

## CREATE publication

1. Require rules:propose; validate event contract, dates, selector shapes, active same-company scope entities and hierarchy relationships, complete legs and eligible accounts. Store immutable proposal/legs and exact audit under CommandService's exclusive company configuration lock. Pending requests produce no rule or journal.
2. Approval requires rules:approve and a different human from the proposer, even if one person holds both grants. Rejection also retains separate review attribution. Mandatory independent review is a safety minimum, not a claim that all future multi-stage configuration approval policies are finished.
3. Recheck current authorization, membership, scope hierarchy, accounts, event contract and possible equal-rank effective overlaps. Acquire the exclusive company lock before resource locks; avoid a second numbering/locking engine.
4. Allocate the next company/event version under that lock. CREATE has no mutable target version; uniqueness and conflict checks handle intervening publications. RETIRE must compare its captured retirement version.
5. Insert the immutable rule/legs retaining the proposal creator; reviewer and publication time remain separate. Link terminal request and exact deferred before/after audit. Any failure rolls back all changes and the command result.
6. Reject potential equal-priority/equal-specificity overlaps when all constrained dimensions are compatible and date intervals intersect. Conservative publication rejection is acceptable even if a currently higher-priority rule masks the conflict. Resolver ambiguity remains a defensive failure, not an ID/version fallback.

## RETIRE publication

Require a target active reviewed rule, expected current retirement version, inclusive effective-through date and reason. End must be within the rule's coverage, not earlier than its start or the current Nairobi date, and must not invalidate an already-posted application. A later retirement may only shorten the current end; extension requires a new rule version with explicit coverage. An already-posted original remains historical evidence even if reversed; conservative retirement refusal is preferable to silently changing its eligibility. Document this restriction visibly.

A finite higher-priority rule can expire and reveal a distinct lower-ranked fallback; this is explicit priority behavior. Retired versions must not silently resurrect. At effective lookup, apply retirement intervals before invoking the tested pure resolver; the snapshot must identify the applied retirement evidence as well as the immutable base definition.

## Database defense and audit

Runtime must not publish by supplying approved_by alone, insert unmatched legs, change a published definition, forge creator/reviewer, move scope/ownership or rewrite a terminal request. Deferred guards require the exact approved request and exact normalized leg set. Validate audit actor, request ID, before/null snapshot and after snapshots; include negative tests for forged prior snapshots, following the numbering 013 lesson. Role names and frontend actor IDs never confer authority. The trusted owner remains a migration/recovery boundary, not a runtime login.

Treat the existing `active` flag carefully: publication/retirement must not mutate old definitions just to hide overlaps. Selection must use reviewed retirement records and historical snapshots. Unreviewed/inactive legacy fixture rows cannot be selected or exposed as published rules.

## Planned API and UX

Grants: rules:view, rules:propose, rules:approve. Planned routes: GET `/admin/posting-rules`, `/contracts`, `/effective`, `/accounts`, `/scope-options`; GET/POST `/admin/posting-rule-changes`; POST `/admin/posting-rule-changes/:id/decide`. Use bounded server pagination/search and strict schemas. Dedicated eligible-account search is authorized by rules:view and reveals configuration, not ledger balances; it must not require or imply accounting:view.

Catalog/effective responses must distinguish no match, ambiguity, pending proposals, published versions and effective retirement. A rules-only observer must reach the Control center tab. Account/branch labels are presentation metadata; selection uses validated IDs. Frontend follows backend tests and must show maker/reviewer, immutable history, explicit effective dates, conflicts, read-only/empty/loading/error/success states, keyboard/focus, mobile and dark mode.

## Next test-first sequence

1. PostgreSQL/HTTP fixture with cleanup covering setup/bootstrap failures; initial missing-route red evidence.
2. Proposal inertness, strict input, complete leg contracts, tenant/hierarchy/account policy checks, grants/CSRF and independent review.
3. Idempotent concurrent decisions, version allocation, compatible-overlap races, exact before/after audit corruption and direct runtime tampering.
4. Effective query versus the pure resolver, explicit prospective retirement, stale retirement decisions, rollback and no silent fallback/resurrection.
5. Trusted exact-decimal line materialization and frozen snapshots, then actual runtime-role source/journal/domain integration with intentional rollback. Do not substitute owner-only SQL or manual journal coincidence for evidence that automatic posting rules are enforced.
6. API docs, frontend, E2E, visual inspection and status update. Keep the overall Accounting rules requirement IN_PROGRESS while operational application persistence and financial integration remain incomplete.

Use a draft migration location outside the live root migration manifest while the SQL is under development, or clearly account for readiness becoming false when a root migration is pending. Move/apply the numbered migration only after tests and an encrypted pre-migration backup. Never alter applied 001–013 checksums.

## Publication overlap predicate (29 September dependency)

Before database publication, add a pure `postingRuleScopesConflict` predicate using the resolver's same selector/date/priority schemas. Inputs are applicability scopes only, not approvals or account bindings; the caller must load approved published candidates and apply reviewed retirement ends under the configuration lock. A conflict exists when company/event match, priority and specificity tie, inclusive intervals intersect, and no dimension has contradictory non-null selectors. Different contract/mapping versions do not resolve a tie. Cross-dimension hierarchy contradictions are deliberately not used to waive conflicts: conservative rejection remains safe when masters later change. Test every dimension, inclusive/open dates, invalid inputs and exhaustive finite contexts against resolver behavior. This predicate does not implement database locking, authorization, publication or retirement.

### Migration-owned registry sealing

The staged 014 registry uses normalized contracts, symbolic legs and eligibility pairs. Each definition is inserted unsealed, populated and sealed in one owner migration transaction. A deferred guard requires 2–100 legs, both debit/credit sides and 1–20 eligibility pairs per leg. Headers cannot change except the one-way seal; legs/eligibility cannot be updated/deleted or appended after sealing. Runtime has SELECT only (no insert/update/delete/truncate); migration principal/time are recorded from the actual PostgreSQL role/transaction, not a fabricated human. Workflow status remains CONFIGURATION_ONLY. Draft SQL is exercised only in disposable database tests until publication guards are complete and 014 is promoted through a pre-migration backup. The live 001–013 manifest/schema remains unchanged meanwhile.

## First released configuration surface

Implement company-wide, branch and warehouse scopes first; product/category/tax/payment selectors remain internal resolver capabilities, not accepted proposal fields until their masters are released. Warehouse proposals require a matching active branch. Configuration permission is company-wide (as with numbering), not a grant to view/post branch transactions. Supported currency is the company functional currency; current account eligibility is rechecked at approval. There is no balance/stock/tax effect from configuration.

Release CREATE and prospective RETIRE through immutable normalized requests, independently reviewed decisions, exact SQL-native audit snapshots and shared company configuration locking. Preserve immutable base rules, append retirement versions, reject overlapping equal ranks and stale retirement requests. A normalized journal-application reference table remains runtime read-only until operational posting is implemented; retirement checks any retained application dates. No receiving or stock adjustment endpoint is enabled by configuration. Frontend includes contract/account/scope search, pending review, applied history, effective lookup, rejection/retirement, read-only access, keyboard dialogs and responsive states. Other four selector dimensions remain visibly unavailable rather than pretending to be supported.
