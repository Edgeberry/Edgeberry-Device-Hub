#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

##
# Edgeberry Device Hub — Simple Deploy Script (SSH)
# - Builds local artifacts into dist-artifacts/ (unless --skip-build)
# - Copies artifacts + config + installer to the remote host
# - Runs the installer with sudo remotely
# - Cleans up the staging directory
##

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART_DIR="$ROOT_DIR/dist-artifacts"

HOST="${HOST:-}"
USER="${USER:-}"
IDENTITY_FILE="${IDENTITY_FILE:-}"
REMOTE_DIR=""
SKIP_BUILD=0
VERBOSE=0
PASSWORD="${PASSWORD:-}"

SSH_COMMON_OPTS=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=10
)

trap 'echo "[deploy] error on line ${LINENO}" >&2' ERR

usage() {
  cat <<EOF
Usage: $(basename "$0") -h <host> [-u <user>] [-i <identity_file>] [--remote-dir <dir>] [--skip-build] [-v]

Options:
  -h, --host           Remote host or IP (required)
  -u, --user           SSH username (default: current user)
  -i, --identity       SSH private key file
      --remote-dir     Remote staging dir (default: ~/.edgeberry-deploy-<ts>)
      --skip-build     Do not run scripts/build-all.sh
  -v, --verbose        Verbose SSH/rsync output
  -h, --help           Show this help

Environment overrides:
  HOST, USER, IDENTITY_FILE
EOF
}

log() { echo "[deploy] $*"; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--host) HOST="$2"; shift 2;;
      -u|--user) USER="$2"; shift 2;;
      -i|--identity) IDENTITY_FILE="$2"; shift 2;;
      --remote-dir) REMOTE_DIR="$2"; shift 2;;
      --skip-build) SKIP_BUILD=1; shift;;
      -v|--verbose) VERBOSE=1; shift;;
      --help) usage; exit 0;;
      *) echo "Unknown arg: $1" >&2; usage; exit 1;;
    esac
  done
  if [[ -z "${HOST}" ]]; then echo "--host is required" >&2; usage; exit 1; fi
  if [[ -z "${USER:-}" ]]; then
    read -r -p "SSH user: " USER
    if [[ -z "${USER:-}" ]]; then USER="$(id -un)"; fi
  fi
  if [[ -z "${PASSWORD:-}" ]]; then
    read -r -s -p "Password for ${USER}@${HOST}: " PASSWORD
    echo ""
  fi
}

build_local() {
  if (( SKIP_BUILD )); then
    log "skip build requested"
    return
  fi
  log "building artifacts..."
  bash "$ROOT_DIR/scripts/build-all.sh"
}

mk_ssh_arrays() {
  # Always use sshpass for remote actions per requirement
  SSH_BASE=(sshpass -p "$PASSWORD" ssh "${SSH_COMMON_OPTS[@]}")
  SCP_BASE=(sshpass -p "$PASSWORD" scp -C "${SSH_COMMON_OPTS[@]}")
  if [[ -n "${IDENTITY_FILE}" ]]; then
    SSH_BASE+=(-i "$IDENTITY_FILE")
    SCP_BASE+=(-i "$IDENTITY_FILE")
  fi
  if (( VERBOSE )); then
    SSH_BASE+=(-vv)
  fi
}

ensure_artifacts() {
  if ! ls -1 "$ART_DIR"/devicehub-*.tar.gz >/dev/null 2>&1; then
    echo "No artifacts found in $ART_DIR. Run build or remove --skip-build." >&2
    exit 1
  fi
}

pick_remote_dir() {
  if [[ -n "$REMOTE_DIR" ]]; then
    REMOTE_STAGING="$REMOTE_DIR"
    return
  fi
  local ts; ts="$(date +%s)"
  # Resolve remote $HOME to avoid literal ~ issues
  local home_remote
  home_remote="$(${SSH_BASE[@]} "${USER}@${HOST}" 'printf %s "$HOME"')"
  REMOTE_STAGING="$home_remote/.edgeberry-deploy-$ts"
}

