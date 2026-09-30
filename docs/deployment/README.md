# Deployment and activation gates

For the requested host/domain-specific walkthrough, see [Ubuntu + Docker + Cloudflare Tunnel for `erp.trustedsystems.co.ke`](ubuntu-cloudflare-tunnel-trustedsystems.md). It includes port isolation guidance for a server already running other services.

**Not a production-complete ERP.** Local Next production build/HTTP/CSP checks passed (`next-production-result.json`). Compose YAML/private-port/auth-policy checks passed (`config-verification.json`). Docker image builds, container restart/recreation, Ubuntu installation, and a live Cloudflare tunnel have **not** run: Docker CLI 29.8.1 and Compose 5.5.1 were installed for diagnostics. User namespaces work, but the actual RootlessKit/slirp4netns daemon attempt failed creating its TAP interface (open: Permission denied); the official launcher also rejects the host-network driver. Native `docker compose config --quiet` passed for all three manifests. No working daemon/image/container runtime was obtained. Run those gates on a Docker-enabled staging host before promotion. An API readiness response is not production certification.

## Ubuntu installation and release layout

Use a reviewed supported Ubuntu release with Docker Compose v2 packages. Review then run `sudo bash scripts/ubuntu/install.sh`. Install the reviewed source release at `/opt/erp` (the repository root, not an extra nested directory). The installer enables Docker on boot but does not grant root-equivalent Docker-group access to application users or provision production/demo credentials.

Copy `.env.example` to `/opt/erp/.env`, mode 0600. Generate **independent** values with `openssl rand -hex 32` for POSTGRES_PASSWORD, RUNTIME_DB_PASSWORD, AUTH_WORKER_DB_PASSWORD, RESET_ENCRYPTION_KEY and BACKUP_ENCRYPTION_KEY. Database password examples require URL-safe values; hex is suitable. Store recovery keys in a separate secret manager/offline escrow, not in the backup volume. Set PUBLIC_WEB_ORIGIN to the trusted HTTPS hostname, SMTP_URL (URL-encode credentials) and SMTP_FROM. Never seed a production tenant with demo identities.

From `/opt/erp`:

```bash
sudo scripts/ubuntu/erpctl.sh validate
sudo scripts/ubuntu/erpctl.sh deploy
sudo scripts/ubuntu/erpctl.sh health
sudo scripts/ubuntu/erpctl.sh logs api
sudo scripts/ubuntu/erpctl.sh restart
```

`deploy` validates Compose, builds, backs up an existing running database, runs checksummed migrations under the owner connection, starts API/worker/web and checks readiness. Production Compose forces Secure strict HttpOnly cookies and disables the development memory transport. Nest also refuses that transport if enabled in production. The worker uses `erp_auth_worker`, not the API or owner role. Only loopback web diagnostics are published (`127.0.0.1:${ERP_WEB_BIND_PORT:-8080}`); set `ERP_WEB_BIND_PORT` to an unused host port when other services occupy the default. PostgreSQL and the worker have no host port. Database network is internal. SMTP egress is limited by placing the worker on a separate outbound network. Redis/MinIO are not added merely for appearance; no implemented module currently requires them.

The API never receives owner or backup credentials. Next's private API origin is server build configuration (`API_INTERNAL_URL=http://api:3000` in Docker), not a NEXT_PUBLIC/browser variable. The standalone web process is non-root and sets a fresh nonce CSP; production framing is denied. Inline styles remain allowed for the existing React layout; scripts use nonce/strict-dynamic. Base/tunnel images are now pinned to registry manifest digests recorded in `image-lock.json`; response content hashes were checked. This is not an image signature or vulnerability scan. Review/update these pins through the release process, and retain immutable application release images.

## Reboots, updates and rollback

Named volumes retain PostgreSQL and backup data; services use `unless-stopped`, and the Ubuntu installer enables Docker. **Those settings have been inspected, not demonstrated by rebooting this environment.** Do not run `docker compose down --volumes` on a real tenant. Test container recreation and host reboot on staging.

Set ERP_RELEASE to an immutable reviewed tag and retain previous images. `sudo scripts/ubuntu/erpctl.sh rollback PREVIOUS_TAG` changes application images only, never the database. Readiness compares the full migration checksum manifest, so an incompatible old application will fail closed. Do not automatically undo migrations or restore over live data: restore into a new database, verify balances and post-backup changes, and plan an approved cutover. An image rollback after a schema change requires explicit compatibility review.

## Cloudflare Tunnel

Create a tunnel in **your own Cloudflare account**, route the chosen public hostname to `http://web:5173`, and store its token as private TUNNEL_TOKEN. Use `sudo scripts/ubuntu/erpctl.sh tunnel` after web/API are healthy. Cloudflared reaches web only via the application network and connects outward to Cloudflare; do not publish database, worker or storage services. Configure Cloudflare HTTPS and an appropriate access policy. Keep origin ports firewalled; the loopback diagnostic port is not Internet-facing. Never reuse or expose Arena preview traffic tokens.

Live DNS/TLS/tunnel behavior, provider credentials, trusted ingress IP attribution/rate limiting, external SMTP, image provenance scanning and disaster-recovery drills on the production host remain activation gates. The current API deliberately does not trust arbitrary forwarded-IP headers; review the exact tunnel/Next/Nest boundary rather than enabling a blanket trust-proxy setting.

## Health semantics

- `/api/health/live`: process can serve requests; independent of DB.
- `/api/health` and `/api/health/ready`: DB query, exact migration checksums, required worker heartbeat, optional actual storage write/delete probe. Failures return 503 without credentials/SQL/paths.
- `REQUIRE_AUTH_WORKER=true`: heartbeat must be no older than 60 seconds. It proves polling liveness, **not SMTP acceptance**.
- `REQUIRE_FILE_STORAGE=true`: FILE_STORAGE_ROOT must exist and be writable. This does not implement business attachment ingestion.
- Redis/storage disabled checks report `not_required`, never fake successful integration.
- `productionReady:false` remains explicit until the complete ERP release gates pass.

Public health contains no credentials or exception stack. `LOG_HTTP_REQUESTS=true` emits structured request ID, route template, method, status, duration and authenticated actor ID; it deliberately excludes request bodies, cookies, session headers, query strings and passwords. Configure protected log shipping and retention before production.
