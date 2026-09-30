# Ubuntu + Docker + Cloudflare Tunnel deployment guide

**Target hostname:** `erp.trustedsystems.co.ke` (users should browse to **`https://erp.trustedsystems.co.ke`**).

**Important release caveat:** this repository is not yet a production-complete ERP. The Compose candidate, Ubuntu scripts and security configuration have not been exercised on a real Docker host or with a live Cloudflare Tunnel. Use a separate staging tenant first, keep Cloudflare Access in front of the hostname, and do not enter real customer or financial data until the production onboarding, accounting, restore, and end-to-end release gates have been completed. The demo seed is forbidden in production.

This guide uses the repository's `docker-compose.prod.yml` and Ubuntu scripts. Docker Compose project names isolate its container/network/volume names from other applications. PostgreSQL, API, and mail worker have **no host-published ports**. Only a loopback-bound web diagnostic port is published. Cloudflared reaches the web container over the Compose network.

## 1. Preflight the existing Ubuntu host

Use a supported Ubuntu LTS release (preferably 24.04), an account with sudo, sufficient free disk for images/database/backups, and outbound DNS/HTTPS plus Cloudflare Tunnel connectivity. Make sure Docker/Compose are not already managed by a conflicting package or system.

Inventory current listeners and containers **before choosing a port**:

```bash
sudo ss -lntup
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
sudo docker volume ls
sudo df -h / /var/lib/docker
```

The default loopback diagnostic port is **8080**. If anything already owns it, choose another unused port (for example **18080**) and put that value in `.env` as `ERP_WEB_BIND_PORT=18080`. It is not the Cloudflare origin address when using the bundled Docker tunnel. The Cloudflare connector uses `http://web:5173` on the private application network, so changing this host-only port does not change public routing.

| Listener/flow | Port | Exposure |
|---|---:|---|
| Staff browser → Cloudflare | HTTPS 443 | Public Cloudflare edge only; `https://erp.trustedsystems.co.ke` |
| Cloudflared → Cloudflare edge | outbound TCP/UDP 7844 | Outbound only; allow DNS too if egress is restricted |
| Host web diagnostic | chosen port (example 18080) | `127.0.0.1` only; not a public listener |
| Web container | 5173 | Internal Compose application network; cloudflared → `web:5173` |
| API container | 3000 | Internal Compose application/database networks; no host port |
| PostgreSQL | 5432 | Internal database network only; no host port |

Existing services can keep using their existing ports. The guide does not ask you to bind the ERP to public 80/443 or change another application's ports.

`COMPOSE_PROJECT_NAME=trustedsystems-erp` gives this installation its own resource namespace. Do not reuse another application's Compose project name, volumes, or network. No fixed Docker subnet is configured, reducing collisions with existing networks.

