#!/usr/bin/env bash
# Edgeberry Device Hub installer (MVP)
# - Installs built artifacts for each microservice to /opt/Edgeberry/devicehub/<service>
# - Installs systemd unit files from config/ (MVP: flat config dir)
# - Reloads and enables services
#
# Usage:
#   sudo bash scripts/install.sh [ARTIFACTS_DIR]
# If ARTIFACTS_DIR is omitted, the script will look for dist-artifacts/.

set -euo pipefail
if [[ "${DEBUG:-}" == "1" ]]; then
  set -x
fi

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "[install] ERROR: This script must be run as root (sudo)." >&2
    exit 1
  fi
}

# --- Runtime dependency checks/install (node, npm, rsync) ---
have_cmd() { command -v "$1" >/dev/null 2>&1; }

APT_UPDATED=0
apt_update_once() {
  if [[ $APT_UPDATED -eq 0 ]] && have_cmd apt-get; then
    log "apt-get update"
    DEBIAN_FRONTEND=noninteractive apt-get update -y || true
    APT_UPDATED=1
  fi
}

apt_install() {
  if have_cmd apt-get; then
    apt_update_once
    local pkgs=("$@")
    if (( ${#pkgs[@]} > 0 )); then
      log "apt-get install -y ${pkgs[*]}"
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${pkgs[@]}" || true
    fi
  else
    log "NOTE: apt-get not found; cannot auto-install: $*"
  fi
}

ensure_runtime_deps() {
  local need_pkgs=()
  if ! have_cmd node; then need_pkgs+=(nodejs); fi
  if ! have_cmd npm; then need_pkgs+=(npm); fi
  if ! have_cmd rsync; then need_pkgs+=(rsync); fi
  if ! have_cmd tar; then need_pkgs+=(tar); fi
  if ! have_cmd gzip; then need_pkgs+=(gzip); fi
  if (( ${#need_pkgs[@]} > 0 )); then
    log "installing missing runtime dependencies: ${need_pkgs[*]}"
    apt_install "${need_pkgs[@]}"
    # Re-check and warn if still missing
    for c in node npm rsync tar gzip; do
      if ! have_cmd "$c"; then
        log "WARN: '$c' is not available after install; proceeding but related features may fail."
      fi
    done
  fi
}

# Ensure system service dependencies (broker, tools)
ensure_system_deps() {
  local pkgs=()
  # MQTT broker
  if ! have_cmd mosquitto; then pkgs+=(mosquitto); fi
  # SQLite CLI (useful for admin/debug; library is bundled via Node module)
  if ! have_cmd sqlite3; then pkgs+=(sqlite3); fi
  # Common TLS roots for outbound requests (if any)
  if ! have_cmd update-ca-certificates && [[ -e /etc/debian_version ]]; then pkgs+=(ca-certificates); fi
  if (( ${#pkgs[@]} > 0 )); then
    log "installing missing system packages: ${pkgs[*]}"
    apt_install "${pkgs[@]}"
  fi
}

# Install Node.js production dependencies for each microservice
install_node_deps() {
  local services=(core-service provisioning-service twin-service registry-service)
  local svc dir
  for svc in "${services[@]}"; do
    dir="${INSTALL_ROOT}/${svc}"
    if [[ -f "${dir}/package.json" ]]; then
      log "npm install (prod) in ${dir}"
      pushd "${dir}" >/dev/null
      # Prefer npm ci when lockfile exists
      if [[ -f package-lock.json ]]; then
        if [[ "${DEBUG:-}" == "1" ]]; then
          npm ci --omit=dev || npm install --omit=dev || true
        else
          npm ci --omit=dev --silent || npm install --omit=dev --silent || true
        fi
      else
        if [[ "${DEBUG:-}" == "1" ]]; then
          npm install --omit=dev || true
        else
          npm install --omit=dev --silent || true
        fi
      fi
      popd >/dev/null
    else
      log "skip ${svc}: no package.json"
    fi
  done
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="${1:-${ROOT_DIR}/dist-artifacts}"
INSTALL_ROOT="/opt/Edgeberry/devicehub"
SYSTEMD_DIR="/etc/systemd/system"
ETC_DIR="/etc/Edgeberry/devicehub"

# Allowed top-level directories inside the combined artifact
ALLOWED_NAMES=(
  ui
  core-service
  provisioning-service
  twin-service
  registry-service
  config
  scripts
)

log() { echo "[install] $*"; }

have_systemd() {
  command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]
}

systemctl_safe() {
  local cmd=(systemctl "$@")
  if have_systemd; then
    if ! "${cmd[@]}"; then
      log "WARN: systemctl ${*} failed"
      return 1
    fi
  else
    log "NOTE: systemd not available; skipping: systemctl ${*}"
    return 1
  fi
}

extract_artifacts() {
  mkdir -p "$INSTALL_ROOT"
  # Cleanup unexpected directories from previous faulty installs
  if [[ -d "$INSTALL_ROOT" ]]; then
    local entry allowed
    shopt -s dotglob nullglob
    for entry in "$INSTALL_ROOT"/*; do
      local base
      base="$(basename "$entry")"
      allowed=0
      for an in "${ALLOWED_NAMES[@]}"; do
        if [[ "$base" == "$an" ]]; then allowed=1; break; fi
      done
      if [[ $allowed -eq 0 ]]; then
        log "WARN: removing unexpected entry from install root: $base"
        rm -rf --one-file-system -- "$entry" || true
      fi
    done
    shopt -u dotglob nullglob
  fi
  shopt -s nullglob
  local tar
  for tar in "$ART_DIR"/devicehub-*.tar.gz; do
    [[ -e "$tar" ]] || continue
    log "extract $tar"
    # Create a temporary staging directory and extract
    local tmp
    tmp="$(mktemp -d)"
    # Configure tar extraction verbosity based on DEBUG
    if [[ "${DEBUG:-}" == "1" ]]; then
      # Prefer GNU tar checkpoint dots; fallback to verbose if unsupported
      if tar --help 2>/dev/null | grep -q -- '--checkpoint'; then
        tar -C "$tmp" -xzf "$tar" --checkpoint=.500 --checkpoint-action=dot
        echo ""  # newline after dots
      else
        tar -C "$tmp" -xvzf "$tar"
      fi
    else
      tar -C "$tmp" -xzf "$tar"
    fi
    # Install each first-level directory from the archive
    local d name
    while IFS= read -r -d '' d; do
      name="$(basename "$d")"
      # Only install directories we explicitly allow
      if [[ -d "$d" ]]; then
        local allowed=0
        for an in "${ALLOWED_NAMES[@]}"; do
          if [[ "$name" == "$an" ]]; then allowed=1; break; fi
        done
        if [[ $allowed -eq 1 ]]; then
          rm -rf "${INSTALL_ROOT}/${name}"
          mkdir -p "${INSTALL_ROOT}/${name}"
          rsync -a "$d/" "${INSTALL_ROOT}/${name}/"
          log "installed to ${INSTALL_ROOT}/${name}"
        else
          log "WARN: skipping unexpected top-level entry: $name"
        fi
      fi
    done < <(find "$tmp" -mindepth 1 -maxdepth 1 -type d -print0)
    rm -rf "$tmp"
    # chmod +x scripts/*.sh if present so diagnostics script runs
    if [[ -d "${INSTALL_ROOT}/scripts" ]]; then
      chmod +x "${INSTALL_ROOT}/scripts"/*.sh || true
    fi
  done
}

install_systemd_units() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping unit installation"
    return 0
  fi
  log "installing systemd unit files"
  local unit
  for unit in \
    devicehub-core.service \
    devicehub-api.service \
    devicehub-provisioning.service \
    devicehub-twin.service \
    devicehub-registry.service; do
    if [[ -f "${ROOT_DIR}/config/${unit}" ]]; then
      install -m 0644 "${ROOT_DIR}/config/${unit}" "${SYSTEMD_DIR}/${unit}"
      log "installed ${SYSTEMD_DIR}/${unit}"
    else
      log "WARN: missing ${ROOT_DIR}/config/${unit}"
    fi
  done
  systemctl_safe daemon-reload || true
}

enable_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping enable"
    return 0
  fi
  log "enabling services"
  systemctl_safe enable devicehub-core.service || true
  systemctl_safe enable devicehub-api.service || true
  systemctl_safe enable devicehub-provisioning.service || true
  systemctl_safe enable devicehub-twin.service || true
  systemctl_safe enable devicehub-registry.service || true
}

start_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping service restart"
    return 0
  fi
  log "starting services"
  systemctl_safe restart devicehub-core.service || true
  systemctl_safe restart devicehub-api.service || true
  systemctl_safe restart devicehub-provisioning.service || true
  systemctl_safe restart devicehub-twin.service || true
  systemctl_safe restart devicehub-registry.service || true
}

configure_mosquitto() {
  if ! command -v mosquitto >/dev/null 2>&1; then
    log "Mosquitto broker missing; installing"
    apt_install mosquitto
  fi
  if command -v mosquitto >/dev/null 2>&1; then
    log "configuring Mosquitto"
    mkdir -p /etc/mosquitto/conf.d
    # Source files packaged with the app
    local SRC_CA="$INSTALL_ROOT/config/certs/ca.crt"
    local SRC_CERT="$INSTALL_ROOT/config/certs/server.crt"
    local SRC_KEY="$INSTALL_ROOT/config/certs/server.key"
    local SRC_ACL="$INSTALL_ROOT/config/mosquitto.acl"

    # Warn if any are missing
    [[ -f "$SRC_CA" ]] || log "WARN: missing CA file: $SRC_CA"
    [[ -f "$SRC_CERT" ]] || log "WARN: missing server cert: $SRC_CERT"
    [[ -f "$SRC_KEY" ]] || log "WARN: missing server key: $SRC_KEY"
    [[ -f "$SRC_ACL" ]] || log "WARN: missing ACL file: $SRC_ACL"

    # Install runtime copies under /etc/mosquitto (AppArmor allows access here)
    mkdir -p /etc/mosquitto/certs /etc/mosquitto/acl.d
    local ETC_CA="/etc/mosquitto/certs/ca.crt"
    local ETC_CERT="/etc/mosquitto/certs/server.crt"
    local ETC_KEY="/etc/mosquitto/certs/server.key"
    local ETC_ACL="/etc/mosquitto/acl.d/edgeberry.acl"

    if [[ -f "$SRC_CA" ]]; then install -m 0640 "$SRC_CA" "$ETC_CA"; fi
    if [[ -f "$SRC_CERT" ]]; then install -m 0640 "$SRC_CERT" "$ETC_CERT"; fi
    if [[ -f "$SRC_KEY" ]]; then install -m 0640 "$SRC_KEY" "$ETC_KEY"; fi
    if [[ -f "$SRC_ACL" ]]; then install -m 0644 "$SRC_ACL" "$ETC_ACL"; fi

    if id -u mosquitto >/dev/null 2>&1; then
      chown root:mosquitto "$ETC_CA" "$ETC_CERT" "$ETC_KEY" 2>/dev/null || true
    fi

    # Ensure persistence directory exists with correct ownership (common failure)
    mkdir -p /var/lib/mosquitto
    if id -u mosquitto >/dev/null 2>&1; then
      chown mosquitto:mosquitto /var/lib/mosquitto || true
    fi

    # Remove any prior Device Hub mosquitto snippets to avoid duplicates
    rm -f /etc/mosquitto/conf.d/devicehub.conf /etc/mosquitto/conf.d/edgeberry.conf || true

    # Write a dedicated conf.d file that references our installed paths (minimal to avoid dupes)
    cat > /etc/mosquitto/conf.d/edgeberry.conf <<EOF
# Edgeberry Device Hub (installed) — mTLS listener
listener 8883 0.0.0.0
allow_anonymous false

# TLS
cafile $ETC_CA
certfile $ETC_CERT
keyfile $ETC_KEY

# mTLS auth mapping
require_certificate true
use_subject_as_username true

# ACLs
acl_file $ETC_ACL
EOF

    # Validate broker configuration before restart to surface clear errors
    if command -v mosquitto >/dev/null 2>&1; then
      if ! mosquitto -c /etc/mosquitto/mosquitto.conf -v -t >/dev/null 2>&1; then
        log "ERROR: mosquitto configuration validation failed. Dumping diagnostics:"
        log "--- /etc/mosquitto/conf.d/edgeberry.conf ---"
        sed -n '1,200p' /etc/mosquitto/conf.d/edgeberry.conf 2>/dev/null || true
        log "--- ls -l certs and acl ---"
        ls -l "$INSTALL_ROOT/config/certs" 2>/dev/null || true
        ls -l "$INSTALL_ROOT/config/mosquitto.acl" 2>/dev/null || true
        log "--- attempting journalctl hint (previous run) ---"
        journalctl -u mosquitto -n 50 --no-pager 2>/dev/null | tail -n 50 || true
      fi
    fi

    systemctl_safe enable mosquitto || true
    systemctl_safe restart mosquitto || true
  else
    log "WARN: Mosquitto could not be installed automatically."
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
  ensure_runtime_deps
  ensure_system_deps
  extract_artifacts
  install_node_deps
  install_systemd_units
  enable_services
  configure_mosquitto
  start_services
  log "installation complete"
}

main "$@"
