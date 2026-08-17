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

# Ensure the service env file is aligned with loopback MQTT and the
# persistent database. One process, one env file.
configure_service_envs() {
  local ETC_DIR="/etc/Edgeberry/devicehub"
  mkdir -p "$ETC_DIR"
  local env_file="$ETC_DIR/devicehub.env"

  # Upgrade path from the 4-process layout: carry the old core.env over
  # (it holds the installer-seeded ADMIN_PASSWORD/JWT_SECRET, which must
  # survive), then drop the other three - they're merged into this one now.
  if [[ ! -f "$env_file" && -f "$ETC_DIR/core.env" ]]; then
    mv "$ETC_DIR/core.env" "$env_file"
    log "migrated core.env -> devicehub.env"
  fi
  rm -f "$ETC_DIR/core.env" "$ETC_DIR/provisioning.env" "$ETC_DIR/twin.env" "$ETC_DIR/application.env"

  ensure_env_kv "$env_file" "MQTT_URL" "mqtt://127.0.0.1:1883"
  ensure_env_kv "$env_file" "DEVICEHUB_DB" "$PERSISTENT_DB"
  ensure_env_kv "$env_file" "TWIN_DB" "$PERSISTENT_DIR/twin.db"
  # JWT session timeout in seconds (default 24 hours = 86400)
  ensure_env_kv "$env_file" "JWT_TTL_SECONDS" "${JWT_TTL_SECONDS:-86400}"
  # Production ports: admin UI/API, and the application interface
  ensure_env_kv "$env_file" "PORT" "3000"
  ensure_env_kv "$env_file" "APPLICATION_PORT" "8090"

  # Remove obsolete TLS/auth keys that are no longer used
  if [[ -f "$env_file" ]]; then
    grep -vE '^\s*(MQTT_TLS_CA|MQTT_TLS_CERT|MQTT_TLS_KEY|MQTT_TLS_REJECT_UNAUTHORIZED|MQTT_USERNAME|MQTT_PASSWORD)\s*=' "$env_file" > "$env_file.tmp" 2>/dev/null || cp "$env_file" "$env_file.tmp"
    mv "$env_file.tmp" "$env_file"
  fi

  # Whitelist enforcement is secure-by-default in code (src/config.ts) -
  # write it explicitly so the deployed env file documents the choice. Only
  # set when absent, so an operator's own ENFORCE_WHITELIST=false is never
  # silently overwritten on redeploy/upgrade.
  if grep -qE '^\s*ENFORCE_WHITELIST\s*=' "$env_file" 2>/dev/null; then
    log "ENFORCE_WHITELIST already set explicitly, leaving as-is"
  else
    echo "ENFORCE_WHITELIST=true" >> "$env_file"
    log "set ENFORCE_WHITELIST=true (default)"
  fi

  # Admin password - write-once. ADMIN_PASSWORD is only ever consulted as a
  # login fallback for before a real users-table row exists (see
  # /api/auth/login and /api/auth/change-password); once an operator changes
  # their password in-app, that DB row takes over and this value is never
  # read again. Only set it here when the installer (scripts/install.sh)
  # actually prompted for/generated one and the key isn't already present,
  # so a redeploy never silently resets a still-in-use admin password.
  if [[ -n "${ADMIN_PASSWORD:-}" ]] && ! grep -qE '^\s*ADMIN_PASSWORD\s*=' "$env_file" 2>/dev/null; then
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> "$env_file"
    log "set initial admin password from installer"
  fi
  # JWT signing secret - write-once, same rationale as ADMIN_PASSWORD above.
  # Left unset, the service falls back to a fixed 'dev-change-me' secret
  # (src/config.ts), which would let anyone forge a valid session for any
  # Device Hub install - always seed a real one.
  if ! grep -qE '^\s*JWT_SECRET\s*=' "$env_file" 2>/dev/null; then
    echo "JWT_SECRET=$(openssl rand -hex 32)" >> "$env_file"
    log "generated JWT_SECRET"
  fi
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

# Skip npm install since node_modules are included in artifacts, but rebuild
# native modules (better-sqlite3) for the target platform/ABI.
install_node_deps() {
  local dir="${INSTALL_ROOT}"
  if [[ ! -f "${dir}/package.json" ]]; then
    log "ERROR: no package.json at ${dir} - artifact incomplete"
    exit 1
  fi
  if [[ ! -d "${dir}/node_modules" ]]; then
    log "ERROR: node_modules missing at ${dir} - artifact incomplete"
    exit 1
  fi

  pushd "${dir}" >/dev/null
  log "rebuilding native modules for target architecture..."
  local rebuild_output
  rebuild_output=$(mktemp)
  if npm rebuild --build-from-source 2>&1 | tee "$rebuild_output"; then
    log "native modules rebuilt successfully"
    rm -f "$rebuild_output"
    popd >/dev/null
  else
    log "ERROR: failed to rebuild native modules"
    log "--- Rebuild output (last 50 lines) ---"
    tail -n 50 "$rebuild_output" || true
    log "--- Node.js version ---"; node --version || true
    log "--- npm version ---"; npm --version || true
    log "--- Python version (required for native builds) ---"; python3 --version || true
    log "--- Compiler availability ---"; which gcc g++ make || true
    rm -f "$rebuild_output"
    popd >/dev/null
    log "FATAL: native module rebuild failed - stopping deployment"
    exit 1
  fi
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/services.sh
source "${ROOT_DIR}/scripts/lib/services.sh"
ART_DIR="${1:-${ROOT_DIR}/dist-artifacts}"
INSTALL_ROOT="/opt/Edgeberry/devicehub"
SYSTEMD_DIR="/etc/systemd/system"
ETC_DIR="/etc/Edgeberry/devicehub"
DATA_DIR="/var/lib/edgeberry/devicehub"

# Allowed top-level directories inside the combined artifact
ALLOWED_NAMES=(
  ui
  dist
  node_modules
  config
  scripts
  # Not shipped in the artifact, but created at install time
  # (setup_persistent_certificates) and written to at runtime - listed so the
  # stale-entry cleanup below doesn't wipe it on every redeploy, which would
  # reset the CRL number sequence (CRL_NUMBER_PATH lives here).
  data
)

# Allowed top-level files (the app now lives at the install root, so its
# package.json/lock ride along beside dist/ and node_modules/)
ALLOWED_FILES=(
  package.json
  package-lock.json
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
      for an in "${ALLOWED_NAMES[@]}" "${ALLOWED_FILES[@]}"; do
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
    # Top-level files (package.json / package-lock.json)
    for af in "${ALLOWED_FILES[@]}"; do
      if [[ -f "$ART_DIR/$af" ]]; then
        install -m 0644 -o root -g root "$ART_DIR/$af" "${INSTALL_ROOT}/${af}"
        log "installed ${INSTALL_ROOT}/${af}"
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
      # Top-level files (package.json / package-lock.json)
      for af in "${ALLOWED_FILES[@]}"; do
        if [[ -f "$tmp/$af" ]]; then
          install -m 0644 -o root -g root "$tmp/$af" "${INSTALL_ROOT}/${af}"
          log "installed ${INSTALL_ROOT}/${af}"
        fi
      done
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
  for unit in "${DEVICEHUB_SERVICE_UNITS[@]}"; do
    if [[ -f "${ROOT_DIR}/config/${unit}" ]]; then
      install -m 0644 "${ROOT_DIR}/config/${unit}" "${SYSTEMD_DIR}/${unit}"
      log "installed ${SYSTEMD_DIR}/${unit}"
    else
      log "WARN: missing ${ROOT_DIR}/config/${unit}"
    fi
  done
  systemctl_safe daemon-reload || true
}

# Upgrade path from the 4-process layout: stop, disable, and remove the old
# per-service units (and the cert-sync/ca-rehash path units, whose job the
# service now does in-process) so they can't keep running against the same
# database and MQTT topics alongside the merged service. Also drops the
# D-Bus activation/policy files, since nothing speaks D-Bus anymore.
remove_legacy_units() {
  if ! have_systemd; then return 0; fi
  local removed=0 unit
  for unit in "${DEVICEHUB_LEGACY_UNITS[@]}"; do
    if [[ -f "${SYSTEMD_DIR}/${unit}" ]]; then
      systemctl stop "$unit" 2>/dev/null || true
      systemctl disable "$unit" 2>/dev/null || true
      rm -f "${SYSTEMD_DIR}/${unit}"
      removed=1
      log "removed legacy unit: ${unit}"
    fi
  done
  rm -f /usr/share/dbus-1/system-services/io.edgeberry.devicehub.Core.service \
        /usr/share/dbus-1/system-services/io.edgeberry.devicehub.Twin.service \
        /usr/share/dbus-1/system-services/io.edgeberry.devicehub.ApplicationService.service \
        /etc/dbus-1/system.d/io.edgeberry.devicehub.Core.conf \
        /etc/dbus-1/system.d/io.edgeberry.devicehub.Twin.conf \
        /etc/dbus-1/system.d/io.edgeberry.devicehub.ApplicationService.conf 2>/dev/null || true
  # Old per-service install trees (the app now lives at the install root)
  rm -rf "${INSTALL_ROOT}/core-service" "${INSTALL_ROOT}/provisioning-service" \
         "${INSTALL_ROOT}/twin-service" "${INSTALL_ROOT}/application-service" 2>/dev/null || true
  if [[ $removed -eq 1 ]]; then
    systemctl_safe daemon-reload || true
  fi
}

install_cli() {
  local src="${ROOT_DIR}/config/devicehub-cli.sh"
  if [[ -f "$src" ]]; then
    install -m 0755 "$src" /usr/local/bin/devicehub
    log "installed CLI: /usr/local/bin/devicehub"
  else
    log "WARN: missing $src; devicehub CLI not installed"
  fi
}

stop_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping service stop"
    return 0
  fi
  log "stopping services prior to install"
  for unit in "${DEVICEHUB_SERVICE_UNITS[@]}"; do
    systemctl_safe stop "$unit" || true
  done
}

validate_build() {
  if [[ ! -f "$INSTALL_ROOT/dist/index.js" ]]; then
    log "FATAL: $INSTALL_ROOT/dist/index.js missing - build/artifact is incomplete"
    exit 1
  fi
  log "validated: dist/index.js present"
}

enable_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping enable"
    return 0
  fi
  log "enabling services"
  for unit in "${DEVICEHUB_SERVICE_UNITS[@]}"; do
    systemctl_safe enable "$unit" || true
  done
}

