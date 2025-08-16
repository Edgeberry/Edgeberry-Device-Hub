#!/usr/bin/env bash
set -euo pipefail

# Build artifacts for each microservice and package as tar.gz under dist-artifacts/
# Services covered: api, provisioning-service, twin-service, registry-service, core-service, ui
# This script is CI-friendly and can be run locally.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="${ROOT_DIR}/dist-artifacts"
mkdir -p "$ART_DIR"

# Staging directory for the combined artifact (single tarball only)
COMBINED_STAGE="$(mktemp -d)"

# Determine version tag for artifact filenames
VERSION="${GITHUB_REF_NAME:-}"  # available in GitHub Actions on tag events
if [[ -z "$VERSION" ]]; then
  # Try package.json in api/ as a fallback
  if [[ -f "${ROOT_DIR}/api/package.json" ]]; then
    VERSION="v$(node -pe "require('./api/package.json').version || '0.0.0'" 2>/dev/null || echo "0.0.0")"
  else
    VERSION="v0.0.0"
  fi
fi

log() { echo "[build-all] $*"; }

build_node_service() {
  local svc="$1"; shift
  local dir="${ROOT_DIR}/${svc}"
  if [[ ! -f "${dir}/package.json" ]]; then
    log "skip ${svc}: no package.json"
    return 0
  fi
  log "build ${svc}"
  pushd "$dir" >/dev/null
  # Install deps (prefer ci, but fall back to install if lock is out of sync)
  if [[ -f package-lock.json ]]; then
    npm ci || npm install
  else
    npm install
  fi
  # Build if script exists
  if npm run | grep -qE '^\s*build\s'; then
    npm run build
  fi
  # Prune dev deps for artifact
  npm prune --omit=dev || true
  popd >/dev/null

  # Stage files into the combined artifact directory
  mkdir -p "$COMBINED_STAGE/${svc}"
  rsync -a --exclude ".git" --exclude "node_modules" --exclude "node_modules/.cache" \
    "${dir}/" "$COMBINED_STAGE/${svc}/"
  # Ensure full config directory is included in the combined artifact once
  if [[ ! -d "$COMBINED_STAGE/config" ]]; then
    if [[ -d "${ROOT_DIR}/config" ]]; then
      mkdir -p "$COMBINED_STAGE/config"
      # Copy everything under config (certs, ACLs, systemd units, broker configs)
      rsync -a "${ROOT_DIR}/config/" "$COMBINED_STAGE/config/"
    fi
  fi
  # Ensure scripts directory (including device_mqtt_test.sh) is included once
  if [[ ! -d "$COMBINED_STAGE/scripts" ]]; then
    if [[ -d "${ROOT_DIR}/scripts" ]]; then
      mkdir -p "$COMBINED_STAGE/scripts"
      rsync -a "${ROOT_DIR}/scripts/" "$COMBINED_STAGE/scripts/"
    fi
  fi
  # No per-service tarballs. Content is staged for the single combined tar.
  log "staged: ${svc}"
}

build_ui() {
  local dir
  if [[ -d "${ROOT_DIR}/ui" ]]; then
    dir="${ROOT_DIR}/ui"
    local name="ui"
    log "build ${name}"
    pushd "$dir" >/dev/null
    if [[ -f package.json ]]; then
      if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
      if npm run | grep -qE '^\s*build\s'; then
        npm run build
        # Ensure build output exists
        if [[ ! -f "build/index.html" ]]; then
          echo "[build-all] ERROR: UI build output missing at ui/build/index.html" >&2
          exit 1
        fi
      fi
      npm prune --omit=dev || true
    fi
    popd >/dev/null
    mkdir -p "$COMBINED_STAGE/${name}"
    # Only stage built static assets for the UI
    rsync -a --delete "${dir}/build/" "$COMBINED_STAGE/${name}/build/"
    # No per-package tarball; staged into combined artifact
    log "staged: ${name}"
  else
    log "skip UI: not found"
  fi
}

# Build UI first so other services (e.g., core-service) can rely on its presence
build_ui

build_node_service core-service
build_node_service provisioning-service
build_node_service twin-service
build_node_service registry-service

# Create a single combined tarball from the staged content only
if [[ -d "$COMBINED_STAGE" ]]; then
  COMBINED_TAR="devicehub-${VERSION}.tar.gz"
  rm -f "${ART_DIR}/${COMBINED_TAR}" || true
  TMP_OUT="${ROOT_DIR}/${COMBINED_TAR}"
  tar -C "$COMBINED_STAGE" -czf "$TMP_OUT" .
  mv "$TMP_OUT" "${ART_DIR}/${COMBINED_TAR}"
  log "combined artifact: ${ART_DIR}/${COMBINED_TAR}"
  rm -rf "$COMBINED_STAGE"
fi

log "done"
