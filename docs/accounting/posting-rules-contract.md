# Central posting rules — implementation contract

Status: **IN_PROGRESS**. Centrally reviewed account mapping now has a tested database/API/UI workflow; operational integration remains unfinished. Reuse the existing `accounting_rule_sets`, `accounting_rule_legs`, `journal_entries.rule_snapshot`, company configuration lock and CommandService. Do not create a parallel ledger or execute expressions supplied by administrators.

## Workflow and boundary

1. An authorized human proposes an event/scope/effective-period/priority and symbolic-leg account mapping, with a reason. Pending proposals have no posting effect.
2. A different authorized reviewer applies or rejects the immutable proposal. Publication allocates its version under the exclusive company configuration lock. Replayed commands return the same result; stale or conflicting decisions roll back.
3. A trusted domain service computes named monetary totals from locked business records, obtains the effective reviewed rule under the posting transaction's shared configuration lock, validates account eligibility, and produces balanced journal lines.
4. Source, stock, subledgers, tax, journal, selected rule snapshot and audit commit atomically. Missing/ambiguous mapping or any subsequent failure rolls all effects back.
5. Posted entries retain their mapping/amount snapshots. Reversals use original effects; they do not reinterpret the original through today's mapping.

This does not retrofit automatic rules into the explicit non-control manual-journal workflow. No public operational posting endpoint is released by a resolver alone.

## Deterministic selection contract (kernel first)

Input: company, event type, business date, branch and nullable warehouse/product/category/tax-category/payment-method IDs. Dates are real Gregorian dates in years 1–9999. IDs and input shapes are strictly validated. The caller must resolve and validate all entity relationships under company scope; matching UUIDs alone does not prove warehouse/branch or product/category ownership.

Candidates must be active, independently approved and effective on the business date. Effective endpoints are **inclusive**; a null end is unbounded. Company/event match exactly. Every non-null candidate selector must equal the corresponding context selector; null is a wildcard, not an unknown-value match. A constrained rule cannot match a missing context value.

Rank eligible candidates by **priority descending**, then **number of constrained selectors descending**. Exactly one highest-ranked candidate is required. No match fails closed. A tie fails closed even if one version/UUID is higher; version, approval time, input order and account IDs are not hidden tie-breakers. Invalid candidate structures/approval evidence are rejected rather than silently normalized into valid rules. A snapshot records the normalized context, selected immutable definition, creator/reviewer, version and ranking semantics; nested data must be immutable and detached from caller-owned objects.

This kernel selects a rule only. It is **not** proof of permissions, current account eligibility, approved event-contract membership, balanced line materialization, persistence, database immutability, or operational effects. Those gates remain mandatory.

## Database and configuration requirements

- Reuse rule-set/leg tables. Add immutable proposal/decision records with tenant FKs, creator/editor/reviewer attribution and exact before/after audit proof. Active rule publication must require a matching independently applied request, not merely an approved_by UUID supplied in an INSERT.
- Append-only published mappings and leg definitions. Add explicit reviewed prospective retirement/effective-end records rather than overwriting historical mappings or choosing a higher version implicitly. Effective closure may not invalidate any already-posted rule application. Preserve original snapshots; fail visibly when a requested cutover is unsafe.
- Explicit registered event contracts define allowed symbolic legs, debit/credit direction, named trusted totals and eligible account/control categories. Account IDs, rates and account codes are never hard-coded into domain modules. Arbitrary formulas, eval and frontend totals are prohibited.
- Publication validates active same-company entities, hierarchy relationships, active/postable correctly denominated accounts and event-specific control-account eligibility. Reject possible equal-rank overlapping scopes/dates; the resolver still detects ambiguity defensively.
- New grants: rules:view / rules:propose / rules:approve. Role names confer no authority. Configuration review is independent; operational transaction approvals remain a separate policy.
- Planned API: paginated rule catalog/history, effective lookup, eligible account/scope search, proposal and decision. Strict request schemas, idempotency and optimistic versions; no direct counter/balance/account-classification edits.
- Frontend follows backend verification: permissioned Control center tab, server search, effective preview, inert proposals, independent review, immutable history, accessible dialogs and full state handling. A rules-only observer must be able to reach the tab without finance privileges.

## Required verification sequence

Write pure selection tests before implementation: scope/tenant/event/date selection, priority/specificity, ties, missing rules, missing selector values, malformed/duplicate definitions, independent approval evidence, detached immutable snapshots and permutation invariance. Then PostgreSQL/HTTP tests for publication/retirement, tenant/RBAC/delegation, idempotency, audit corruption, locks, stale versions, account-policy validation, actual balanced domain posting and forced rollback. Only then frontend/E2E and module verification. No operational or production readiness claim is justified by the selection tests alone.

## Current executed evidence

The complete backend suite now passes **185 tests**: resolver 12, materializer 10, overlap 7, registry 5 and configuration DB/HTTP 16 among the complete regression. Migration 014 is applied. Public configuration endpoints and the Control center tab support mappings, independent approval/rejection, lookup and prospective retirement. Exact audit, stale decisions, currency/scope eligibility, concurrent idempotency, rollback, forgery refusals and no financial side effects are covered. All 15 browser suites pass, including the new workflow and minimal rules-only access. Actual post014 backup restoration preserved publication links, 3 mappings, 6 requests and 3 retirements. These are configuration-only event contracts. Operational rule application, atomic application references, inventory/tax/subledger effects and reconciliation remain unfinished.
