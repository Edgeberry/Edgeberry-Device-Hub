#!/usr/bin/env bash
set -euo pipefail

# Deploy Edgeberry Device Hub to remote host via SSH
# Usage: deploy.sh -h <host> [-u <user>] [-i <key>] [--skip-build]

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="$ROOT_DIR/dist-artifacts"

# Default values
HOST=""
USER="$(whoami)"
IDENTITY_FILE=""
PASSWORD=""
SKIP_BUILD=0
VERBOSE=0
FORCE_CLEAN=0

log() { echo "[deploy] $*"; }
error() { echo "[deploy] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") -h <host> [-u <user>] [-i <key>] [-p <password>] [--skip-build] [-v] [--force-clean]

Options:
  -h <host>      Remote host (required)
  -u <user>      SSH username (default: current user)
  -i <key>       SSH private key file
  -p <password>  SSH password (will prompt if not provided)
  --skip-build   Skip local build
  --force-clean  Force clean install (removes persistent certificates and database)
  -v             Verbose output
  --help         Show help
EOF
}


# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h) HOST="$2"; shift 2;;
    -u) USER="$2"; shift 2;;
    -i) IDENTITY_FILE="$2"; shift 2;;
    -p) PASSWORD="$2"; shift 2;;
    --skip-build) SKIP_BUILD=1; shift;;
    --force-clean) FORCE_CLEAN=1; shift;;
    -v) VERBOSE=1; shift;;
    --help) usage; exit 0;;
    *) error "Unknown option: $1";;
  esac
done

[[ -n "$HOST" ]] || { usage; error "Host required (-h <host>)"; }

# Prompt for password if not provided and no identity file
if [[ -z "$PASSWORD" && -z "$IDENTITY_FILE" ]]; then
  read -r -s -p "Password for $USER@$HOST: " PASSWORD
  echo
  [[ -n "$PASSWORD" ]] || error "Password required"
fi

# Build SSH command
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10)
[[ -n "$IDENTITY_FILE" ]] && SSH_OPTS+=(-i "$IDENTITY_FILE")
[[ $VERBOSE -eq 1 ]] && SSH_OPTS+=(-v)

# SSH command wrappers
if [[ -n "$PASSWORD" ]]; then
  # Check for sshpass
  command -v sshpass >/dev/null || error "sshpass required for password authentication"
  ssh_run() { sshpass -p "$PASSWORD" ssh "${SSH_OPTS[@]}" "$USER@$HOST" "$@"; }
  scp_copy() { sshpass -p "$PASSWORD" scp "${SSH_OPTS[@]}" "$1" "$USER@$HOST:$2"; }
else
  ssh_run() { ssh "${SSH_OPTS[@]}" "$USER@$HOST" "$@"; }
  scp_copy() { scp "${SSH_OPTS[@]}" "$1" "$USER@$HOST:$2"; }
fi

# Check dependencies
command -v ssh >/dev/null || error "ssh not found"
command -v scp >/dev/null || error "scp not found"

# Test SSH connectivity FIRST before building
log "testing connection to $USER@$HOST..."
ssh_run true || error "Cannot connect to $USER@$HOST"

# Test sudo access
log "testing sudo access..."
ssh_run "sudo -n true" || error "Sudo access required on remote host"

# Build artifacts locally
if [[ $SKIP_BUILD -eq 0 ]]; then
  log "building artifacts..."
  bash "$ROOT_DIR/scripts/build-all.sh" || error "Build failed"
else
  log "skipping build"
fi

# Check artifacts exist
ls "$ART_DIR"/devicehub-*.tar.gz >/dev/null 2>&1 || error "No artifacts found in $ART_DIR"

# Create remote staging directory
REMOTE_STAGING="/tmp/edgeberry-deploy-$(date +%s)"

# Create remote staging directory
log "creating staging directory: $REMOTE_STAGING"
ssh_run "mkdir -p '$REMOTE_STAGING'/{dist-artifacts,config,scripts}" || error "Failed to create staging directory"

# Copy files
log "copying artifacts..."
for artifact in "$ART_DIR"/devicehub-*.tar.gz; do
  scp_copy "$artifact" "$REMOTE_STAGING/dist-artifacts/"
done || error "Failed to copy artifacts"

if [[ -d "$ROOT_DIR/config" ]]; then
  for config_file in "$ROOT_DIR/config/"*; do
    [[ -f "$config_file" ]] && scp_copy "$config_file" "$REMOTE_STAGING/config/"
  done
fi || error "Failed to copy config"

scp_copy "$ROOT_DIR/scripts/install.sh" "$REMOTE_STAGING/scripts/" || error "Failed to copy installer"

# Run installer
log "running installer..."
INSTALL_ARGS="'$REMOTE_STAGING/dist-artifacts'"
[[ $FORCE_CLEAN -eq 1 ]] && INSTALL_ARGS="$INSTALL_ARGS --force-clean"

if [[ $VERBOSE -eq 1 ]]; then
  ssh_run "sudo DEBUG=1 bash '$REMOTE_STAGING/scripts/install.sh' $INSTALL_ARGS" || error "Installation failed"
else
  ssh_run "sudo bash '$REMOTE_STAGING/scripts/install.sh' $INSTALL_ARGS" || error "Installation failed"
fi

# Cleanup
log "cleaning up..."
ssh_run "rm -rf '$REMOTE_STAGING'" || true

# Check service status
log "checking service status..."
ssh_run "systemctl status devicehub-core.service --no-pager -l" || true
ssh_run "journalctl -u devicehub-core.service -n 20 --no-pager" || true

log "✅ Deployment complete"
