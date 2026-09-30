# Release package notes

Source snapshot: Karibu ERP v0.5.0, assembled 2026-09-30.

This archive intentionally excludes `.env`, `.runtime`, encrypted database backups, `node_modules`, local install logs, and the private development credential sheet. No working credentials, Cloudflare tokens, or database files are included. A sanitized `DEMO_ACCESS.md` is provided instead.

Deployment walkthrough: `docs/deployment/ubuntu-cloudflare-tunnel-trustedsystems.md`. It includes the combined validate/deploy/Tunnel command, GitHub releases, one-command `.env` generator, staging-only demo-seed instructions, port selection for co-hosted services, and Cloudflare Tunnel for `erp.trustedsystems.co.ke`.

This source snapshot is not certified production-ready. The safe first-company/first-admin bootstrap is not implemented. Docker runtime, actual Ubuntu host deployment, and live Cloudflare Tunnel were not verified in the development sandbox. Do not process real financial transactions with this package until its documented go-live gates pass.
