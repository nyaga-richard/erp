# Controlled tax configuration — next dependency

Status: IN_PROGRESS overall. The initial finite-schedule configuration slice is VERIFIED through database/API/UI, independent review, exact audit, ID-based calculation and isolated restoration. Migration015 is applied; never edit it. Current backend185 passes, including14 tax DB/HTTP tests. New browser-tax and minimal tax-only access suites pass alongside all11 prior browser suites. **Retirement/amendment, product assignment, tax transaction registers and operational posting remain unfinished.**

Implementation decision: retain the existing PostgreSQL tax/category date exclusion unchanged. Require explicit finite inclusive dates; published schedules cannot yet be shortened. Adjacent schedules are supported, overlapping schedules rejected. This deliberately avoids falsely implementing append-only retirement while the old exclusion still covers the original interval. No active statutory rate is seeded; browser-created DEMO schedules are calculation-only test configuration. The remaining design below includes future capabilities, not claims that all are released.

## Reuse and explicit boundary

Reuse `taxes`, `tax_categories`, `tax_rates`, `tax_transactions`, `accounts`, CommandService, company configuration locks and `calculateTaxLine`. Do not create a parallel calculator or ledger. No hard-coded statutory rates, active demo VAT schedule, caller-supplied actor IDs, arbitrary formulas or fake eTIMS certification. Configuration writes never create a journal, tax transaction, stock movement or balance.

Migration 015 or later must be additive: applied001–014 are immutable. Inventory/POS remain disabled until authoritative selection, tax snapshots and atomic posting are integrated. Names/types/categories are configuration, not legal verification of a taxpayer or tax treatment.

## Workflow and normalized state

1. Authorized human proposes a tax definition, classified category, or effective rate/account binding with a reason and documentary basis. Preserve proposed values in typed normalized columns; do not hide financial configuration in free-form JSON.
2. Pending proposals are inert. A different authorized human approves/rejects; creator/editor/reviewer/time remain distinct. Approved definition identities and classification are immutable. Naming/lifecycle changes need explicitly reviewed amendments rather than direct updates.
3. Approved schedules bind tax + category + inclusive dates + exact fractional rate + inclusive/exclusive mode + recoverability + input/output account IDs. No priority-based silent tie breaking: the existing tax-rate exclusion prohibits overlapping schedules for a tax/category; retain deterministic fail-closed semantics.
4. Replacement/retirement must preserve published definitions and historical snapshots. **Resolve the existing base-table exclusion before choosing append-only retirement:** a `valid_to=9999-12-31` row continues to overlap even when a separate retirement record shortens its effective coverage. Do not remove the exclusion without replacing its concurrency/integrity guarantees. Tests must establish immutable history and race-safe effective intervals first.
5. Runtime selection uses server company, transaction date and authoritative category/tax assignments; returns exactly one applicable schedule per required tax or fails. Never trust the calculation preview as posting authority. Future operations persist selected rate IDs, effective-end revision, normalized exact factors, account bindings, classification, price mode, calculation version and full results inside their business transaction.
6. Returns/credit notes use the original persisted tax breakdown with cumulative limits, not current configuration. Corrections to prior wrong tax require linked business adjustments; never rewrite posted snapshots or silently revise ledgers.

## Validation / permissions / attribution

Use separate `taxes:view`, `taxes:propose`, `taxes:approve` permissions, no role-name authority or implicit finance read grant. Use backend RBAC plus tenant FKs/RLS, strict schemas, server actors, idempotency, serialized configuration publication, immutable terminal decisions and exact SQL-native audit snapshots.

TAXABLE requires an applicable positive configured factor; ZERO_RATED requires an explicit zero schedule. EXEMPT and NON_TAXABLE remain distinct and apply no rates. A bounded same-base multi-tax group must agree on inclusive/exclusive mode; compound rules stay unsupported. Decimal-string factors/recoverability only; no JS floating-point money. Gregorian dates must also fit PostgreSQL (no year0000), and end dates are inclusive.

Revalidate active/postable company accounts, functional denomination and required tax control/class at approval and posting. Establish the actual control types from current account schema/seed rather than inventing account numbers. Input recoverability is not blanket legal entitlement: product/use/document/period eligibility still belongs to the later operational tax policy. Initially refuse unsupported configuration combinations rather than inventing automatic tax postings.

## API/UI shape to prove, not yet released

- Bounded searchable catalogs for taxes/categories/rates, eligible accounts and request history.
- Strict proposal endpoint with discriminated typed changes; independent decision endpoint.
- Effective lookup/calculation preview accepts configuration IDs and date/quantity/price/discount, never authoritative raw factors/accounts/actors. Clearly marked informational, with no journal/stock/tax-register effect.
- Reuse ConfigurationPicker and control-center dialog/focus/error/loading/empty/confirmation patterns after backend verification. Expose classification and both rate factor/percentage display without ambiguous conversions. Show basis, effective dates, account names, creator/reviewer and retirement/replacement history.

## Test-first gates

Write isolated PostgreSQL/HTTP RED tests before migration/service: strict unknown-field rejection, unauthenticated/RBAC/tenant isolation, no implicit finance access, exact decimal boundaries, leap/invalid dates, zero/exempt distinction, malformed/account currency/control/scope checks, inert proposals, self-review denial, immutable decisions/definitions, duplicate code and interval races, idempotency/retry, stale retirement, rollback after partial publication, exact audit/forged-audit refusal and absence of financial side effects. Include open-ended schedule replacement and retained-application-date protection before enabling retirement.

Then real browser propose→review→effective preview, minimal tax-only role, paginated account search, dark/mobile/focus checks and existing regressions. Fresh encrypted checkpoint and actual isolated restore must preserve approved schedules, requests, audits and relationships. Only then wire trusted configuration into product assignment and atomic operational transactions. Full tax registers, returns, tax-account reconciliation, eTIMS and legal acceptance remain separate gates.

## Legal reference boundary

Official KRA VAT information reviewed earlier: https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax . Preserve documentary effective dates and obtain current authorized review before activating rates. General/zero/exempt classifications and tax-point/recoverability rules must not be reduced to an unconditional percentage. Current contracted eTIMS specifications and external acceptance remain required; no fiscal success is simulated as production evidence.
