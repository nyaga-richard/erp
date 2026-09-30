# 0.5 — controlled chart-of-accounts additions and naming

## Design before implementation

This increment adds the first COA configuration commands to the existing accounting engine, not a disconnected account CRUD screen. Scope: propose a non-control account/header, propose a display-name correction, independently approve/apply or reject. No account deletion, reclassification, code change, currency change, reparenting, active-status change, opening balance, control-account creation or posting-rule changes. Those remain separate release gates. Existing posted journal amounts/account IDs/source IDs are not rewritten. Reports resolve the current account display name; the configuration audit preserves earlier names (historical-name-as-of reporting is not claimed).

## Workflow and state machine

1. Authenticated proposer submits CREATE or RENAME with a reason. A pending request is immutable; it is not an active account and has no financial effects.
2. A different authenticated reviewer with accounts:approve reviews the complete request. APPROVE atomically applies it to accounts, marks APPLIED, and records request/account before and after. REJECT records reason and reviewer without changing any account.
3. PENDING -> APPLIED or REJECTED only. No editing, deleting, resubmitting or resetting terminal requests. Corrections require a new linked-to-account request. No retrospective journal correction is implied. A stale rename must be rejected and replaced; it cannot overwrite a newer version.
4. Same idempotency key/payload returns the original result. Changed payload or repeated terminal transition with a different key conflicts. Competing reviews serialize; only one transition/audit/account mutation commits.

## Data and relationships

account_change_requests: company, kind, immutable normalized proposal columns, target account + expected version for rename, preallocated account UUID for creation, immutable created_by/created_at/reason, state, reviewer/time/decision reason and applied account reference. All account references use composite company foreign keys. accounts gain version, original creation timestamp (NULL for legacy rows), last editor/time and last applied request FK. Creation preserves original human proposer in accounts.created_by; applying reviewer is retained on the request. RENAME preserves original account creator and protected metadata.

New accounts inherit the company functional currency policy (currency NULL means unrestricted by an account-specific denomination, but this release's journal engine still enforces company functional currency). Parent is optional; if present it must be active, same-company, non-postable, non-control, same classification and compatible currency. Parent/type/postability are immutable through this API; ancestors cannot be changed into posting accounts. Both postable non-control accounts and non-postable headings can be proposed. Code is uppercase 2–24 characters, unique per company when applied; pending requests do not reserve codes. Name 2–120 characters; reason 5–500. No float/money input exists here.

## Permissions, approval and concurrency

- accounts:configuration:view: paginated account catalog, paginated request queue and parent search.
- accounts:propose: submit proposals; does not grant approval or journal posting.
- accounts:approve: approve/reject another person's request; does not grant proposal or financial posting.
- Existing accounting:view continues to authorize the financial account catalog.

Backend checks all grants; no role-name checks. Demonstration grants: Esther proposes, Felix reviews; finance/audit users may view. Users with both permissions still cannot review their own requests. Configuration commands take the existing exclusive company advisory lock; financial commands take its shared counterpart. Permissions/membership/session are rechecked after locking. Approval revalidates duplicate code, parent eligibility or target version. Stale/competing requests fail without side effects. Database triggers enforce request immutability, review separation, matching applied proposal and deferred same-transaction audit. Runtime account writes without an approved matching request fail. Trusted owner/bootstrap is explicitly outside runtime authorization, not a public bypass.

## Effects and reversal

Propose/reject: only configuration request, idempotency result and audit. Approve: these plus one new account or one versioned name change. No journal, source document, sequence, balance or inventory movement. New postable accounts immediately participate in the existing journal draft -> independent approval -> independent posting workflow, with exact decimal validation and normal double-entry/reconciliation checks. Reversal of a financial transaction still uses linked opposite-entry journal drafts; a naming correction uses another independently reviewed request.

## API

GET /admin/accounts?q=&page=&limit= : paginated complete catalog and original/editor attribution.
GET /admin/accounts/parents?accountType=&q=&page=&limit= : eligible parent search.
GET /admin/account-changes?q=&state=&page=&limit= : paginated full review payload/attribution.
POST /admin/account-changes : strict discriminated CREATE/RENAME body, Idempotency-Key, company and CSRF.
POST /admin/account-changes/:id/decide : {decision: APPROVE|REJECT, reason}, same headers.

## Acceptance tests before frontend

Authentication/CSRF/RBAC/company isolation; proposer cannot self-review even with both grants; pending request creates no account or journal; parent eligibility/cross-company rejection; unknown/forged actor/protected fields rejected; atomic approve + audit with proposer/reviewer attribution; replay versus conflicting idempotency; rejection no account effect; concurrent reviews one winner; conflicting code proposals; competing rename versions; immutable/unaudited direct runtime writes denied; transaction rollback on audit failure; newly approved account flows into a balanced independently posted journal and trial balance. Browser proof covers maker/reviewer navigation, search, approval/rejection, journal account picker availability, and sandbox sign-in regression. No production certification is implied.

## Review/apply sequence

```mermaid
sequenceDiagram
 participant Maker as Proposer
 participant API as COA API
 participant Commands as Transaction coordinator
 participant DB as PostgreSQL
 participant Reviewer as Independent reviewer
 Maker->>API: Authenticated CREATE or RENAME proposal + reason
 API->>Commands: Recheck permission, company, session, idempotency
 Commands->>DB: Pending request + atomic audit; no account effect
 Reviewer->>API: APPROVE or REJECT + reason
 API->>Commands: Exclusive company lock; reviewer differs from proposer
 Commands->>DB: Lock request; recheck parent/code or account version
 Commands->>DB: Apply account + terminal request + exact audit snapshots
 DB-->>Reviewer: Commit all effects or roll back all
```

## Executed verification — 26 September 2026

The preimplementation HTTP tests first failed against the absent routes. After implementation, **76 total backend tests passed**, including 15 COA cases plus their suite. COA coverage includes audit-failure rollback, competing approval/code/version conflicts, direct runtime write denial, tenant isolation, current-grant removal, header-account posting denial, maker/reviewer separation and exact journal integration. Existing financial/auth/control tests also pass.

`docs/browser-coa-result.json` records 16 passing Chromium checks and zero page errors: proposal/parent search, no pending-account leakage, separate proposer/reviewer access, independent creation and label revision, rejection without account effect, actual journal autocomplete -> source -> approval -> posting -> trial balance, auditor read-only access, Escape handling, dark mode and 390px layout. The first browser run caught an ambiguous test locator when two applied requests shared an account code; the locator now also matches change kind. The application keeps both immutable requests, rather than deleting history to satisfy the test.

Cookie-free (ten checks) and cookie-only (five checks) browser regressions passed, along with all prior organization, branches, access/recovery and journal browser scenarios. External SMTP and the user's actual Arena traffic authorization remain outside these tests. SQL schema export: 116 tables, 1,212 columns and 490 FKs; the new public OpenAPI has 48 paths. This remains a Phase 1 development increment, not a production-ready operational ERP.
