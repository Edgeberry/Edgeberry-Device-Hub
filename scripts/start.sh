#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/app"
MOSQ_CONF="${APP_DIR}/config/mosquitto.conf"
LOG_PREFIX="[fleethub]"

SERVICE="${SERVICE:-}"

usage() {
  cat <<EOF
$LOG_PREFIX SERVICE env variable is required to select a single service to run.
Set SERVICE to one of: mosquitto, core-service, api, provisioning-service, twin-service, registry-service
Example:
  docker run --rm -e SERVICE=mosquitto -p 1883:1883 -p 8883:8883 ghcr.io/edgeberry/edgeberry-fleet-hub:TAG
  docker run --rm -e SERVICE=api -p 3000:3000 ghcr.io/edgeberry/edgeberry-fleet-hub:TAG
Note: In production, each service runs as its own systemd unit on the host, per alignment.md.
EOF
}

start_mosquitto() {
  echo "$LOG_PREFIX starting Mosquitto..."
  exec mosquitto -c "$MOSQ_CONF" -v
}

start_node_service() {
  local svc_dir="$1"
  local name="$2"
  if [ ! -f "$svc_dir/package.json" ]; then
    echo "$LOG_PREFIX ERROR: $name not found at $svc_dir (missing package.json)"
    exit 1
  fi
  echo "$LOG_PREFIX starting $name..."
  cd "$svc_dir"
  if npm run -s start >/dev/null 2>&1; then
    exec npm run start
  elif [ -f dist/index.js ]; then
    exec node dist/index.js
  else
    echo "$LOG_PREFIX ERROR: cannot start $name (no start script or dist/index.js)"
    exit 1
  fi
}

case "$SERVICE" in
  mosquitto)
    start_mosquitto
    ;;
  api)
    start_node_service "${APP_DIR}/api" "api"
    ;;
  core-service)
    start_node_service "${APP_DIR}/core-service" "core-service"
    ;;
  provisioning-service)
    start_node_service "${APP_DIR}/provisioning-service" "provisioning-service"
    ;;
  twin-service)
    start_node_service "${APP_DIR}/twin-service" "twin-service"
    ;;
  registry-service)
    start_node_service "${APP_DIR}/registry-service" "registry-service"
    ;;
  "")
    usage
    exit 2
    ;;
  *)
    echo "$LOG_PREFIX ERROR: unknown SERVICE='$SERVICE'"
    usage
    exit 2
    ;;
esac