main() {
  parse_args "$@"
  require_cmd ssh
  require_cmd scp
  require_cmd sshpass
  mk_ssh_arrays
  build_local
  ensure_artifacts

  log "checking remote connectivity..."
  if ! ${SSH_BASE[@]} "${USER}@${HOST}" true >/dev/null 2>&1; then
    echo "Cannot connect to ${USER}@${HOST} via SSH" >&2
    exit 1
  fi

  pick_remote_dir
  log "using remote staging: ${REMOTE_STAGING}"
  ${SSH_BASE[@]} "${USER}@${HOST}" "mkdir -p '${REMOTE_STAGING}/dist-artifacts' '${REMOTE_STAGING}/config' '${REMOTE_STAGING}/scripts'"

  # Copy (prefer rsync)
  local rsync_ok=0
  if command -v rsync >/dev/null 2>&1 && ${SSH_BASE[@]} "${USER}@${HOST}" "command -v rsync >/dev/null 2>&1" >/dev/null 2>&1; then
    rsync_ok=1
  fi
  ART_FILES=("$ART_DIR"/devicehub-*.tar.gz)
  if (( rsync_ok )); then
    log "copying files via rsync..."
    local RSYNC_OPTS; RSYNC_OPTS="-az"
    (( VERBOSE )) && RSYNC_OPTS="-az --info=progress2"
    # Build RSH command as a string for rsync
    local RSH_CMD="sshpass -p '$PASSWORD' ssh"
    local opt
    for opt in "${SSH_COMMON_OPTS[@]}"; do
      RSH_CMD="$RSH_CMD $opt"
    done
    [[ -n "${IDENTITY_FILE}" ]] && RSH_CMD="$RSH_CMD -i '$IDENTITY_FILE'"
    rsync ${RSYNC_OPTS} --rsh "$RSH_CMD" "${ART_FILES[@]}" "${USER}@${HOST}:${REMOTE_STAGING}/dist-artifacts/"
    rsync ${RSYNC_OPTS} --rsh "$RSH_CMD" -r "$ROOT_DIR/config/" "${USER}@${HOST}:${REMOTE_STAGING}/config/"
    rsync ${RSYNC_OPTS} --rsh "$RSH_CMD" "$ROOT_DIR/scripts/install.sh" "${USER}@${HOST}:${REMOTE_STAGING}/scripts/install.sh"
  else
    log "rsync not available on one side; falling back to scp..."
    ${SCP_BASE[@]} "${ART_FILES[@]}" "${USER}@${HOST}:${REMOTE_STAGING}/dist-artifacts/"
    ${SCP_BASE[@]} -r "$ROOT_DIR/config/"* "${USER}@${HOST}:${REMOTE_STAGING}/config/"
    ${SCP_BASE[@]} "$ROOT_DIR/scripts/install.sh" "${USER}@${HOST}:${REMOTE_STAGING}/scripts/install.sh"
  fi

  # Run installer
  log "running remote installer... (sudo)"
  if (( VERBOSE )); then
    ${SSH_BASE[@]} -tt "${USER}@${HOST}" "echo '$PASSWORD' | sudo -S -p '' bash -c 'DEBUG=1 TMPDIR=\"${REMOTE_STAGING}\" bash \"${REMOTE_STAGING}/scripts/install.sh\" \"${REMOTE_STAGING}/dist-artifacts\"'"
  else
    ${SSH_BASE[@]} -tt "${USER}@${HOST}" "echo '$PASSWORD' | sudo -S -p '' bash -c 'TMPDIR=\"${REMOTE_STAGING}\" bash \"${REMOTE_STAGING}/scripts/install.sh\" \"${REMOTE_STAGING}/dist-artifacts\"'" >/dev/null 2>&1
  fi

  # Cleanup
  log "cleaning up staging dir..."
  ${SSH_BASE[@]} "${USER}@${HOST}" "rm -rf '${REMOTE_STAGING}'" >/dev/null 2>&1 || true

  log "deployment completed"
}

main "$@"

# (old step-based UI and sshpass/password handling removed for simplicity)
