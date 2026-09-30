# Database operations and integrity

PostgreSQL 17 is the authoritative relational store. [Data dictionary](../data-dictionary.csv), [full ERD](../erd.mmd), [FK definitions](../foreign-keys.json) and [schema summary](../schema-summary.json) are generated from the running schema; table existence is not module completion. Many domain tables belong to the planned operational baseline.

Migration order is lexical, checksummed and protected by an advisory lock. Run `npm run migrate` with MIGRATION_DATABASE_URL and separately provision runtime/worker passwords. Never edit an applied migration or regenerate 002 over a live database. Add a migration instead. Readiness checks the entire ordered name/checksum manifest, including unexpected newer migrations, so an incompatible old image fails closed.

New migrations after 007:
- 008: readable migration registry, restricted auth worker and heartbeat.
- 009: worker audit actor/action/job-origin restriction.
- 010: number-format registry, padding/allocation metadata, column-restricted counter updates and transactional origin/commit guards.
- 012–013: controlled numbering policies/requests, shared effective-format resolver, immutable decisions and exact prior/after audit proof.
- 011: removes the initial migration sentinel from legacy allocation metadata; unknown historical allocator/time remain NULL.

Migrations 010–011 do not invent a historical allocator or timestamp: unknown legacy allocation metadata remains NULL after the upgrade. Original source/journal creator/approver/poster metadata is untouched. New allocations capture the actual transaction actor and time. Number keys currently use business-date calendar year despite the historical `financial_year` column name. Existing number strings/formats remain unchanged.

Financial values use PostgreSQL numeric domains and decimal strings, not JavaScript floating-point sums. Monetary ledger scale is currently two places. Inventory quantities/unit values have six and rates ten; operational valuation/tax services are still incomplete. Posted journals/lines cannot be edited/deleted, balanced posting is deferred to commit, and linked reversals preserve source history. The API receives only erp_runtime; erp_auth_worker cannot read journal data. Owner credentials are reserved for trusted migrations and recovery.

Run backend integration tests only on an isolated create-database-capable test cluster. They create uniquely named erp_test_* databases, apply migrations, use actual HTTP/runtime SQL and drop only their own test DBs. Backups restore only into new erp_restore_* targets with explicit confirmation. See [recovery runbook](../backups/README.md). `npm run schema:export` regenerates documentation and does not mutate schema.

## Posting-rule configuration — migration 014

Live migrations are001–016. Exported schema:128 tables,1,348 columns,539 foreign keys. The sealed migration-owned contract registry, normalized requests/legs, immutable reviewed publication, append-only retirement and protected application references are applied. Runtime cannot register contracts or fabricate application records. Warehouse closure accounts for configuration dependencies. Operational workflow status remains CONFIGURATION_ONLY; there is no inventory posting API. Never edit applied migrations. Latest isolated encrypted restoration: `../testing/posting-rules-restoration.json`.

## Tax and product reference controls —015–016

015 adds normalized reviewed tax requests, immutable approved masters/finite schedules and exact audit guards. Existing tax/category interval exclusion is retained; no retirement or operational posting is enabled.016 adds governed version markers, immutable attributed unit/category/brand creation, bounded acyclic hierarchy and exact atomic audit; no products or stock quantities are created. Actual current restoration: `../testing/tax-product-restoration.json`. Never edit applied migrations.
