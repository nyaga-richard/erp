#!/usr/bin/env bash
set -euo pipefail

ROOT="${ERP_DIR:-/opt/erp}"
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo so the production .env is root-owned and private.' >&2; exit 1; }
[[ -f "$ROOT/docker-compose.prod.yml" && -f "$ROOT/.env.example" ]] || { echo "Expected the reviewed ERP release under $ROOT." >&2; exit 1; }
[[ ! -e "$ROOT/.env" ]] || { echo "Refusing to overwrite existing $ROOT/.env; back it up and edit it with sudoedit instead." >&2; exit 1; }
command -v openssl >/dev/null || { echo 'openssl is required.' >&2; exit 1; }

ask(){ local __name="$1" __prompt="$2" __default="$3" __value; read -r -p "$__prompt [$__default]: " __value; printf -v "$__name" '%s' "${__value:-$__default}"; }
ask PROJECT 'Compose project name (isolates this app from other Docker projects)' 'trustedsystems-erp'
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]{1,48}$ ]] || { echo 'Project name must be 2–49 lowercase letters/digits/underscore/hyphen, starting with a letter/digit.' >&2; exit 1; }
ask PORT 'Unused loopback diagnostic port (default chosen for co-hosted services)' '18080'
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || { echo 'Choose an unused TCP port from 1024 through 65535.' >&2; exit 1; }
PORT=$((10#$PORT))
((PORT>=1024 && PORT<=65535)) || { echo 'Choose an unused TCP port from 1024 through 65535.' >&2; exit 1; }
if command -v ss >/dev/null && ss -Hln "sport = :$PORT" 2>/dev/null | grep -q .; then echo "Port $PORT already has a listener; rerun and choose a free port." >&2; exit 1; fi
ask RELEASE 'Immutable ERP image release tag' "trustedsystems-erp-$(date +%Y%m%d)-01"
[[ "$RELEASE" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$ ]] || { echo 'Invalid image release tag.' >&2; exit 1; }
ask ORIGIN 'Public HTTPS origin' 'https://erp.trustedsystems.co.ke'
[[ "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo 'Use a hostname-only HTTPS origin (no path or trailing slash).' >&2; exit 1; }
read -r -p 'Verified SMTP sender (for example Karibu ERP <no-reply@your-domain>): ' SENDER
[[ -n "$SENDER" && "$SENDER" != *$'\n'* && "$SENDER" != *'#'* ]] || { echo 'A valid SMTP sender is required; do not include a newline or #.' >&2; exit 1; }
read -r -s -p 'TLS SMTP URL (use URL-encoded credentials): ' SMTP
printf '\n'
[[ "$SMTP" =~ ^smtps?://[^[:space:]]+$ && "$SMTP" != *'$'* && "$SMTP" != *'#'* ]] || { echo 'Enter a valid smtp:// or smtps:// URL; URL-encode reserved characters and do not use $ or #.' >&2; exit 1; }
read -r -s -p 'Cloudflare Tunnel token (press Enter to add it later in .env): ' TUNNEL
printf '\n'
[[ "$TUNNEL" != *$'\n'* && "$TUNNEL" != *'#'* ]] || { echo 'Invalid Tunnel token format.' >&2; exit 1; }

OWNER_PASSWORD="$(openssl rand -hex 32)"
RUNTIME_PASSWORD="$(openssl rand -hex 32)"
WORKER_PASSWORD="$(openssl rand -hex 32)"
RESET_KEY="$(openssl rand -hex 32)"
BACKUP_KEY="$(openssl rand -hex 32)"
umask 077
{
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$PROJECT"
  printf 'ERP_WEB_BIND_PORT=%s\n' "$PORT"
  printf 'ERP_RELEASE=%s\n' "$RELEASE"
  printf 'POSTGRES_PASSWORD=%s\n' "$OWNER_PASSWORD"
  printf 'RUNTIME_DB_PASSWORD=%s\n' "$RUNTIME_PASSWORD"
  printf 'AUTH_WORKER_DB_PASSWORD=%s\n' "$WORKER_PASSWORD"
  printf 'DATABASE_URL=postgresql://erp_runtime:%s@db:5432/erp\n' "$RUNTIME_PASSWORD"
  printf 'MIGRATION_DATABASE_URL=postgresql://erp_owner:%s@db:5432/erp\n' "$OWNER_PASSWORD"
  printf 'PUBLIC_WEB_ORIGIN=%s\n' "$ORIGIN"
  printf 'RESET_ENCRYPTION_KEY=%s\n' "$RESET_KEY"
  printf 'BACKUP_ENCRYPTION_KEY=%s\n' "$BACKUP_KEY"
  printf 'AUTH_MAIL_MODE=smtp\n'
  printf 'SMTP_URL=%s\n' "$SMTP"
  printf 'SMTP_FROM=%s\n' "$SENDER"
  printf 'TUNNEL_TOKEN=%s\n' "$TUNNEL"
  printf 'NODE_ENV=production\nCOOKIE_SECURE=true\nSESSION_COOKIE_MODE=strict\nENABLE_PREVIEW_MEMORY_SESSION=false\nREQUIRE_AUTH_WORKER=true\nNEXT_TELEMETRY_DISABLED=1\n'
} > "$ROOT/.env"
chmod 0600 "$ROOT/.env"
chown root:root "$ROOT/.env"

TUNNEL_CONFIGURED=false
[[ -n "$TUNNEL" ]] && TUNNEL_CONFIGURED=true
unset OWNER_PASSWORD RUNTIME_PASSWORD WORKER_PASSWORD RESET_KEY BACKUP_KEY SMTP TUNNEL
printf 'Private production configuration created at %s/.env (mode 0600).\n' "$ROOT"
printf 'Project: %s | loopback diagnostic port: %s | public origin: %s\n' "$PROJECT" "$PORT" "$ORIGIN"
printf 'Generated independent database/reset/backup secrets. Their values were not displayed.\n'
[[ "$TUNNEL_CONFIGURED" == true ]] || printf 'Tunnel token is blank; set TUNNEL_TOKEN in .env before starting the cloudflared profile.\n'