If a Cloudflare Tunnel already runs on this host, read [the existing-tunnel option](#if-you-already-have-a-cloudflare-tunnel) before starting the bundled connector. Do not reconfigure another site's tunnel blindly.

## 2. Install Docker and place a reviewed release

First check whether Docker/Compose already serve your other applications:

```bash
docker version
docker compose version
```

If both work, **do not run the installer just to deploy this ERP**; avoid replacing/upgrading the engine used by your other services. Create `/opt/erp` and continue with the release copy below. If Docker is absent, review `scripts/ubuntu/install.sh` first: it installs Ubuntu's `docker.io` and `docker-compose-v2` packages, enables Docker at boot and creates `/opt/erp`; it does not add users to the root-equivalent `docker` group or generate business/demo credentials. Do not run that package installer over an existing Docker CE installation without an approved maintenance plan. The commands below assume the existing services use the rootful Docker daemon. If they use rootless Docker (`docker info --format '{{.SecurityOptions}}'` / `docker context show`), do not install or switch daemons; deploy as the same rootless service account with an explicitly secured secrets file and adapt the operator wrapper first.

Install Git if needed, then clone an immutable tag from GitHub as the normal deployment user (use an SSH read-only deploy key for a private repo; do not place a Personal Access Token in the clone URL). Substitute your actual owner, repository, and reviewed release tag:

```bash
sudo apt-get update && sudo apt-get install -y git
export ERP_TAG='v<reviewed-release-tag>'
export GITHUB_REPO='git@github.com:<OWNER>/<REPOSITORY>.git'
mkdir -p "$HOME/src"
git clone --depth 1 --branch "$ERP_TAG" "$GITHUB_REPO" "$HOME/src/karibu-erp"

# Only if Docker is absent, run this reviewed installer. Otherwise skip it.
# sudo bash "$HOME/src/karibu-erp/scripts/ubuntu/install.sh"
sudo install -d -o root -g root -m 0750 /opt/erp

# Copy exactly the selected tag, not untracked local state or credentials.
git -C "$HOME/src/karibu-erp" archive --format=tar "$ERP_TAG" | sudo tar -xf - -C /opt/erp
sudo rm -f /opt/erp/DEMO_ACCESS.md
sudo chown -R root:root /opt/erp
sudo chmod 0750 /opt/erp
cd /opt/erp
```

If your repository is public, `GITHUB_REPO` can be `https://github.com/<OWNER>/<REPOSITORY>.git`. Verify the tag/commit against your release process before deploying. Do not copy this development workspace's `.env`, `.runtime`, generated backups, or demo access file to the server. Keep release tags immutable so the previous image can be identified during rollback.

Check available ports again after installation. This application does **not** need inbound host ports 80, 443, 3000, 5432, or 5173 for the bundled Tunnel mode. Do not add those ports to UFW or a cloud firewall for this deployment. Preserve existing firewall rules and SSH access for other services. Cloudflared makes outbound connections; a restrictive egress firewall must allow DNS and Cloudflare Tunnel traffic (TCP/UDP 7844) as well as outbound HTTPS needed to pull images and reach configured SMTP.

## 3. Create the private production `.env` — one command

From `/opt/erp`, run this **single command**. It interactively asks for the project name, a free loopback diagnostic port, immutable image tag, HTTPS origin, verified SMTP sender/URL, and (optionally) the Cloudflare Tunnel token. It generates five independent 256-bit secrets, writes the Docker-internal DB URLs, and creates a root-owned `.env` with mode `0600`. The generated secret values are never printed.

```bash
sudo bash /opt/erp/scripts/ubuntu/configure-env.sh
```

Use a TLS SMTP URL with URL-encoded credentials. The recommended defaults are project `trustedsystems-erp`, diagnostic port `18080`, and origin `https://erp.trustedsystems.co.ke`. The helper refuses to overwrite an existing `.env` and refuses a diagnostic port already in use. If you leave the Tunnel token blank, add it privately to `/opt/erp/.env` before starting the Tunnel. For a private Tunnel token, paste it only at the hidden prompt; do not put it in your shell history or GitHub.

The helper is intentionally interactive: one command does not eliminate the need to supply the SMTP and Cloudflare credentials that only you can obtain. If you already have an `.env`, do not rerun it; preserve a secure copy and make reviewed changes with `sudoedit /opt/erp/.env`.

The production Compose file forces `NODE_ENV=production`, secure strict cookies, SMTP reset delivery, and disables preview-memory sessions. Keep the backup key and database credentials in a secret manager or offline escrow separate from the server and backup storage. Backups cannot be decrypted without the exact backup key. Use a dedicated SMTP mailbox/provider; password-reset delivery is not functional until SMTP is configured and tested. Never put secrets in a shell command, URL pasted into a ticket, source control, or the Cloudflare hostname.

> **Production tenants are created by a separate, one-time owner-only onboarding command after deployment; migrations do not create business identities.** Do not run `npm run seed` or the Compose `seed` profile in production. The protected procedure, limits, and command are in [Section 6](#6-initial-data-and-database-seeding). It refuses non-pristine databases and uses the existing HTTPS/SMTP password-reset flow instead of printing an initial password.

## 4. Configure Cloudflare DNS and the Tunnel

The `trustedsystems.co.ke` DNS zone must be active in the Cloudflare account that owns the Tunnel. Do not point the hostname at the server's public IP. The Cloudflare Tunnel DNS route points to the Tunnel; the origin connection stays inside the server/container network.

1. In Cloudflare Zero Trust, create a **dedicated named tunnel for this ERP** using the token-based/remote-managed connector flow.
2. Copy the connector token into `TUNNEL_TOKEN` in `/opt/erp/.env`. Treat it like a root credential.
3. Add a Public Hostname/application route:
   - Hostname: `erp.trustedsystems.co.ke`
   - Service type: `HTTP`
   - Service URL: **`web:5173`**
4. Ensure Cloudflare creates/routes the DNS record for that hostname to this Tunnel. Remove or replace any conflicting old `A`, `AAAA`, or `CNAME` record for `erp` only after confirming it is not used by another service.
5. Enable HTTPS at Cloudflare and create a Cloudflare Access application/policy for this hostname. Allow only the intended staff identities/groups, preferably with MFA. Access is an extra edge gate, not a substitute for ERP login/RBAC.

The `web:5173` origin name works because the `cloudflared` service joins the Compose `application` network with the `web` service. **Do not put `127.0.0.1:18080` in this bundled connector route**; loopback inside a container is that container, not the Ubuntu host. Do not expose `web:5173` to the host or Internet.

### If you already have a Cloudflare Tunnel

The least-coupled option is still a dedicated ERP tunnel and connector, using the route above. It will not take over other applications' DNS routes.

If you intentionally reuse a connector that runs directly as a host service, do **not** start the Compose `cloudflared` profile. Instead, in that tunnel's configuration/public-hostname route, set `erp.trustedsystems.co.ke` to `http://127.0.0.1:<ERP_WEB_BIND_PORT>` (for the example, `http://127.0.0.1:18080`). Keep the web binding on loopback. A cloudflared process inside a different Docker network cannot resolve this application's `web` service name or use its own `127.0.0.1`; it needs an explicitly reviewed shared network/host-gateway design. Avoid sharing a tunnel token or changing existing ingress routes without the other service owners' approval.

## 5. Validate, deploy, and start the Tunnel — one command

After `.env` is configured, the dedicated Cloudflare hostname route is set to `http://web:5173`, and `TUNNEL_TOKEN` is present, run this single command. If you are reusing a host-managed tunnel instead, use `deploy` (which validates/deploys/health-checks but does not start a second connector) and keep the existing host tunnel route pointed at loopback.

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh deploy-tunnel
```

It validates Compose, builds the images, backs up an already-running database, starts PostgreSQL, applies migrations, waits for API/auth-worker/web health, runs the local health probe, then starts the bundled Cloudflare connector. It refuses to start the connector if `TUNNEL_TOKEN` is blank. The command returns after the connector container is running; confirm it connects in the Cloudflare dashboard and review logs if needed:

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh health
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh logs cloudflared
sudo docker compose --project-name trustedsystems-erp \
  --env-file /opt/erp/.env -f /opt/erp/docker-compose.prod.yml ps
```

The `erpctl` wrapper reads `COMPOSE_PROJECT_NAME` and `ERP_WEB_BIND_PORT` from `.env` without sourcing the secret file into the shell. The API and worker use separate restricted database roles; only the migration service receives the owner connection. Docker networks separate database, application, and outbound SMTP/tunnel access. PostgreSQL has a named volume and no host port. Do **not** add `container_name:` values; Compose project scoping prevents collisions with other applications.
Test locally on the host (with the example port):

```bash
curl --fail --show-error http://127.0.0.1:18080/api/health/live
curl --fail --show-error http://127.0.0.1:18080/api/health/ready
```

Then test from an external network:

```bash
curl -I https://erp.trustedsystems.co.ke
```

A Cloudflare Access redirect is expected if Access is enabled. Once authorized, the login page should load over HTTPS. Confirm the correct TLS certificate/hostname, sign-in, password-reset email, API readiness, and audit/security events before any business use. API `/api/health/ready` is an operational probe, **not** a production-readiness certification; the ERP deliberately reports `productionReady:false` until all release gates pass.

## 6. Initial data and database seeding

The `deploy-tunnel` command applies database migrations. They create schema/system catalogs (including shared currencies KES/USD/EUR, permission codes, and the internal authentication-service identity), but do **not** create a business tenant, human administrator, chart of accounts, opening balances, tax schedules, customers, or transactions. `docker-compose.prod.yml` deliberately has no demo-seed service.

### Production: create the first real tenant and administrator

For an installation already deployed from an earlier release, first follow the [Day-2 update procedure](#day-2-updates-from-github-for-an-existing-deployment) to install the reviewed release containing the latest bootstrap migrations (including `022-bootstrap-audit-permission.sql`), the onboarding command, and its shared starter-template helper. Preserve the existing Compose project, PostgreSQL volume, and secrets; set `ERP_RELEASE` to a **new immutable tag**, then run `sudo bash /opt/erp/scripts/ubuntu/erpctl.sh deploy`. Do not run bootstrap against the old code or an unreviewed source tree.

After that updated deployment is healthy, check that the auth-mail worker has a fresh heartbeat and SMTP delivery is configured. From the server, run this interactive, one-time command:

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh bootstrap
```

It prompts for the registered company name/code, base currency, first branch, and the initial administrator's name/work email. Review the displayed summary and type the exact confirmation `CREATE <COMPANY_CODE>` to proceed. The command runs as the dedicated `erp_owner` role in a short-lived, database-network-only container; it is not exposed as an HTTP endpoint and never receives the runtime API password.

The transaction takes a PostgreSQL advisory lock, verifies every migration checksum, requires a fresh auth-worker heartbeat, and refuses if the immutable onboarding marker exists or if any company, membership, or human account is already present. On success it atomically records the company, branch, initial admin, setup role, and audit/security events, plus a starter chart of accounts, prior/current/next calendar fiscal years, one main warehouse, and governed unit/category/brand references. The starter chart includes control-account labels but no account mappings, postings, or balances; fiscal-year records must be reviewed against the company's actual financial calendar. Product references are metadata only, not registered products. Its database marker cannot be changed by application roles. A failed transaction creates none of the tenant or scaffold; this command is not a repair tool for an existing tenant.

No temporary password or reset token is printed or stored in a file. The administrator uses **Forgot password** at the trusted HTTPS hostname; the single-use reset link is sent through the already-configured SMTP worker. Confirm delivery before proceeding. If the email is wrong or SMTP is not operational, stop and use the separately reviewed account-recovery process—do not set a password with SQL. After successful onboarding, take the first encrypted database backup:

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh backup
```

The initial role can administer users/roles and propose configuration, with read access as catalogued. It deliberately does not grant approve, publish, post, reverse, or period-close rights. Use separately named human accounts and independently reviewed roles for segregation of duties; do not share the initial administrator's credentials.

**This is safe starter onboarding, not a financial-data seed or production-readiness certification.** It creates only the scaffold listed above. It does **not** create tax rates/rules, customers, suppliers, registered products, inventory/stock balances, transactions, or opening balances. Do not invent these values or copy demo data into production. Before financial use, the company must validate account structure and fiscal dates, configure company-reviewed tax and operational masters, and enter verified opening data only through approved, attributable workflows. Some governed onboarding/import workflows remain incomplete, so financial use may still be blocked after the administrator signs in.

**Development/staging only:** `apps/api/src/seed.ts` is a distinct development-only demo seed and rejects `NODE_ENV=production` before connecting. It creates fictional Karibu Retail and Coast Wholesale companies, demo users/roles, and uses the same starter chart/period/warehouse/reference scaffold; it must never be run against a production project, database, volume, or deployment. It does not create balances or financial/stock transactions. Use only a separate disposable Compose project/database.

Create a private staging env file (the `.env.*` rule in `.gitignore` excludes it from commits) and set unique values:

```bash
sudo install -o root -g root -m 0600 /dev/null /opt/erp/.env.demo
sudoedit /opt/erp/.env.demo
```

At minimum, `.env.demo` must contain the following values; replace every placeholder with a unique staging secret. `DEMO_PASSWORD` is shared by the demo users, so keep the file private and never reuse any production secret:

```dotenv
NODE_ENV=development
POSTGRES_PASSWORD=<unique staging owner password>
RUNTIME_DB_PASSWORD=<different staging runtime password>
AUTH_WORKER_DB_PASSWORD=<different staging worker password>
DEMO_PASSWORD=<long development-only password>
ERP_WEB_BIND_PORT=18081
```

Then run the demo seed with its own project name and the **development/reference** Compose file:

```bash
sudo docker compose --project-name trustedsystems-erp-staging \
  --env-file /opt/erp/.env.demo -f /opt/erp/compose.yaml \
  --profile tools run --rm seed
```

Compose starts the staging database and successful migrations as dependencies before seeding. The `NODE_ENV` guard refuses the seed when configured as production. Do not use `--project-name trustedsystems-erp` or `docker-compose.prod.yml` for this demo seed. The staging demo password is held in `.env.demo`; keep the file mode `0600` and use it only for test accounts.

## 7. Operate without disturbing other services

Useful checks:

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
sudo docker stats --no-stream
sudo ss -lntup
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh health
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh logs cloudflared
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh logs auth-worker
```

The Compose host mapping binds only `127.0.0.1:${ERP_WEB_BIND_PORT}:5173`. It must not collide with another service, and it is not reachable directly from the public Internet. API port 3000 and PostgreSQL port 5432 remain internal to Docker. Cloudflared egresses to Cloudflare; no inbound web port is required. Leave existing system services, firewall policies, reverse proxies, and tunnels alone unless their owner has approved a change.

### Day-2 updates from GitHub (for an existing deployment)

Keep using the **same** `COMPOSE_PROJECT_NAME` and existing PostgreSQL volume that the first deployment used. Before replacing files, check the actual project/volume names; if the project changes, Compose can silently create an empty database volume:

```bash
sudo docker compose ls
sudo docker volume ls --format '{{.Name}}'
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh health
```

For each update, select a reviewed immutable GitHub release tag and stage that tag without bringing Git metadata or local secrets into `/opt/erp`:

```bash
RELEASE_TAG='v<reviewed-release-tag>'
GITHUB_REPO='git@github.com:<OWNER>/<REPOSITORY>.git'
SRC="$(mktemp -d)"
STAGE="$(mktemp -d)"
git clone --depth 1 --branch "$RELEASE_TAG" "$GITHUB_REPO" "$SRC/repo"
git -C "$SRC/repo" archive --format=tar "$RELEASE_TAG" | tar -xf - -C "$STAGE"
command -v rsync >/dev/null || sudo apt-get install -y rsync
```

Review the proposed sync first. The excludes protect `.env`, `.env.demo` and other local environment files, runtime/backups, and demo credentials. `.env.example` is intentionally refreshed from the new release:

```bash
FILTERS=(--exclude='/.env' --include='/.env.example' --exclude='/.env.*' \
  --exclude='/.runtime/' --exclude='/backups/' --exclude='/DEMO_ACCESS.md' \
  --exclude='*.erpbackup' --exclude='*.pgdump' --exclude='node_modules/' \
  --exclude='**/.next/' --exclude='**/node_modules/')
sudo rsync -a --delete --dry-run --itemize-changes "${FILTERS[@]}" "$STAGE/" /opt/erp/
# Inspect the dry-run list; if it only replaces release files, apply it:
sudo rsync -a --delete "${FILTERS[@]}" "$STAGE/" /opt/erp/
# Purge the old checked-in development password sheet if a previous release copied it.
sudo rm -f /opt/erp/DEMO_ACCESS.md
```

Do not change `COMPOSE_PROJECT_NAME`, database secrets, backup key, SMTP, Tunnel token, or port merely because a release changed. Use `sudoedit /opt/erp/.env` to set `ERP_RELEASE` to a **new immutable image tag**, retaining the old tag for rollback. Then update the already-deployed app with:

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh deploy
```

`deploy` validates/builds, automatically backs up the database if its service is already running, applies migrations, restarts and health-checks API/worker/web. It leaves the already-running Cloudflare connector and DNS route in place. Review `erpctl.sh logs api`, `erpctl.sh logs web`, `erpctl.sh health`, and external HTTPS after the release. Do not use `deploy-tunnel` for routine updates unless you also need to start the bundled connector. Preserve the prior Docker images; rollback is application-image-only and must be schema-compatible. Never run `docker compose down --volumes` or prune the production volume.

At reboot, Docker is enabled and Compose services have `restart: unless-stopped`; still perform a staging reboot/recreation test. For upgrades, install a reviewed release, use a unique `ERP_RELEASE`, run `erpctl deploy`, then monitor health/logs. Image rollback is only safe for a schema-compatible release:

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh rollback <previous-immutable-ERP_RELEASE>
```

Do not run `docker compose down --volumes`, `docker volume prune`, or remove the project volumes. A database volume is not a backup. Use the exact project name for any manual `docker compose` command; a different project name creates different empty volumes and may look like data loss.

## 8. Backups and recovery

Run encrypted database backups and confirm the command succeeds:

```bash
sudo bash /opt/erp/scripts/ubuntu/erpctl.sh backup
```

The backup and PostgreSQL data volumes survive container recreation, **not** loss of the host or Docker disk. Plan a scheduled, encrypted off-host copy of database **and files** to separately controlled storage. Escrow `BACKUP_ENCRYPTION_KEY` separately, set retention and alerting, and test an actual restore into a new database/host before go-live. Do not restore over the live database as a routine rollback. See [the backup/restore runbook](../backups/README.md). Object/file attachments are not yet a completed operational module; deployment of a volume alone does not imply that feature is implemented.

## 9. Current readiness limits

- A real Docker build/start/recreation/reboot and live Cloudflare Tunnel were not executed in the development sandbox. This runbook does not convert those into verified evidence.
- The one-time production tenant/admin bootstrap and safe starter scaffold are implemented in source, but no live Docker/database execution has been performed. It seeds a starter CoA, three calendar fiscal years, main warehouse and governed reference masters only; tax rules, registered business masters, transactions and opening balances remain company-specific activation gates. Demo users must not be used in production.
- Purchase/AP, retail POS, full AR, complete payments, statements/reports, external provider acceptance, and full reconciliation scenarios are not complete. Do not accept real transactions.
- Production operations still require verified SMTP, Cloudflare Access policy, off-host backup and restore drills, resource/monitoring/alerting, vulnerability review, and tested deployment/rollback.

Use this setup as isolated staging until each release gate has evidence. Do not describe the service as production-ready merely because HTTPS and `/api/health/ready` work.

## Troubleshooting

- **Compose says “address already in use”:** inspect `sudo ss -lntup`, set a free `ERP_WEB_BIND_PORT` in `/opt/erp/.env`, then rerun `erpctl validate` and `erpctl deploy`. Do not change 5173 inside Docker; that is the container port.
- **HTTP 502 / bad gateway at Cloudflare:** check `erpctl health`, `erpctl logs cloudflared`, and `erpctl logs web`. In the Tunnel hostname route, confirm the origin is `http://web:5173` and the connector is the Compose cloudflared service on the same project/network.
- **Tunnel shows disconnected:** check outbound DNS and TCP/UDP 7844 policy, token value/rotation, then `docker compose ... logs cloudflared`. Do not open inbound ports as a workaround.
- **Unexpected empty database:** verify the exact `COMPOSE_PROJECT_NAME` was used. Compose project names scope the named PostgreSQL volume; never remove/prune volumes to “fix” this.
- **Readiness says worker unhealthy:** inspect SMTP settings and `auth-worker` logs. A worker heartbeat proves polling, not end-to-end SMTP acceptance; perform a controlled password-reset delivery test.

## References

- [Cloudflare Tunnel firewall and egress requirements](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/) — Tunnel needs outbound TCP or UDP port 7844 depending on transport; no inbound origin listener is needed.
- [Project deployment and activation gates](README.md)
- [Backup and restore runbook](../backups/README.md)
