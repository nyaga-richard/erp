# Development package notes

Source snapshot: Karibu ERP v0.5.0, updated 2026-09-30.

This archive intentionally excludes `.env`, `.runtime`, encrypted database backups, `node_modules`, local install logs, and private development credential sheets. A sanitized `DEMO_ACCESS.md` is provided instead. No working credentials, Cloudflare tokens, or database files are included.

Deployment walkthrough: `docs/deployment/ubuntu-cloudflare-tunnel-trustedsystems.md`. It documents the combined validate/deploy/Tunnel command, one existing shared Tunnel workflow, one-command `.env` generator, development demo seed, existing-tenant Day-2 starter seed, port selection for co-hosted services, and Tunnel routing. Do not bootstrap or seed a production tenant from this development archive.

The safe first-company/admin bootstrap and additive starter-scaffold operations are implemented in code, but no bootstrap, seed, deployment, database mutation, or Tunnel operation was performed for this invoice increment. Follow the additive Day-2 path only for an existing deployment.

Service-credit invoices are IN_PROGRESS: this snapshot contains branch-scoped draft read/create routes and valuation submission into PENDING_APPROVAL, with server-side governed SERVICE pricing/tax and an immutable typed valuation/policy snapshot. Migrations024–025 are authored and unapplied. Submission does not authorize/hold credit headroom or create ledger effects. Approve/reject/post/cancel/reverse, AR/tax ledgers, and reconciliation are not implemented. API build and focused invoice/resolver plus seed regressions passed under Node v20.20.2 with an engine warning; the repository requires Node >=22. A full API test discovery attempt at the prior draft-only checkpoint reported 96 passed and 11 database-backed tests blocked by ECONNREFUSED on local 127.0.0.1:5432; the full suite was not rerun after the typed-submit increment and no test database was started. Migration024 and real HTTP/database authorization integration were not tested. This package is not certified production-ready and must not process real invoice transactions.
