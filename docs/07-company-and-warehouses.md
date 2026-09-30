# Increment 0.4 contract — company profile and warehouse configuration

Design before implementation. Phase 1 remains open; these are configuration controls, not the inventory engine. No new company onboarding, stock movements, balances, tax or GL posting is enabled by this slice.

## Company profile

GET /admin/company requires organization:view, uses the authenticated selected company, and shows code, display name, functional currency, timezone, tax PIN, status, version and attribution. POST /admin/company/revise requires the separate organization:profile:manage permission, expectedVersion and a reason; only the display name is editable. New-company provisioning/global owner authorization, legal/tax identity changes, lifecycle changes and functional currency/timezone changes are not exposed. Existing code, tax PIN, accounting/approval flags and origin are immutable under this interface. Do not silently reinterpret old journal currencies/dates.

Name revision takes the exclusive company authorization/configuration lock, retains original creator, stamps editor/time/version and writes before/after audit atomically. It has no financial effects. Correction is another attributed revision. Runtime grants restrict updates to permitted columns; a deferred audit constraint rejects unaudited runtime SQL.

## Warehouse/location configuration

Company → branch → warehouse relations stay authoritative. Reuse the existing warehouses table. Separate warehouses:view / warehouses:manage permissions; no role-name checks. Company-scoped paginated search may filter by branch. Searchable active-branch options are permissioned through warehouses:view, not inferred from financial branch access.

Workflow: create code/name/location type under an active same-company branch → reasoned optimistic name/status revisions → deactivate/reactivate. Codes, company, parent branch, location type and original creator are immutable. No deletion, relocation, stock quantity, value, cost or opening-balance input exists. Moving stock must eventually use a movement document, not change a warehouse parent.

Types: SELLABLE, TRANSIT, QUARANTINE, DAMAGED, RETURNS. These are configuration categories; creating one does not implement sale eligibility or inventory valuation. Creation grants no user scopes and creates no journals or stock projections.

Commands: GET /admin/warehouses; GET /admin/warehouses/branch-options; POST /admin/warehouses; POST /admin/warehouses/:id/revise. All mutation DTOs reject extra actor/company/balance fields. Required reason, idempotency, version conflict, atomic audit and live permission checks reuse CommandService with exclusive company locking. Creation/reactivation requires an active parent branch. An active warehouse blocks branch deactivation through the existing branch guard, including concurrent changes.

Until operational lifecycle engines exist, deactivation is deliberately conservative: **any record referring to the warehouse in the current operational baseline blocks it**, even a historical or zero-balance record. Do not pretend to have implemented a safe operational close. The guard covers every current foreign-key reference: terminals, movements, balances, reservations, valuation policies, counts, transfers (all three locations), sales/return lines, requisitions/POs/GRNs/purchase return lines and accounting rules. A tightly scoped SECURITY DEFINER boolean function checks these without granting the runtime access to unreleased domain tables; fixed search_path, tenant/actor/permission checks, no dynamic SQL, no public execution. Future inventory/purchasing must replace this conservative gate with tested open-work/balance checks and use the same transaction/locking boundary.

## Schema and audit

Additive migration 006: version and edit attribution on companies; version/creation/edit attribution on warehouses. Unknown creation dates of legacy warehouses remain NULL. Preserve all already-applied migrations and financial records. Runtime writes to operational domain tables remain denied. Database guards preserve identity/version/actor, active parent and atomic audit. Owner/DBA bootstrap remains an explicitly trusted maintenance boundary. Company/warehouse display-name changes do not rewrite historical origin IDs.

## Tests before UI

Company: read/rename permission isolation; company isolation; reject currency/flags/actor spoof; stale version; idempotent retry/changed-body conflict; original creator preserved; unchanged GL and source counts; SQL column and audit guards.

Warehouse: permission/tenant/strict DTO checks; active-parent validation; duplicate code; idempotency; version races; no automatic scopes/projections; immutable code/type/branch; block branch deactivation while active; deactivate empty warehouse then branch; deny warehouse reactivation under inactive branch; reopen branch then warehouse; full FK coverage assertion on conservative dependency guard; restricted helper invocation; representative terminal/valuation dependencies (owner-only test fixtures); runtime cannot write inventory balances; audit rollback. Race-test warehouse creation vs branch deactivation and assert no active child under inactive parent, whichever command wins.

After backend passes, browser-test company rename/restore, warehouse create/search/rename/deactivate/reactivate, inactive-parent/dependency feedback, read-only reviewer and existing branch/financial/embedded-login regressions. Document exact evidence and remaining phase gates.


## Verification checkpoint — 26 September 2026

The primary company/warehouse tests were written before implementation, and the initial backend suite passed before the UI was added. Additional security/concurrency cases bring the current suite to: **57 passing tests, zero failures**. The restricted helper is checked for non-public execution and fixed search_path; every warehouse foreign-key reference in the current schema must appear in its static dependency checks. Owner-only valuation-policy and inactive-terminal fixtures prove conservative deactivation denial; application runtime inventory reads and writes remain denied. Concurrent warehouse edits and warehouse creation versus branch deactivation are tested on real PostgreSQL.

The new Chromium organization workflow passed together with the existing accounting, branch, controls/recovery and secure cross-site iframe workflows. The organization test restores the demo company's original name through another attributed revision, rather than erasing audit history. Screenshots and exact outcomes are in `browser-organization-result.json` and `screenshots/warehouse-configuration.png`. The sandbox cookie fix remains in place; use Arena's live preview entry, not a raw traffic-protected hostname. Production certification is not implied.
