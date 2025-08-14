#!/usr/bin/env bash
# Edgeberry Fleet Hub installer (MVP)
# - Installs built artifacts for each microservice to /opt/Edgeberry/fleethub/<service>
# - Installs systemd unit files from config/ (MVP: flat config dir)
# - Reloads and enables services
#
# Usage:
#   sudo bash scripts/install.sh [ARTIFACTS_DIR]
# If ARTIFACTS_DIR is omitted, the script will look for dist-artifacts/.

set -euo pipefail

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "[install] ERROR: This script must be run as root (sudo)." >&2
    exit 1
  fi
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="${1:-${ROOT_DIR}/dist-artifacts}"
INSTALL_ROOT="/opt/Edgeberry/fleethub"
SYSTEMD_DIR="/etc/systemd/system"
ETC_DIR="/etc/Edgeberry/fleethub"

SERVICES=(
  api
  provisioning-service
  twin-service
  registry-service
)

log() { echo "[install] $*"; }

extract_artifacts() {
  mkdir -p "$INSTALL_ROOT"
  shopt -s nullglob
  local tar
  for tar in "$ART_DIR"/fleethub-*-.tar.gz "$ART_DIR"/fleethub-*.tar.gz; do
    [[ -e "$tar" ]] || continue
    log "extract $tar"
    # Create a temporary staging directory and extract
    local tmp
    tmp="$(mktemp -d)"
    tar -C "$tmp" -xzf "$tar"
    # Determine service directory inside archive (first-level directory)
    local top
    top="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    local name
    name="$(basename "$top")"
    # Install to /opt/Edgeberry/fleethub/<name>
    rm -rf "${INSTALL_ROOT}/${name}"
    mkdir -p "${INSTALL_ROOT}/${name}"
    rsync -a "$top/" "${INSTALL_ROOT}/${name}/"
    rm -rf "$tmp"
    log "installed to ${INSTALL_ROOT}/${name}"
  done
}

install_systemd_units() {
  log "installing systemd unit files"
  local unit
  for unit in \
    fleethub-api.service \
    fleethub-provisioning.service \
    fleethub-twin.service \
    fleethub-registry.service; do
    if [[ -f "${ROOT_DIR}/config/${unit}" ]]; then
      install -m 0644 "${ROOT_DIR}/config/${unit}" "${SYSTEMD_DIR}/${unit}"
      log "installed ${SYSTEMD_DIR}/${unit}"
    else
      log "WARN: missing ${ROOT_DIR}/config/${unit}"
    fi
  done
  systemctl daemon-reload
}

enable_services() {
  log "enabling services"
  systemctl enable fleethub-api.service || true
  systemctl enable fleethub-provisioning.service || true
  systemctl enable fleethub-twin.service || true
  systemctl enable fleethub-registry.service || true
}

start_services() {
  log "starting services"
  systemctl restart fleethub-api.service || true
  systemctl restart fleethub-provisioning.service || true
  systemctl restart fleethub-twin.service || true
  systemctl restart fleethub-registry.service || true
}

configure_mosquitto() {
  if command -v mosquitto >/dev/null 2>&1; then
    log "configuring Mosquitto"
    mkdir -p /etc/mosquitto/conf.d
    if [[ -f "${ROOT_DIR}/config/mosquitto.conf" ]]; then
      install -m 0644 "${ROOT_DIR}/config/mosquitto.conf" /etc/mosquitto/conf.d/fleethub.conf
      systemctl restart mosquitto || true
    else
      log "WARN: config/mosquitto.conf not found; skipping"
    fi
  else
    log "NOTE: Mosquitto not installed. Please install and configure separately."
  fi
}

main() {
  require_root
  if [[ ! -d "$ART_DIR" ]]; then
    echo "[install] ERROR: artifacts directory not found: $ART_DIR" >&2
    exit 1
  fi
  # Ensure etc directory for service env files exists
  mkdir -p "$ETC_DIR"
  extract_artifacts
  install_systemd_units
  enable_services
  configure_mosquitto
  start_services
  log "installation complete"
}

main "$@"
