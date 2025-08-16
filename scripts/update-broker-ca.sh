#!/usr/bin/env bash
# Add or update a CA certificate for Mosquitto and reload the broker.
# Usage:
#   sudo bash scripts/update-broker-ca.sh /path/to/new-root-ca.crt
# Notes:
# - Installs CA into /etc/mosquitto/certs/edgeberry-ca.d
# - Runs c_rehash/openssl rehash so capath hashes are updated
# - Reloads/restarts mosquitto via systemd if available

set -euo pipefail

log() { echo "[update-broker-ca] $*"; }

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "[update-broker-ca] ERROR: must run as root (sudo)." >&2
    exit 1
  fi
}

CAPATH="/etc/mosquitto/certs/edgeberry-ca.d"
SRC_CA="${1:-}"

require_root

if [[ -z "$SRC_CA" ]]; then
  echo "Usage: sudo bash scripts/update-broker-ca.sh /path/to/new-root-ca.crt" >&2
  exit 1
fi

if [[ ! -f "$SRC_CA" ]]; then
  echo "[update-broker-ca] ERROR: file not found: $SRC_CA" >&2
  exit 1
fi

mkdir -p "$CAPATH"
# Install with a stable name based on sha1 of content to avoid duplicates
sha="$(openssl x509 -in "$SRC_CA" -noout -fingerprint -sha1 2>/dev/null | sed 's/.*=//;s/://g' || uuidgen)"
TARGET="$CAPATH/edgeberry-${sha}.crt"
install -m 0640 "$SRC_CA" "$TARGET"

# Ensure ownership for mosquitto group if present
if id -u mosquitto >/dev/null 2>&1; then
  chown root:mosquitto "$TARGET" 2>/dev/null || true
  chown -R root:mosquitto "$CAPATH" 2>/dev/null || true
fi

# Rehash for OpenSSL capath discovery
if command -v c_rehash >/dev/null 2>&1; then
  c_rehash "$CAPATH" >/dev/null 2>&1 || true
elif command -v openssl >/dev/null 2>&1; then
  openssl rehash "$CAPATH" >/dev/null 2>&1 || true
fi

# Reload/restart Mosquitto
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  log "reloading mosquitto"
  systemctl reload mosquitto || systemctl restart mosquitto || true
else
  log "NOTE: systemd not found; attempt to restart mosquitto via service"
  service mosquitto reload || service mosquitto restart || true
fi

log "installed CA: $TARGET"
log "done"
