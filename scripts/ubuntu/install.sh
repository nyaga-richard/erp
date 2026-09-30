#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo on the Ubuntu deployment host.' >&2; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu ]] || { echo 'This installer is for Ubuntu only.' >&2; exit 1; }
apt-get update
apt-get install -y docker.io docker-compose-v2 ca-certificates curl openssl python3
systemctl enable --now docker
install -d -m 0750 /opt/erp
printf '%s\n' 'Install the reviewed release into /opt/erp, create its private .env, then run scripts/ubuntu/erpctl.sh validate.' 'No production credentials or demo users were generated. Docker group membership is not granted automatically.'
