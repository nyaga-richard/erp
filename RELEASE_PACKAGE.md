# Release package notes

Source snapshot: Karibu ERP v0.5.0, assembled 2026-09-30.

This archive intentionally excludes `.env`, `.runtime`, encrypted database backups, `node_modules`, local install logs, and the private development credential sheet. No working credentials, Cloudflare tokens, or database files are included. A sanitized `DEMO_ACCESS.md` is provided instead.

Deployment walkthrough: `docs/deployment/ubuntu-cloudflare-tunnel-trustedsystems.md`. It covers GitHub release tags, the one-command `.env` generator, port selection for co-hosted services, Docker Compose, and Cloudflare Tunnel for `erp.trustedsystems.co.ke`.

This source snapshot is not certified production-ready. The repository documents unresolved ERP modules and first-production-admin onboarding. Docker runtime, actual Ubuntu host deployment, and live Cloudflare Tunnel were not verified in the development sandbox. Do not process real financial transactions with this package until its documented go-live gates pass.
