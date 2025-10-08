#!/usr/bin/env bash
# Edgeberry Device Hub installer (MVP)
# - Installs built artifacts for each microservice to /opt/Edgeberry/devicehub/<service>
# - Installs systemd unit files from config/ (MVP: flat config dir)
# - Reloads and enables services
#
# Usage:
#   sudo bash scripts/deploy-artifacts.sh [ARTIFACTS_DIR] [--force-clean]
# If ARTIFACTS_DIR is omitted, the script will look for dist-artifacts/.
# --force-clean removes persistent certificates and database for clean install.

set -euo pipefail
if [[ "${DEBUG:-}" == "1" ]]; then
  set -x
fi

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "[install] ERROR: This script must be run as root (sudo)." >&2
    echo "[install] Usage: sudo bash scripts/deploy-artifacts.sh [ARTIFACTS_DIR] [--force-clean]" >&2
    exit 1
  fi
}

# Ensure backend service envs are aligned with non-TLS loopback usage and persistent database
configure_service_envs() {
  local ETC_DIR="/etc/Edgeberry/devicehub"
  mkdir -p "$ETC_DIR"
  # Force mqtt:// for provisioning and twin; remove TLS/auth keys that are no longer used
  local files=("$ETC_DIR/provisioning.env" "$ETC_DIR/twin.env" "$ETC_DIR/application.env")
  local f
  for f in "${files[@]}"; do
    # Create file if missing and set URL
    ensure_env_kv "$f" "MQTT_URL" "mqtt://127.0.0.1:1883"
    # Set persistent database location
    ensure_env_kv "$f" "DEVICEHUB_DB" "$PERSISTENT_DB"
    # Remove obsolete or conflicting keys
    # Remove obsolete TLS and auth keys (use grep -v for safer removal)
    if [[ -f "$f" ]]; then
      grep -vE '^\s*(MQTT_TLS_CA|MQTT_TLS_CERT|MQTT_TLS_KEY|MQTT_TLS_REJECT_UNAUTHORIZED|MQTT_USERNAME|MQTT_PASSWORD)\s*=' "$f" > "$f.tmp" 2>/dev/null || cp "$f" "$f.tmp"
      mv "$f.tmp" "$f"
    fi
  done
  
  # Core service environment
  local core_env="$ETC_DIR/core.env"
  ensure_env_kv "$core_env" "DEVICEHUB_DB" "$PERSISTENT_DB"
  
  # Application service environment
  local app_env="$ETC_DIR/application.env"
  ensure_env_kv "$app_env" "DEVICEHUB_DB" "$PERSISTENT_DB"
  ensure_env_kv "$app_env" "MQTT_URL" "mqtt://127.0.0.1:1883"
  ensure_env_kv "$app_env" "APPLICATION_PORT" "8090"
}

