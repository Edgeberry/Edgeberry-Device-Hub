#!/usr/bin/env bash
set -euo pipefail

##
# Edgeberry Device Hub Deployment (Remote over SSH)
# - Builds local artifacts via scripts/build-all.sh into dist-artifacts/
# - Copies artifacts + config + installer to a remote device
# - Runs installer remotely (requires sudo on remote)
# - Restarts systemd services (devicehub-*.service)
##

APPNAME="Edgeberry Device Hub"
DEFAULT_USER="spuq"
DEFAULT_HOST="192.168.1.103"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART_DIR="$ROOT_DIR/dist-artifacts"
REMOTE_TEMP_BASE="/tmp"
DEBUG="${DEBUG:-0}"
SSH_COMMON_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10)
if [[ "$DEBUG" == "1" ]]; then
  SSH_COMMON_OPTS+=(-vv)
fi

# Progress UI (similar style to device-software)
declare -a STEPS=(
  "Check/Install sshpass"
  "Collect credentials"
  "Build artifacts (local)"
  "Check remote connectivity"
  "Create remote temp dir"
  "Copy artifacts + config + installer"
  "Run remote installer"
  "Cleanup remote temp"
)

declare -a STEP_STATUS=()
TOTAL_STEPS=${#STEPS[@]}

SYMBOL_PENDING="[ ]"
SYMBOL_BUSY="[~]"
SYMBOL_COMPLETED="[+]"
SYMBOL_FAILED="[X]"

for ((i=0; i<TOTAL_STEPS; i++)); do
  STEP_STATUS[i]="$SYMBOL_PENDING"
done

show_progress() {
  if [[ "$DEBUG" != "1" ]]; then
    clear
  fi
  echo -e "\033[1m${APPNAME} Deployment\033[0m"
  echo ""
  for ((i=0; i<TOTAL_STEPS; i++)); do
    echo -e "${STEP_STATUS[i]} ${STEPS[i]}"
  done
  echo ""
}

set_step_status() { STEP_STATUS[$1]="$2"; show_progress; }
mark_step_busy() { set_step_status "$1" "$SYMBOL_BUSY"; }
mark_step_completed() { set_step_status "$1" "$SYMBOL_COMPLETED"; }
mark_step_failed() { set_step_status "$1" "$SYMBOL_FAILED"; }

if [[ "$DEBUG" == "1" ]]; then
  set -x
fi
show_progress

# Simple retry for SSH connectivity with backoff
retry_ssh_connect() {
  local attempts="$1"; shift
  local delay="$1"; shift
  local ok=1
  for ((i=1; i<=attempts; i++)); do
    if "${SSH_BASE[@]}" ${USER}@${HOST} "true" >/dev/null 2>&1; then
      ok=0
      break
    fi
    sleep "$delay"
  done
  return $ok
}

# Step 0: Check/Install sshpass
mark_step_busy 0
if which sshpass >/dev/null 2>&1; then
  mark_step_completed 0
else
  mark_step_failed 0
  echo -e "\e[0;33msshpass is required. Install with: sudo apt install -y sshpass\e[0m"
  exit 1
fi

# Step 1: Collect credentials
mark_step_busy 1
echo -e '\e[0;33m-------------------------------------- \e[0m'
echo -e '\e[0;33m Remote device credentials are needed.  \e[0m'
echo -e '\e[0;33m-------------------------------------- \e[0m'
read -e -i "$DEFAULT_HOST" -p "Hostname: " HOST
HOST=${HOST:-$DEFAULT_HOST}
read -e -i "$DEFAULT_USER" -p "User: " USER
USER=${USER:-$DEFAULT_USER}
stty -echo
read -p "Password: " PASSWORD
stty echo
echo ""
REMOTE_TEMP="${REMOTE_TEMP_BASE}/devicehub_${USER}_deploy"
SSH_BASE=(sshpass -p "$PASSWORD" ssh "${SSH_COMMON_OPTS[@]}")
# scp base with compression; add -v when DEBUG
if [[ "$DEBUG" == "1" ]]; then
  SCP_BASE=(sshpass -p "$PASSWORD" scp -C -v "${SSH_COMMON_OPTS[@]}")
else
  SCP_BASE=(sshpass -p "$PASSWORD" scp -C "${SSH_COMMON_OPTS[@]}")
fi
mark_step_completed 1

# Step 2: Build artifacts (local)
mark_step_busy 2
if [[ "$DEBUG" == "1" ]]; then
  bash "$ROOT_DIR/scripts/build-all.sh"
else
  bash "$ROOT_DIR/scripts/build-all.sh" >/dev/null 2>&1
fi
if [[ $? -eq 0 ]]; then
  mark_step_completed 2
else
  mark_step_failed 2
  echo -e "\e[0;33mFailed to build artifacts locally\e[0m"
  exit 1
fi

# Ensure artifacts exist
if ! ls -1 "$ART_DIR"/devicehub-*.tar.gz >/dev/null 2>&1; then
  echo -e "\e[0;33mNo artifacts found in $ART_DIR.\e[0m"
  echo -e "\e[0;33mExpected files like devicehub-*.tar.gz (built by scripts/build-all.sh).\e[0m"
  exit 1
fi

# Step 3: Check remote connectivity (retry ~60s)
mark_step_busy 3
if retry_ssh_connect 12 5; then
  mark_step_completed 3
else
  mark_step_failed 3
  echo -e "\e[0;33mCannot connect to remote host after retries (check host/user/password/network)\e[0m"
  exit 1
fi

# Extra: Validate sudo on remote (prevents stall if sudo requires TTY or password)
if [[ "$DEBUG" == "1" ]]; then
  if ! "${SSH_BASE[@]}" ${USER}@${HOST} "echo \"$PASSWORD\" | sudo -S -p '' -v"; then
    echo -e "\e[0;33mRemote sudo validation failed. Ensure the user has sudo rights and the password is correct.\e[0m"
    echo -e "\e[0;33mTip: Some systems require a TTY for sudo. We'll force TTY during installer.\e[0m"
  fi
else
  if ! "${SSH_BASE[@]}" ${USER}@${HOST} "echo \"$PASSWORD\" | sudo -S -p '' -v" >/dev/null 2>&1; then
    echo -e "\e[0;33mRemote sudo validation failed. Ensure the user has sudo rights and the password is correct.\e[0m"
    echo -e "\e[0;33mTip: Some systems require a TTY for sudo. We'll force TTY during installer.\e[0m"
  fi
fi

# Step 3.5: Prune polluted install root to free space (do not touch allowed dirs)
if [[ "$DEBUG" == "1" ]]; then
  echo -e "\e[0;33m[deploy] Pruning unexpected entries under /opt/Edgeberry/devicehub to free space...\e[0m"
fi
"${SSH_BASE[@]}" ${USER}@${HOST} bash -lc '
set -euo pipefail
INSTALL_ROOT="/opt/Edgeberry/devicehub"
ALLOWED="core-service provisioning-service twin-service registry-service ui config"
if [ -d "$INSTALL_ROOT" ]; then
  sudo mkdir -p "$INSTALL_ROOT"
  for e in "$INSTALL_ROOT"/*; do
    [ -e "$e" ] || continue
    b="$(basename "$e")"
    keep=0
    for a in $ALLOWED; do
      if [ "$b" = "$a" ]; then keep=1; break; fi
    done
    if [ "$keep" -eq 0 ]; then
      echo "[deploy] removing unexpected: $e"
      sudo rm -rf --one-file-system -- "$e" || true
    fi
  done
  # Also remove node_modules inside services to free space (they will not be used at runtime)
  for svc in core-service provisioning-service twin-service registry-service; do
    if [ -d "$INSTALL_ROOT/$svc/node_modules" ]; then
      echo "[deploy] removing $INSTALL_ROOT/$svc/node_modules"
      sudo rm -rf --one-file-system -- "$INSTALL_ROOT/$svc/node_modules" || true
    fi
  done
fi
df -h /
' >/dev/null 2>&1 || true

# Step 4: Create remote temp dir (try multiple locations to avoid no-space on /tmp)
mark_step_busy 4
# Attempt to free space if rootfs is nearly full
"${SSH_BASE[@]}" ${USER}@${HOST} bash -lc '
ROOT_USE=$(df -P / | awk "NR==2{gsub(/%/,"",$5); print $5}")
if [ "$ROOT_USE" -ge 95 ]; then
  echo "[deploy] Root FS ${ROOT_USE}% full; running cleanup..."
  echo "[deploy] Removing previous staging dirs"
  sudo rm -rf /tmp/devicehub_*_deploy /var/tmp/devicehub_*_deploy || true
  echo "[deploy] Vacuuming journals to 100M"
  sudo journalctl --vacuum-size=100M >/dev/null 2>&1 || true
  echo "[deploy] Cleaning apt caches"
  sudo apt-get clean >/dev/null 2>&1 || true
  sudo rm -rf /var/cache/apt/archives/*.deb >/dev/null 2>&1 || true
  echo "[deploy] Cleaning npm caches"
  sudo rm -rf /root/.npm ~/.npm >/dev/null 2>&1 || true
  echo "[deploy] After cleanup:"
  df -h /
fi
' >/dev/null 2>&1 || true

# Choose a remote temp dir under the user's home only
HOME_CAND="\$HOME/devicehub_${USER}_deploy"
CHOSEN_REMOTE_TEMP=""
if [[ "$DEBUG" == "1" ]]; then
  if "${SSH_BASE[@]}" ${USER}@${HOST} "mkdir -p \"$HOME_CAND\" && rm -rf \"$HOME_CAND\"/*"; then
    CHOSEN_REMOTE_TEMP="$HOME_CAND"
  fi
else
  if "${SSH_BASE[@]}" ${USER}@${HOST} "mkdir -p \"$HOME_CAND\" && rm -rf \"$HOME_CAND\"/*" >/dev/null 2>&1; then
    CHOSEN_REMOTE_TEMP="$HOME_CAND"
  fi
fi
if [[ -n "$CHOSEN_REMOTE_TEMP" ]]; then
  # Normalize $HOME if used
  if [[ "$CHOSEN_REMOTE_TEMP" == "\$HOME"* ]]; then
    # Resolve remote $HOME value without local expansion
    HOME_REMOTE=$(${SSH_BASE[@]} ${USER}@${HOST} 'printf %s "$HOME"')
    REMOTE_TEMP="${CHOSEN_REMOTE_TEMP/\$HOME/$HOME_REMOTE}"
  else
    REMOTE_TEMP="$CHOSEN_REMOTE_TEMP"
  fi
  mark_step_completed 4
else
  mark_step_failed 4
  echo -e "\e[0;33mFailed to create a remote temp dir in /tmp, /var/tmp, or $HOME (disk full?).\e[0m"
  echo -e "\e[0;33mRemote disk usage:\e[0m"
  ${SSH_BASE[@]} ${USER}@${HOST} "df -h || true"
  exit 1
fi

# Step 5: Copy artifacts + config + installer (retry up to 3x)
mark_step_busy 5
COPY_OK=0
if [[ -d "$ART_DIR" ]]; then
  # Create remote dirs explicitly and copy only what is needed
  ART_FILES=("$ART_DIR"/devicehub-*.tar.gz)
  # Prefer rsync when available for progress and robustness
  RSYNC_LOCAL=0; RSYNC_REMOTE=0
  if command -v rsync >/dev/null 2>&1; then RSYNC_LOCAL=1; fi
  if "${SSH_BASE[@]}" ${USER}@${HOST} "command -v rsync >/dev/null 2>&1" >/dev/null 2>&1; then RSYNC_REMOTE=1; fi
  for attempt in 1 2 3; do
    if [[ $RSYNC_LOCAL -eq 1 && $RSYNC_REMOTE -eq 1 ]]; then
      # Ensure remote dirs
      if [[ "$DEBUG" == "1" ]]; then
        "${SSH_BASE[@]}" ${USER}@${HOST} "mkdir -p \"$REMOTE_TEMP/dist-artifacts\" \"$REMOTE_TEMP/config\" \"$REMOTE_TEMP/scripts\""
      else
        "${SSH_BASE[@]}" ${USER}@${HOST} "mkdir -p \"$REMOTE_TEMP/dist-artifacts\" \"$REMOTE_TEMP/config\" \"$REMOTE_TEMP/scripts\"" >/dev/null 2>&1
      fi
      RSH="sshpass -p \"$PASSWORD\" ssh ${SSH_COMMON_OPTS[*]}"
      if [[ "$DEBUG" == "1" ]]; then
        RSYNC_OPTS=(-az --info=progress2 --partial)
      else
        RSYNC_OPTS=(-az --partial)
      fi
      if rsync "${RSYNC_OPTS[@]}" --rsh "$RSH" "${ART_FILES[@]}" ${USER}@${HOST}:"$REMOTE_TEMP/dist-artifacts/" \
        && rsync "${RSYNC_OPTS[@]}" --rsh "$RSH" -r "$ROOT_DIR/config/" ${USER}@${HOST}:"$REMOTE_TEMP/config/" \
        && rsync "${RSYNC_OPTS[@]}" --rsh "$RSH" "$ROOT_DIR/scripts/install.sh" ${USER}@${HOST}:"$REMOTE_TEMP/scripts/install.sh"; then
        COPY_OK=1; break
      fi
    else
      # Fallback to scp
      if [[ "$DEBUG" == "1" ]]; then
        if "${SSH_BASE[@]}" ${USER}@${HOST} "mkdir -p \"$REMOTE_TEMP/dist-artifacts\" \"$REMOTE_TEMP/config\" \"$REMOTE_TEMP/scripts\"" \
          && "${SCP_BASE[@]}" "${ART_FILES[@]}" ${USER}@${HOST}:"$REMOTE_TEMP/dist-artifacts/" \
          && "${SCP_BASE[@]}" -r "$ROOT_DIR/config/"* ${USER}@${HOST}:"$REMOTE_TEMP/config/" \
          && "${SCP_BASE[@]}" "$ROOT_DIR/scripts/install.sh" ${USER}@${HOST}:"$REMOTE_TEMP/scripts/install.sh"; then
          COPY_OK=1; break
        fi
      else
        if "${SSH_BASE[@]}" ${USER}@${HOST} "mkdir -p \"$REMOTE_TEMP/dist-artifacts\" \"$REMOTE_TEMP/config\" \"$REMOTE_TEMP/scripts\"" >/dev/null 2>&1 \
          && "${SCP_BASE[@]}" "${ART_FILES[@]}" ${USER}@${HOST}:"$REMOTE_TEMP/dist-artifacts/" >/dev/null 2>&1 \
          && "${SCP_BASE[@]}" -r "$ROOT_DIR/config/"* ${USER}@${HOST}:"$REMOTE_TEMP/config/" >/dev/null 2>&1 \
          && "${SCP_BASE[@]}" "$ROOT_DIR/scripts/install.sh" ${USER}@${HOST}:"$REMOTE_TEMP/scripts/install.sh" >/dev/null 2>&1; then
          COPY_OK=1; break
        fi
      fi
    fi
    sleep 2
  done
fi
if [[ $COPY_OK -eq 1 ]]; then
  mark_step_completed 5
else
  mark_step_failed 5
  echo -e "\e[0;33mFailed to copy artifacts/config/installer to remote\e[0m"
  echo -e "\e[0;33mHint: Try DEBUG=1 to see verbose SSH/SCP logs.\e[0m"
  exit 1
fi

# Step 6: Run remote installer (use sudo -S and force TTY to avoid interactive prompts)
mark_step_busy 6
if [[ "$DEBUG" == "1" ]]; then
  if ${SSH_BASE[@]} -tt ${USER}@${HOST} "echo \"$PASSWORD\" | sudo -S -p '' bash -c \"DEBUG=1 TMPDIR=\"$REMOTE_TEMP\" bash \"$REMOTE_TEMP/scripts/install.sh\" \"$REMOTE_TEMP/dist-artifacts\"\""; then
    mark_step_completed 6
  else
    mark_step_failed 6
    echo -e "\e[0;33mRemote installer failed (see output above)\e[0m"
    exit 1
  fi
else
  if ${SSH_BASE[@]} -tt ${USER}@${HOST} "echo \"$PASSWORD\" | sudo -S -p '' bash -c \"TMPDIR=\"$REMOTE_TEMP\" bash \"$REMOTE_TEMP/scripts/install.sh\" \"$REMOTE_TEMP/dist-artifacts\"\"" >/dev/null 2>&1; then
    mark_step_completed 6
  else
    mark_step_failed 6
    echo -e "\e[0;33mRemote installer failed\e[0m"
    echo -e "\e[0;33mRe-run with DEBUG=1 for verbose output\e[0m"
    exit 1
  fi
fi

# Step 7: Cleanup remote temp
mark_step_busy 7
if "${SSH_BASE[@]}" ${USER}@${HOST} "rm -rf \"$REMOTE_TEMP\"" >/dev/null 2>&1; then
  mark_step_completed 7
else
  mark_step_failed 7
  echo -e "\e[0;33mFailed to cleanup remote temp directory (non-fatal)\e[0m"
fi

show_progress
echo -e "\e[0;32m\033[1mDeployment completed successfully.\033[0m\e[0m"
echo ""
exit 0
