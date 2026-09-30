#!/usr/bin/env bash
set -euo pipefail
ROOT="${ERP_DIR:-/opt/erp}"
cd -- "$ROOT"
[[ -f .env ]] || { echo 'Private .env is required; start from .env.example.' >&2; exit 1; }
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$ROOT/.env" | tail -n 1)}"
PROJECT_NAME="${PROJECT_NAME:-karibu-erp}"
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'COMPOSE_PROJECT_NAME must be lowercase letters, digits, underscores or hyphens.' >&2; exit 1; }
ERP_WEB_BIND_PORT="${ERP_WEB_BIND_PORT:-$(sed -n 's/^ERP_WEB_BIND_PORT=//p' "$ROOT/.env" | tail -n 1)}"
ERP_WEB_BIND_PORT="${ERP_WEB_BIND_PORT:-8080}"
export ERP_WEB_BIND_PORT
dc=(docker compose --project-name "$PROJECT_NAME" --env-file "$ROOT/.env" -f "$ROOT/docker-compose.prod.yml")
deploy(){
 "${dc[@]}" config --quiet
 "${dc[@]}" build
 if "${dc[@]}" ps --status running --services | grep -qx db; then "${dc[@]}" run --rm ops backup-db; fi
 "${dc[@]}" up -d db
 "${dc[@]}" run --rm migrate
 "${dc[@]}" up -d --wait api auth-worker web
 bash "$ROOT/scripts/health-check.sh"
}
start_tunnel(){
 grep -Eq '^TUNNEL_TOKEN=.+$' "$ROOT/.env" || { echo 'TUNNEL_TOKEN is empty; configure the dedicated Cloudflare Tunnel token first.' >&2; exit 1; }
 "${dc[@]}" --profile tunnel up -d --wait cloudflared
}
case "${1:-}" in
 validate) "${dc[@]}" config --quiet ;;
 deploy) deploy ;;
 deploy-tunnel) deploy; start_tunnel ;;
 migrate)  "${dc[@]}" run --rm migrate ;;
 backup) "${dc[@]}" run --rm ops backup-db ;;
 backup-files) "${dc[@]}" run --rm ops backup-files ;;
 restore) [[ $# -eq 3 ]] || { echo 'restore /backups/ARCHIVE erp_restore_NAME' >&2; exit 1; }; "${dc[@]}" run --rm ops restore-db "$2" "$3" --confirm-restore ;;
 health) bash "$ROOT/scripts/health-check.sh" ;;
 logs) "${dc[@]}" logs --tail=200 "${2:-api}" ;;
 restart) "${dc[@]}" restart api auth-worker web; bash "$ROOT/scripts/health-check.sh" ;;
 tunnel) "${dc[@]}" --profile tunnel up -d cloudflared ;;
 bootstrap) "${dc[@]}" --profile onboarding run --rm bootstrap ;;
 rollback)
  [[ $# -eq 2 ]] || { echo 'rollback IMMUTABLE_PREVIOUS_RELEASE (schema-compatible only)' >&2; exit 1; }
  [[ "$2" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 1
  echo 'Application-image rollback only; no database is overwritten. Readiness rejects incompatible migration manifests.'
  ERP_RELEASE="$2" "${dc[@]}" up -d --no-build api auth-worker web
  bash "$ROOT/scripts/health-check.sh"
  ;;
 *) echo 'Usage: erpctl.sh validate|deploy|deploy-tunnel|migrate|bootstrap|backup|backup-files|restore|health|logs|restart|tunnel|rollback' >&2; exit 1 ;;
esac
