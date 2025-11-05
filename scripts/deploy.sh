#!/usr/bin/env bash
set -euo pipefail

# Deploy Edgeberry Device Hub to remote host via SSH
# Usage: deploy.sh -h <host> [-u <user>] [-i <key>] [--skip-build]

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="$ROOT_DIR/dist-artifacts"

# Default values (can be overridden via environment variables)
HOST="${DEPLOY_HOST:-}"
USER="${DEPLOY_USER:-$(whoami)}"
IDENTITY_FILE="${DEPLOY_IDENTITY_FILE:-}"
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
  -h <host>      Remote host (required, or set DEPLOY_HOST env var)
  -u <user>      SSH username (default: current user, or set DEPLOY_USER env var)
  -i <key>       SSH private key file (or set DEPLOY_IDENTITY_FILE env var)
  -p <password>  SSH password (will prompt if not provided)
  --skip-build   Skip local build
  --force-clean  Force clean install (removes persistent certificates and database)
  -v             Verbose output
  --help         Show help

Environment Variables:
  DEPLOY_HOST           Default remote host
  DEPLOY_USER           Default SSH username
  DEPLOY_IDENTITY_FILE  Default SSH private key file

Examples:
  # Using command-line arguments
  $(basename "$0") -h 192.168.1.100 -u spuq

  # Using environment variables
  export DEPLOY_HOST=192.168.1.100
  export DEPLOY_USER=spuq
  $(basename "$0")

  # Override environment defaults with command-line args
  export DEPLOY_HOST=192.168.1.100
  $(basename "$0") -h 192.168.1.200  # Uses 192.168.1.200 instead
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
ssh_run "mkdir -p '$REMOTE_STAGING'" || error "Failed to create staging directory"

# Copy tarball
log "copying artifacts..."
for artifact in "$ART_DIR"/devicehub-*.tar.gz; do
  scp_copy "$artifact" "$REMOTE_STAGING/"
done || error "Failed to copy artifacts"

# Extract tarball and use scripts from within it
log "extracting tarball and preparing installer..."
ssh_run "cd '$REMOTE_STAGING' && tar -xzf devicehub-*.tar.gz" || error "Failed to extract tarball"

# Run installer using script from extracted tarball
log "running installer..."
INSTALL_ARGS="'$REMOTE_STAGING'"
[[ $FORCE_CLEAN -eq 1 ]] && INSTALL_ARGS="$INSTALL_ARGS --force-clean"

# Build the command with optional DEBUG environment variable
DEPLOY_CMD="cd '$REMOTE_STAGING' && sudo"
[[ -n "${DEBUG:-}" ]] && DEPLOY_CMD="$DEPLOY_CMD DEBUG=1"
DEPLOY_CMD="$DEPLOY_CMD bash scripts/deploy-artifacts.sh $INSTALL_ARGS"

ssh_run "$DEPLOY_CMD" || error "Installation failed"

# Cleanup
log "cleaning up..."
ssh_run "rm -rf '$REMOTE_STAGING'" || true

# Check service status
log "checking service status..."
ssh_run "systemctl status devicehub-core.service --no-pager -l" || true
ssh_run "journalctl -u devicehub-core.service -n 20 --no-pager" || true

log "✅ Deployment complete"