# Create or update key=value in an env file idempotently
ensure_env_kv() {
  local file="$1"; local key="$2"; local val="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  chmod 0644 "$file" || true
  if grep -qE "^#?\s*${key}=.*$" "$file" 2>/dev/null; then
    # Replace existing line (escape special chars in val)
    local escaped_val
    escaped_val="$(printf '%s\n' "$val" | sed 's/[[\.*^$()+?{|]/\\&/g')"
    sed -i -E "s|^#?\s*${key}=.*$|${key}=${escaped_val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

# (Removed) provisioning HTTP helper functions

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
  # Build tools are required for native modules like better-sqlite3 on ARM (Raspberry Pi)
  # Install a minimal toolchain if missing
  if ! have_cmd make || ! have_cmd g++ ; then need_pkgs+=(build-essential); fi
  if ! have_cmd python3; then need_pkgs+=(python3); fi
  if (( ${#need_pkgs[@]} > 0 )); then
    log "installing missing runtime dependencies: ${need_pkgs[*]}"
    apt_install "${need_pkgs[@]}"
    # Re-check and warn if still missing
    for c in node npm rsync tar gzip make g++ python3; do
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

# Skip npm install since node_modules are included in artifacts
# But rebuild native modules for the target platform
install_node_deps() {
  local services=(core-service provisioning-service twin-service)
  services+=(application-service)
  local svc dir
  for svc in "${services[@]}"; do
    dir="${INSTALL_ROOT}/${svc}"
    if [[ -f "${dir}/package.json" ]]; then
      if [[ -d "${dir}/node_modules" ]]; then
        local module_count=$(find "${dir}/node_modules" -maxdepth 1 -type d | wc -l)
        log "${svc}: node_modules present with $module_count modules (pre-installed)"
        
        # Rebuild native modules if needed
        pushd "${dir}" >/dev/null
        # Always rebuild all native modules to ensure compatibility
        log "${svc}: rebuilding native modules for target architecture..."
        if ! npm rebuild 2>&1 | tail -n 5; then
          log "ERROR: ${svc}: failed to rebuild native modules - service may not start"
        else
          log "${svc}: native modules rebuilt successfully"
        fi
        popd >/dev/null
      else
        log "WARN: ${svc}: node_modules missing, service may not start"
      fi
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
DATA_DIR="/var/lib/edgeberry/devicehub"

# Allowed top-level directories inside the combined artifact
ALLOWED_NAMES=(
  ui
  core-service
  provisioning-service
  twin-service
  application-service
  config
  scripts
)

log() { echo "[install] $*" >&2; }

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
  
  # Check if artifacts are already extracted (direct directory structure)
  local found_extracted=0
  for an in "${ALLOWED_NAMES[@]}"; do
    if [[ -d "$ART_DIR/$an" ]]; then
      found_extracted=1
      break
    fi
  done
  
  if [[ $found_extracted -eq 1 ]]; then
    log "using pre-extracted artifacts from $ART_DIR"
    # Install each allowed directory directly from ART_DIR
    for an in "${ALLOWED_NAMES[@]}"; do
      if [[ -d "$ART_DIR/$an" ]]; then
        rm -rf "${INSTALL_ROOT}/${an}"
        mkdir -p "${INSTALL_ROOT}/${an}"
        rsync -a "$ART_DIR/$an/" "${INSTALL_ROOT}/${an}/"
        # Fix ownership and permissions for extracted files
        chown -R root:root "${INSTALL_ROOT}/${an}"
        # Ensure config files are readable
        if [[ "$an" == "config" ]]; then
          find "${INSTALL_ROOT}/${an}" -type f -name "*.acl" -exec chmod 644 {} \;
          find "${INSTALL_ROOT}/${an}" -type f -name "*.conf" -exec chmod 644 {} \;
        fi
        log "installed to ${INSTALL_ROOT}/${an}"
      fi
    done
    # chmod +x scripts/*.sh if present so diagnostics script runs
    if [[ -d "${INSTALL_ROOT}/scripts" ]]; then
      chmod +x "${INSTALL_ROOT}/scripts"/*.sh || true
    fi
  else
    # Original tarball extraction logic
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
  fi
}

ensure_data_dir() {
  # Ensure persistent data directory exists with strict permissions
  mkdir -p "$DATA_DIR"
  chmod 0750 "$DATA_DIR" || true
}

install_systemd_units() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping unit installation"
    return 0
  fi
  log "installing systemd unit files"
  # Install systemd units
  for unit in \
    devicehub-core.service \
    devicehub-provisioning.service \
    devicehub-twin.service \
    devicehub-application.service \
    edgeberry-ca-rehash.service \
    edgeberry-ca-rehash.path \
    edgeberry-cert-sync.service \
    edgeberry-cert-sync.path; do
    if [[ -f "${ROOT_DIR}/config/${unit}" ]]; then
      install -m 0644 "${ROOT_DIR}/config/${unit}" "${SYSTEMD_DIR}/${unit}"
      log "installed ${SYSTEMD_DIR}/${unit}"
    else
      log "WARN: missing ${ROOT_DIR}/config/${unit}"
    fi
  done
  systemctl_safe daemon-reload || true

  # Install D-Bus system service and policy files
  local DBUS_SYSTEM_SERVICES_DIR="/usr/share/dbus-1/system-services"
  local DBUS_SYSTEM_POLICY_DIR="/etc/dbus-1/system.d"
  
  # Core service D-Bus files
  local DBUS_SERVICE_SRC="${ROOT_DIR}/config/dbus-io.edgeberry.devicehub.Core.service"
  local DBUS_POLICY_SRC="${ROOT_DIR}/config/dbus-io.edgeberry.devicehub.Core.conf"
  if [[ -f "$DBUS_SERVICE_SRC" ]]; then
    mkdir -p "$DBUS_SYSTEM_SERVICES_DIR"
    install -m 0644 "$DBUS_SERVICE_SRC" "$DBUS_SYSTEM_SERVICES_DIR/io.edgeberry.devicehub.Core.service"
    log "installed D-Bus system service: $DBUS_SYSTEM_SERVICES_DIR/io.edgeberry.devicehub.Core.service"
  else
    log "WARN: missing $DBUS_SERVICE_SRC"
  fi
  if [[ -f "$DBUS_POLICY_SRC" ]]; then
    mkdir -p "$DBUS_SYSTEM_POLICY_DIR"
    install -m 0644 "$DBUS_POLICY_SRC" "$DBUS_SYSTEM_POLICY_DIR/io.edgeberry.devicehub.Core.conf"
    log "installed D-Bus policy: $DBUS_SYSTEM_POLICY_DIR/io.edgeberry.devicehub.Core.conf"
  else
    log "WARN: missing $DBUS_POLICY_SRC"
  fi
  
  # Twin service D-Bus files
  local TWIN_DBUS_SERVICE_SRC="${ROOT_DIR}/config/dbus-io.edgeberry.devicehub.Twin.service"
  local TWIN_DBUS_POLICY_SRC="${ROOT_DIR}/config/dbus-io.edgeberry.devicehub.Twin.conf"
  if [[ -f "$TWIN_DBUS_SERVICE_SRC" ]]; then
    mkdir -p "$DBUS_SYSTEM_SERVICES_DIR"
    install -m 0644 "$TWIN_DBUS_SERVICE_SRC" "$DBUS_SYSTEM_SERVICES_DIR/io.edgeberry.devicehub.Twin.service"
    log "installed D-Bus system service: $DBUS_SYSTEM_SERVICES_DIR/io.edgeberry.devicehub.Twin.service"
  else
    log "WARN: missing $TWIN_DBUS_SERVICE_SRC"
  fi
  if [[ -f "$TWIN_DBUS_POLICY_SRC" ]]; then
    mkdir -p "$DBUS_SYSTEM_POLICY_DIR"
    install -m 0644 "$TWIN_DBUS_POLICY_SRC" "$DBUS_SYSTEM_POLICY_DIR/io.edgeberry.devicehub.Twin.conf"
    log "installed D-Bus policy: $DBUS_SYSTEM_POLICY_DIR/io.edgeberry.devicehub.Twin.conf"
  else
    log "WARN: missing $TWIN_DBUS_POLICY_SRC"
  fi
}

stop_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping service stop"
    return 0
  fi
  log "stopping services prior to install"
  systemctl_safe stop devicehub-core.service || true
  systemctl_safe stop devicehub-provisioning.service || true
  systemctl_safe stop devicehub-twin.service || true
  systemctl_safe stop devicehub-application.service || true
}

validate_compiled_no_decorators() {
  local dbus_glob="$INSTALL_ROOT/core-service/dist/dbus-*.js"
  shopt -s nullglob
  local files=( $dbus_glob )
  shopt -u nullglob
  if (( ${#files[@]} == 0 )); then
    log "WARN: no dbus-*.js files found under core-service/dist; build may be incomplete"
    return 0
  fi
  if grep -Hn "__decorate" ${files[@]} >/dev/null 2>&1; then
    log "WARN: found TypeScript decorator emit ('__decorate') in compiled dbus files. This build may crash at runtime. Files:"
    grep -Hn "__decorate" ${files[@]} || true
    log "WARN: please ensure sources use imperative dbus method registration (this.addMethod) and rebuild artifacts."
  else
    log "validated: no '__decorate' references in core-service/dist/dbus-*.js"
  fi
}

enable_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping enable"
    return 0
  fi
  log "enabling services"
  systemctl_safe enable devicehub-core.service || true
  systemctl_safe enable devicehub-provisioning.service || true
  systemctl_safe enable devicehub-twin.service || true
  # Enable CA rehash path (auto-reload broker when CA dir changes)
  systemctl_safe enable edgeberry-ca-rehash.path || true
  systemctl_safe enable edgeberry-ca-rehash.service || true
  # Enable certificate sync path (auto-sync persistent certs to broker)
  systemctl_safe enable edgeberry-cert-sync.path || true
  systemctl_safe enable edgeberry-cert-sync.service || true
}

start_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping service restart"
    return 0
  fi
  log "starting services"
  systemctl_safe restart devicehub-core.service || true
  systemctl_safe restart devicehub-provisioning.service || true
  systemctl_safe restart devicehub-twin.service || true
  systemctl_safe restart devicehub-application.service || true
  # Start path units to monitor certificate changes
  if ! systemctl_safe start edgeberry-ca-rehash.path; then
    log "WARN: failed to start edgeberry-ca-rehash.path; dumping recent logs"
    journalctl -u edgeberry-ca-rehash.path -n 50 --no-pager 2>/dev/null | tail -n 50 || true
  fi
  if ! systemctl_safe start edgeberry-cert-sync.path; then
    log "WARN: failed to start edgeberry-cert-sync.path; dumping recent logs"
    journalctl -u edgeberry-cert-sync.path -n 50 --no-pager 2>/dev/null | tail -n 50 || true
  fi
}

configure_mosquitto() {
  if ! command -v mosquitto >/dev/null 2>&1; then
    log "Mosquitto broker missing; installing"
    apt_install mosquitto
  fi
  if command -v mosquitto >/dev/null 2>&1; then
    log "configuring Mosquitto"
    # Ensure a main config exists and includes conf.d snippets
    if [[ ! -f /etc/mosquitto/mosquitto.conf ]]; then
      cat > /etc/mosquitto/mosquitto.conf <<'EOF'
# Generated by Edgeberry installer (minimal base config)
persistence true
EOF
    fi
    mkdir -p /etc/mosquitto/conf.d
    
    # Source files from persistent certificate storage (primary) with fallback to build artifacts
    local PERSISTENT_CA="$PERSISTENT_CERTS_DIR/ca.crt"
    local PERSISTENT_CERT="$PERSISTENT_CERTS_DIR/server.crt"
    local PERSISTENT_KEY="$PERSISTENT_CERTS_DIR/server.key"
    local SRC_CA="${PERSISTENT_CA}"
    local SRC_CERT="${PERSISTENT_CERT}"
    local SRC_KEY="${PERSISTENT_KEY}"
    local SRC_ACL="$INSTALL_ROOT/config/mosquitto.acl"

    # Fallback to build artifacts if persistent certificates don't exist (first install)
    [[ -f "$SRC_CA" ]] || SRC_CA="$INSTALL_ROOT/config/certs/ca.crt"
    [[ -f "$SRC_CERT" ]] || SRC_CERT="$INSTALL_ROOT/config/certs/server.crt"
    [[ -f "$SRC_KEY" ]] || SRC_KEY="$INSTALL_ROOT/config/certs/server.key"

    # Warn if any certificates are missing
    [[ -f "$SRC_CA" ]] || log "WARN: missing CA file: $SRC_CA"
    [[ -f "$SRC_CERT" ]] || log "WARN: missing server cert: $SRC_CERT"
    [[ -f "$SRC_KEY" ]] || log "WARN: missing server key: $SRC_KEY"
    [[ -f "$SRC_ACL" ]] || log "WARN: missing ACL file: $SRC_ACL"

    # Install runtime copies under /etc/mosquitto (AppArmor allows access here)
    mkdir -p /etc/mosquitto/certs /etc/mosquitto/acl.d
    local ETC_CA="/etc/mosquitto/certs/ca.crt"
    local ETC_CA_DIR="/etc/mosquitto/certs/edgeberry-ca.d"
    local ETC_CERT="/etc/mosquitto/certs/server.crt"
    local ETC_KEY="/etc/mosquitto/certs/server.key"
    local ETC_ACL="/etc/mosquitto/acl.d/edgeberry.acl"

    if [[ -f "$SRC_CA" ]]; then 
        install -m 0640 "$SRC_CA" "$ETC_CA"
        log "installed CA certificate: $ETC_CA"
    fi
    if [[ -f "$SRC_CERT" ]]; then 
        install -m 0640 "$SRC_CERT" "$ETC_CERT"
        log "installed server certificate: $ETC_CERT"
    fi
    if [[ -f "$SRC_KEY" ]]; then 
        install -m 0640 "$SRC_KEY" "$ETC_KEY"
        log "installed server key: $ETC_KEY"
    fi
    if [[ -f "$SRC_ACL" ]]; then 
        install -m 0644 "$SRC_ACL" "$ETC_ACL"
        log "installed ACL file: $ETC_ACL"
    else
        log "ERROR: ACL file not found, cannot install to $ETC_ACL"
    fi

    mkdir -p "$ETC_CA_DIR"
    # Ensure operator-provided CA trust directory exists
    mkdir -p "$ETC_DIR/ca-trust"
    [[ -f "$SRC_CA" ]] && cp -f "$SRC_CA" "$ETC_CA_DIR/ca.crt" || true
    # Allow operator-provided CA roots from /etc/Edgeberry/devicehub/ca-trust
    if [[ -d "$ETC_DIR/ca-trust" ]]; then
      shopt -s nullglob
      for cert in "$ETC_DIR/ca-trust"/*.crt; do
        [[ -f "$cert" ]] || continue
        cp -f "$cert" "$ETC_CA_DIR/"
      done
      shopt -u nullglob
    fi
    c_rehash "$ETC_CA_DIR" || openssl rehash "$ETC_CA_DIR" || true

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

    # Deploy our packaged mosquitto.conf into conf.d; fallback to generated minimal config
    if [[ -f "${ROOT_DIR}/config/mosquitto.conf" ]]; then
      install -m 0644 "${ROOT_DIR}/config/mosquitto.conf" \
        /etc/mosquitto/conf.d/edgeberry.conf
    else
      # Fallback minimal config matching runtime paths
      cat > /etc/mosquitto/conf.d/edgeberry.conf <<EOF
# Edgeberry Device Hub (installed fallback) — listeners

# Use per-listener settings so we can have separate auth/ACLs
per_listener_settings true

# Local backend listener (no TLS, localhost-only)
listener 1883 127.0.0.1
allow_anonymous true

# Device listener (mTLS on 8883)
listener 8883 0.0.0.0
allow_anonymous false

# TLS
capath ${ETC_CA_DIR}
certfile $ETC_CERT
keyfile $ETC_KEY

# mTLS auth mapping
require_certificate true
use_subject_as_username true

# ACLs for device listener
acl_file $ETC_ACL
EOF
    fi

    # Validate broker configuration (best-effort):
    # If mosquitto service is inactive, try a short foreground start and capture output; otherwise rely on journal after restart.
    if command -v mosquitto >/dev/null 2>&1; then
      if have_systemd && systemctl is-active --quiet mosquitto; then
        : # active; skip direct validation to avoid port conflicts
      else
        # Attempt foreground start for 1s to catch config errors, then terminate
        local _out_file
        _out_file="$(mktemp)"
        ( mosquitto -c /etc/mosquitto/mosquitto.conf -v >"$_out_file" 2>&1 ) & local _mpid=$!
        sleep 1
        if kill -0 "$_mpid" 2>/dev/null; then
          kill "$_mpid" >/dev/null 2>&1 || true
          wait "$_mpid" >/dev/null 2>&1 || true
        fi
        if grep -qiE "error|failed" "$_out_file"; then
          log "ERROR: mosquitto configuration appears invalid. Dumping diagnostics:"
          log "--- mosquitto output ---"
          sed -n '1,200p' "$_out_file"
          log "--- /etc/mosquitto/conf.d/edgeberry.conf ---"
          sed -n '1,200p' /etc/mosquitto/conf.d/edgeberry.conf 2>/dev/null || true
          log "--- ls -l certs and acl ---"
          ls -l "$INSTALL_ROOT/config/certs" 2>/dev/null || true
          ls -l "$INSTALL_ROOT/config/mosquitto.acl" 2>/dev/null || true
        fi
        rm -f "$_out_file" || true
      fi
    fi

    systemctl_safe enable mosquitto || true
    systemctl_safe restart mosquitto || true
  else
    log "WARN: Mosquitto could not be installed automatically."
  fi
}

# Parse command line arguments
parse_args() {
  ART_DIR="${1:-dist-artifacts}"
  FORCE_CLEAN=0
  
  shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force-clean) FORCE_CLEAN=1; shift;;
      *) echo "[install] ERROR: Unknown option: $1" >&2; exit 1;;
    esac
  done
}

# Persistent data management
PERSISTENT_DIR="/var/lib/edgeberry/devicehub"
PERSISTENT_CERTS_DIR="$PERSISTENT_DIR/certs"
PERSISTENT_DB="$PERSISTENT_DIR/devicehub.db"

# Backup and restore persistent certificates and database
backup_persistent_data() {
  local backup_dir="/tmp/edgeberry-backup-$(date +%s)"
  mkdir -p "$backup_dir"
  
  # Backup database
  if [[ -f "$PERSISTENT_DB" ]]; then
    cp "$PERSISTENT_DB" "$backup_dir/devicehub.db"
    log "backed up database to $backup_dir/devicehub.db"
  fi
  
  # Backup certificates
  if [[ -d "$PERSISTENT_CERTS_DIR" ]]; then
    cp -r "$PERSISTENT_CERTS_DIR" "$backup_dir/"
    log "backed up certificates to $backup_dir/certs"
  fi
  
  echo "$backup_dir"
}

restore_persistent_data() {
  local backup_dir="$1"
  
  # Restore database
  if [[ -f "$backup_dir/devicehub.db" ]]; then
    mkdir -p "$(dirname "$PERSISTENT_DB")"
    cp "$backup_dir/devicehub.db" "$PERSISTENT_DB"
    chown root:root "$PERSISTENT_DB"
    chmod 0640 "$PERSISTENT_DB"
    log "restored database from backup"
  fi
  
  # Restore certificates
  if [[ -d "$backup_dir/certs" ]]; then
    mkdir -p "$PERSISTENT_CERTS_DIR"
    cp -r "$backup_dir/certs/"* "$PERSISTENT_CERTS_DIR/"
    chown -R root:root "$PERSISTENT_CERTS_DIR"
    chmod -R 0640 "$PERSISTENT_CERTS_DIR"
    log "restored certificates from backup"
  fi
  
  # Clean up backup
  rm -rf "$backup_dir"
}

clean_persistent_data() {
  if [[ $FORCE_CLEAN -eq 1 ]]; then
    log "force clean: removing persistent data"
    rm -rf "$PERSISTENT_DIR"
    rm -rf "/opt/Edgeberry/devicehub/core-service/data"
    rm -rf "/etc/Edgeberry/devicehub"
  fi
}

# Enhanced certificate management with persistence
setup_persistent_certificates() {
  mkdir -p "$PERSISTENT_CERTS_DIR"
  
  # Define persistent certificate paths
  local PERSISTENT_CA="$PERSISTENT_CERTS_DIR/ca.crt"
  local PERSISTENT_CA_KEY="$PERSISTENT_CERTS_DIR/ca.key"
  local PERSISTENT_PROV_CERT="$PERSISTENT_CERTS_DIR/provisioning.crt"
  local PERSISTENT_PROV_KEY="$PERSISTENT_CERTS_DIR/provisioning.key"
  local PERSISTENT_SERVER_CERT="$PERSISTENT_CERTS_DIR/server.crt"
  local PERSISTENT_SERVER_KEY="$PERSISTENT_CERTS_DIR/server.key"
  
  # Install root CA (persistent between deployments)
  if [[ ! -f "$PERSISTENT_CA" ]]; then
    # Try to use packaged CA first
    local SRC_CA="$INSTALL_ROOT/config/certs/ca.crt"
    local SRC_CA_KEY="$INSTALL_ROOT/config/certs/ca.key"
    
    if [[ -f "$SRC_CA" && -f "$SRC_CA_KEY" ]]; then
      log "installing packaged Root CA to persistent storage"
      install -m 0640 "$SRC_CA" "$PERSISTENT_CA"
      install -m 0640 "$SRC_CA_KEY" "$PERSISTENT_CA_KEY"
    else
      log "generating new Root CA for persistent storage"
      pushd "$PERSISTENT_CERTS_DIR" >/dev/null
      if openssl genrsa -out ca.key 4096 >/dev/null 2>&1 && \
         openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -subj "/CN=Edgeberry Device Hub Root CA" -out ca.crt >/dev/null 2>&1; then
        log "generated persistent Root CA"
        chmod 0640 ca.crt ca.key
      else
        log "ERROR: failed to generate Root CA"
        exit 1
      fi
      popd >/dev/null
    fi
  else
    log "using existing persistent Root CA"
  fi
  
  # Generate provisioning certificate if missing
  if [[ ! -f "$PERSISTENT_PROV_CERT" ]]; then
    log "generating provisioning certificate"
    pushd "$PERSISTENT_CERTS_DIR" >/dev/null
    if openssl genrsa -out provisioning.key 2048 >/dev/null 2>&1 && \
       openssl req -new -key provisioning.key -subj "/CN=Edgeberry Provisioning Client" -out provisioning.csr >/dev/null 2>&1 && \
       openssl x509 -req -in provisioning.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out provisioning.crt -days 825 -sha256 >/dev/null 2>&1; then
      log "generated provisioning certificate"
      chmod 0640 provisioning.crt provisioning.key
      rm -f provisioning.csr
    else
      log "ERROR: failed to generate provisioning certificate"
      exit 1
    fi
    popd >/dev/null
  fi
  
  # Generate server certificate if missing
  if [[ ! -f "$PERSISTENT_SERVER_CERT" ]]; then
    log "generating server certificate"
    pushd "$PERSISTENT_CERTS_DIR" >/dev/null
    local PRIMARY_IP
    PRIMARY_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    
    # Create server certificate with SANs
    cat > server.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = $(hostname -f 2>/dev/null || echo "devicehub.local")
IP.1 = 127.0.0.1
IP.2 = ${PRIMARY_IP:-192.168.1.1}
EOF
    
    if openssl genrsa -out server.key 2048 >/dev/null 2>&1 && \
       openssl req -new -key server.key -subj "/CN=Edgeberry Device Hub Server" -out server.csr >/dev/null 2>&1 && \
       openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 825 -sha256 -extfile server.ext >/dev/null 2>&1; then
      log "generated server certificate with SANs"
      chmod 0640 server.crt server.key
      rm -f server.csr server.ext
    else
      log "ERROR: failed to generate server certificate"
      exit 1
    fi
    popd >/dev/null
  fi
  
  # Copy persistent certificates to install locations
  mkdir -p "$INSTALL_ROOT/config/certs"
  cp "$PERSISTENT_CA" "$INSTALL_ROOT/config/certs/ca.crt"
  cp "$PERSISTENT_CA_KEY" "$INSTALL_ROOT/config/certs/ca.key"
  cp "$PERSISTENT_PROV_CERT" "$INSTALL_ROOT/config/certs/provisioning.crt"
  cp "$PERSISTENT_PROV_KEY" "$INSTALL_ROOT/config/certs/provisioning.key"
  cp "$PERSISTENT_SERVER_CERT" "$INSTALL_ROOT/config/certs/server.crt"
  cp "$PERSISTENT_SERVER_KEY" "$INSTALL_ROOT/config/certs/server.key"
  
  # Sync to core-service data directory
  mkdir -p "$INSTALL_ROOT/core-service/data/certs/root"
  cp "$PERSISTENT_CA" "$INSTALL_ROOT/core-service/data/certs/root/ca.crt"
  cp "$PERSISTENT_CA_KEY" "$INSTALL_ROOT/core-service/data/certs/root/ca.key"
  
  log "persistent certificates configured"
}

main() {
  parse_args "$@"
  require_root
  
  if [[ ! -d "$ART_DIR" ]]; then
    echo "[install] ERROR: artifacts directory not found: $ART_DIR" >&2
    exit 1
  fi
  
  # Handle persistent data
  local backup_dir=""
  if [[ $FORCE_CLEAN -eq 0 ]]; then
    backup_dir=$(backup_persistent_data)
  fi
  
  clean_persistent_data
  
  # Ensure etc directory for service env files exists
  mkdir -p "$ETC_DIR"
  ensure_runtime_deps
  ensure_system_deps
  
  # Stop services before modifying install tree to avoid reading mixed versions
  stop_services
  extract_artifacts
  
  # Restore persistent data if not force clean
  if [[ $FORCE_CLEAN -eq 0 && -n "$backup_dir" ]]; then
    restore_persistent_data "$backup_dir"
  fi
  
  ensure_data_dir
  setup_persistent_certificates
  install_node_deps
  
  # Sanity-check compiled outputs for known hazards
  validate_compiled_no_decorators
  install_systemd_units
  configure_service_envs
  enable_services
  configure_mosquitto
  start_services
  log "installation complete"
}

main "$@"