start_services() {
  if ! have_systemd; then
    log "NOTE: systemd not available; skipping service restart"
    return 0
  fi
  log "starting services"
  for unit in "${DEVICEHUB_SERVICE_UNITS[@]}"; do
    systemctl_safe restart "$unit" || true
  done
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

    # mosquitto.conf references crlfile unconditionally (see config/mosquitto.conf) -
    # if that path does not exist, mosquitto refuses to start. The Device Hub normally
    # publishes the real CRL itself (certs.ts ensureCRLExists/regenerateCRL) once it
    # first runs, but on a fresh install mosquitto may start before that ever
    # happens, so seed an initial empty one (nothing revoked yet, still a valid CRL)
    # here as a safety net.
    local ETC_CRL="/etc/mosquitto/certs/crl.pem"
    local PERSISTENT_CRL="$PERSISTENT_CERTS_DIR/crl.pem"
    local PERSISTENT_CA_KEY="$PERSISTENT_CERTS_DIR/ca.key"
    if [[ -f "$PERSISTENT_CRL" ]]; then
        install -m 0640 "$PERSISTENT_CRL" "$ETC_CRL"
        log "installed CRL: $ETC_CRL"
    elif [[ ! -f "$ETC_CRL" && -f "$SRC_CA" && -f "$PERSISTENT_CA_KEY" ]]; then
        local CRL_WORK_DIR; CRL_WORK_DIR=$(mktemp -d)
        : > "$CRL_WORK_DIR/index.txt"
        echo 01 > "$CRL_WORK_DIR/crlnumber"
        cat > "$CRL_WORK_DIR/openssl.cnf" <<EOF
[ca]
default_ca = CA_default
[CA_default]
database = $CRL_WORK_DIR/index.txt
certificate = $SRC_CA
private_key = $PERSISTENT_CA_KEY
crlnumber = $CRL_WORK_DIR/crlnumber
default_crl_days = 30
default_md = sha256
EOF
        if openssl ca -config "$CRL_WORK_DIR/openssl.cnf" -gencrl -out "$ETC_CRL" >/dev/null 2>&1; then
            mkdir -p "$PERSISTENT_CERTS_DIR"
            cp "$ETC_CRL" "$PERSISTENT_CRL"
            cp "$CRL_WORK_DIR/crlnumber" "$PERSISTENT_CERTS_DIR/crlnumber"
            log "generated initial empty CRL: $ETC_CRL"
        else
            log "WARN: failed to generate initial CRL; mosquitto will fail to start until the Device Hub publishes one"
        fi
        rm -rf "$CRL_WORK_DIR"
    elif [[ ! -f "$ETC_CRL" ]]; then
        log "WARN: no CA key available yet to seed an initial CRL; mosquitto will fail to start until the Device Hub publishes one"
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
      chown root:mosquitto "$ETC_CA" "$ETC_CERT" "$ETC_KEY" "$ETC_CRL" 2>/dev/null || true
      # Ensure CA directory and all contents are readable by mosquitto group
      chown -R root:mosquitto "$ETC_CA_DIR" 2>/dev/null || true
      chmod -R 640 "$ETC_CA_DIR"/* 2>/dev/null || true
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

# Certificate Revocation List (see config/mosquitto.conf for the full rationale)
crlfile $ETC_CRL
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
    rm -rf "/opt/Edgeberry/devicehub/data"
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
    local FQDN
    FQDN="$(hostname -f 2>/dev/null || echo 'devicehub.local')"
    
    # Create server certificate with SANs
    # Include DEVICEHUB_DOMAIN environment variable if set (for production domains)
    cat > server.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = $FQDN
IP.1 = 127.0.0.1
IP.2 = ${PRIMARY_IP:-192.168.1.1}
EOF
    
    # Add custom domain if DEVICEHUB_DOMAIN is set (e.g., devicehub.edgeberry.io)
    if [[ -n "${DEVICEHUB_DOMAIN:-}" ]]; then
      echo "DNS.3 = $DEVICEHUB_DOMAIN" >> server.ext
      log "including custom domain in server certificate: $DEVICEHUB_DOMAIN"
    fi
    
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
  
  # Sync to the service's own data directory (CERTS_DIR defaults to
  # <WorkingDirectory>/data/certs - see src/config.ts)
  mkdir -p "$INSTALL_ROOT/data/certs/root"
  mkdir -p "$INSTALL_ROOT/data/certs/provisioning"
  cp "$PERSISTENT_CA" "$INSTALL_ROOT/data/certs/root/ca.crt"
  cp "$PERSISTENT_CA_KEY" "$INSTALL_ROOT/data/certs/root/ca.key"
  cp "$PERSISTENT_PROV_CERT" "$INSTALL_ROOT/data/certs/provisioning/provisioning.crt"
  cp "$PERSISTENT_PROV_KEY" "$INSTALL_ROOT/data/certs/provisioning/provisioning.key"

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
  # Tear down the previous 4-process layout, if this is an upgrade
  remove_legacy_units
  extract_artifacts

  # Restore persistent data if not force clean
  if [[ $FORCE_CLEAN -eq 0 && -n "$backup_dir" ]]; then
    restore_persistent_data "$backup_dir"
  fi

  ensure_data_dir
  setup_persistent_certificates
  install_node_deps

  validate_build
  install_systemd_units
  install_cli
  configure_service_envs
  enable_services
  configure_mosquitto
  start_services
  log "installation complete"
}

main "$@"
