#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-}"
if [[ -z "$BASE" ]]; then BASE="http://127.0.0.1:${ERP_WEB_BIND_PORT:-8080}"; fi
for endpoint in /api/health/live /api/health/ready; do
 curl --fail --silent --show-error --max-time 20 "$BASE$endpoint"
 printf '\n'
done
