#!/usr/bin/env bash
set -euo pipefail
ROOT="${ERP_DIR:-/opt/erp}"
PROJECT_NAME="${1:-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$ROOT/.env" | tail -n 1)}"
PROJECT_NAME="${PROJECT_NAME:-karibu-erp}"
dc=(docker compose --project-name "$PROJECT_NAME" --env-file "$ROOT/.env" -f "$ROOT/docker-compose.prod.yml")

# The application network is intentionally internal; probe services from inside
# their containers rather than relying on a host-published port.
"${dc[@]}" exec -T api node -e "fetch('http://127.0.0.1:3000/api/health/live').then(async r=>{console.log('API live:',r.status,await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error('API live probe failed:',e.message);process.exit(1)})"
"${dc[@]}" exec -T api node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>{console.log('API ready:',r.status,await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error('API ready probe failed:',e.message);process.exit(1)})"
"${dc[@]}" exec -T web node -e "fetch('http://127.0.0.1:5173/api/health/ready').then(async r=>{console.log('Web/API ready:',r.status,await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error('Web probe failed:',e.message);process.exit(1)})"
