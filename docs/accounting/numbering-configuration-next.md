# Controlled document-numbering configuration

**Implemented for the released local document types; not an operational ERP or fiscal-adapter completion claim.** This contract was written before implementation and is now updated with actual behavior/evidence. The central allocator and CommandService are reused; there is no second counter engine.

## Workflow, entities and states

Control center → **Numbering**. Choose an active company branch, released document type and calendar year; propose a prefix, minimum counter padding, current expected version and reason. Pending proposals make no effective change. A different authorized human applies or rejects with a reason. PENDING → APPLIED/REJECTED is terminal. A subsequent correction requires another immutable proposal and a new version.

`document_numbering_policies` stores the current approved override and original creator, current version, updater and last request. `numbering_change_requests` preserves every proposal/review and the generated target ID. Composite tenant FKs, RLS, approved-request matching, optimistic versions and deferred exact before/after audit checks reinforce backend controls. No journal, stock, tax or account balance is changed by configuration.

Registry defaults are the fallback; branch/type/year overrides take precedence. New sequences copy that resolved format; established sequences retain their original format. A key becomes permanently format-locked when its sequence is initialized, including cancellation of the resulting draft. No user endpoint sets, decreases, restarts, wraps, deletes or reserves a counter. An initialized legacy zero counter is also conservatively locked. Minimum padding does not truncate larger bigint values.

The source number is fixed at initial allocation. Controlled edits of an unposted source do not renumber it; its revision history retains earlier dates/content. Calendar-year numbering is not an arbitrary fiscal-year format grammar. External fiscal/eTIMS identifiers and operational document registrations remain separate unreleased scopes.

## Authority and concurrency

- `numbering:view`: effective format, catalog, type registry, branch options and request history.
- `numbering:propose`: create a proposal, never apply it.
- `numbering:approve`: independently apply/reject; having both grants still cannot permit self-review.

These are explicit company-configuration grants, not role-name checks or implicit financial posting rights. The browser never supplies a creator/reviewer ID. Writes require CSRF, idempotency and current session/membership/grants. Company/branch/date/type/version are rechecked at approval. Configuration uses the existing exclusive company lock; allocation uses its shared counterpart. Prefix conflicts are checked against other effective types, established sequences and fallbacks within the same branch/year; uniqueness constraints back the checks.

A proposal does not reserve a prefix. Competing publications can make it stale or conflicting. A publication racing first issuance either takes effect before issuance, or fails because the sequence has initialized; it cannot rename the issued number. Direct runtime SQL cannot bypass matching approval, immutable fields or exact atomic audit. Unknown historical allocation actor/time remain NULL; new allocation metadata always records the actual transaction actor/time.

## API

- GET `/api/v1/admin/numbering-policies`: paginated overrides and used/locked status.
- GET `/api/v1/admin/numbering-policies/effective`: branchId, documentType and year; resolved prefix/padding/version, inherited flag, lock and branch.
- GET `/api/v1/admin/numbering-policies/types`: released registry types.
- GET `/api/v1/admin/numbering-policies/branches`: server-searched/paginated active branches.
- GET/POST `/api/v1/admin/numbering-policy-changes`: paginated history or strict proposal.
- POST `/api/v1/admin/numbering-policy-changes/:id/decide`: APPROVE/REJECT plus reason.

The UI has paginated search, current-format loading/error feedback, typed fields, maker/reviewer attribution in Africa/Nairobi, independent review confirmation, stale-version display, immutable decision history, keyboard branch selection, focus containment/Escape and read-only/dark/mobile states. It reuses the existing uncertain-request idempotency retry mechanism.

## Executed verification

`apps/api/test/numbering-configuration.test.ts` exercises authentication, grants/CSRF/company isolation, forged actor refusal, inert idempotent proposals, dual-grant self-review refusal, concurrent identical approval, version/stale rejection, prefix races, actual numbered draft→independent approval→balanced posting, publication versus first issuance, runtime SQL bypass refusal, forced apply rollback/retry and deliberately corrupted request/policy prior audit snapshots. Corrupted prior snapshots initially passed; migration 013 closes that gap and the tests now reject and roll back them.

The full backend suite currently has **110 passing tests**. `docs/browser-numbering-result.json` records **14 Chromium workflow checks**, including actual numbering and subsequent source cancellation without number reuse, independent revision/rejection, read-only/locked views, Escape, dark mode and 390px layout. Migration 012 implements configuration and the shared resolver; 013 strengthens prior-snapshot audit proof. Full existing regression/build/recovery artifacts should be refreshed with each later release.

Next dependency: central posting-rule configuration, followed by effective tax configuration and operational accounting/inventory/subledger integration. The tax calculation kernel alone does not authorize a rate or create a tax ledger.

## Regression refresh

After migration 013, all nine browser suites passed in one sequential run (ending 2026-09-26T12:57:58Z). The numbering proof is NB27455100R-2029-00000001; its cancelled source retains its number and lock. Additional test-first regressions verify detail navigation during refresh and a numbering-only observer without finance grants. The current backend suite is 122 tests after adding 12 pure posting-rule selection tests. Optimized production-web smoke passed after both frontend fixes; this does not verify a production backend or Docker deployment.

Latest full regression refresh: all nine browser suites and optimized production-web smoke passed after the subsequent bootstrap/notification corrections; see per-suite result timestamps. Current numbering proof: NB29039616R-2032-00000001. Current backend: 123 tests. The numbering browser now includes the no-prior-user-notification assertion (15 checks).
