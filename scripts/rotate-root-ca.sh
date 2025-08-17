#!/usr/bin/env bash
# Rotate the Root CA used by the Edgeberry Device Hub deployment.
# This script replaces the trusted CA for both Mosquitto and services,
# deletes prior CA(s), and restarts affected daemons.
#
# Usage:
#   sudo bash scripts/rotate-root-ca.sh /path/to/new-root-ca.crt \
#        [/path/to/new-server.crt] [/path/to/new-server.key]
#
# Notes:
# - If server cert/key are provided, they'll replace the broker's certificate.
# - All files must be PEM.
# - Services read their CA from $INSTALL_ROOT/config/certs/ca.crt (deployed tree).
# - Mosquitto trusts CAs from capath /etc/mosquitto/certs/edgeberry-ca.d.

set -euo pipefail

log() { echo "[rotate-root-ca] $*"; }
require_root() { if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "must run as root" >&2; exit 1; fi; }

NEW_CA=${1:-}
NEW_SRV_CERT=${2:-}
NEW_SRV_KEY=${3:-}

INSTALL_ROOT="/opt/Edgeberry/devicehub"
CAPATH="/etc/mosquitto/certs/edgeberry-ca.d"
MOSQ_CERT="/etc/mosquitto/certs/server.crt"
MOSQ_KEY="/etc/mosquitto/certs/server.key"
SERVICES_CA="$INSTALL_ROOT/config/certs/ca.crt"

require_root
if [[ -z "$NEW_CA" || ! -f "$NEW_CA" ]]; then
  echo "Usage: sudo bash scripts/rotate-root-ca.sh /path/to/new-root-ca.crt [server.crt] [server.key]" >&2
  exit 1
fi

log "rotating Root CA"
# 1) Update services CA trust
install -m 0644 "$NEW_CA" "$SERVICES_CA"

# 2) Clean broker capath, install only the new CA, and rehash
mkdir -p "$CAPATH"
find "$CAPATH" -type f -maxdepth 1 -print0 2>/dev/null | xargs -0r rm -f --
install -m 0640 "$NEW_CA" "$CAPATH/root-ca.crt"
if id -u mosquitto >/dev/null 2>&1; then chown -R root:mosquitto "$CAPATH" || true; fi
if command -v c_rehash >/dev/null 2>&1; then c_rehash "$CAPATH" >/dev/null 2>&1 || true; else openssl rehash "$CAPATH" >/dev/null 2>&1 || true; fi

# 3) Optionally rotate broker server cert/key
if [[ -n "${NEW_SRV_CERT}" && -n "${NEW_SRV_KEY}" ]]; then
  if [[ -f "$NEW_SRV_CERT" && -f "$NEW_SRV_KEY" ]]; then
    install -m 0640 "$NEW_SRV_CERT" "$MOSQ_CERT"
    install -m 0640 "$NEW_SRV_KEY"  "$MOSQ_KEY"
    if id -u mosquitto >/dev/null 2>&1; then chown root:mosquitto "$MOSQ_CERT" "$MOSQ_KEY" || true; fi
    log "replaced broker server cert/key"
  else
    log "WARN: server cert/key not found; skipping broker server cert rotation"
  fi
fi

# 4) Reload broker and restart services to pick up trust
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  log "reloading mosquitto"
  systemctl reload mosquitto || systemctl restart mosquitto || true
  log "restarting services"
  systemctl restart devicehub-core.service devicehub-provisioning.service devicehub-twin.service devicehub-registry.service || true
else
  service mosquitto reload || service mosquitto restart || true
fi

log "Root CA rotation complete"
