# Trusted posting-line materialization

Status: VERIFIED for the internal trusted-input component (10 tests in the 146-test backend run). Operational integration remains IN_PROGRESS. This is an internal accounting dependency, not a public posting endpoint or evidence that operational modules are finished.

The resolver selects an independently reviewed effective mapping. Materialization must then validate it against a trusted, versioned event contract and current account records fetched inside the same business transaction. It accepts only named exact-decimal totals computed by the domain service, never frontend-calculated totals or executable formulas.

Required boundaries:
- Exact event/contract version and complete symbolic leg set; mapping side/amount key must match the central contract.
- Account IDs must resolve uniquely to active, postable, same-company accounts. The account classification/control type must match a contract eligibility pair. Null account currency means the company currency; otherwise denomination must match.
- Only functional-currency posting is supported at this step. Foreign-currency conversion is not approximated or silently assumed.
- Money stays decimal strings, with the same 16-integer-digit/two-fractional-digit per-line capacity as the journal API. Reject negative, floating-point, exponent or overprecision values. Reject missing/extra amount keys.
- Omit zero legs, then reuse the existing balanced-journal validator. All-zero results are explicitly marked noFinancialEffect; the enclosing domain/source guards must authorize any zero-value operational posting. This helper does not provide that authorization.
- Do not net same-account legs silently. Preserve symbolic legs and exact debit/credit effects.
- Return a detached deeply frozen snapshot of the rule selection, registered contract, accounts, trusted normalized amounts and exact totals. Reversals will use posted snapshots, not reevaluate today's mapping.

Test first: correct controlled-account mapping, exact large cents, no binary numeric inputs, bad/missing/duplicate accounts, tenant/currency/active/postable/classification violations, altered leg semantics, unexpected totals, imbalance, explicit zero effects and immutable replayable snapshots. PostgreSQL publication, current-record locking, snapshot persistence, actor/RBAC enforcement and atomic inventory/tax/subledger posting remain separate mandatory integration work.

## Executed evidence and boundaries

Missing-module RED preceded implementation; evidence is in `../testing/red-evidence/posting-materializer-red.log`. The helper reuses journalDraft money/currency schemas and validateLines; shared deepFreeze is in immutable.ts. Mapping version17 with event contract1 is explicitly tested. No public endpoint, record-loading/locking, persisted source snapshot or business zero-effect authorization is supplied by this helper.
