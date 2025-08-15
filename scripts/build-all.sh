#!/usr/bin/env bash
set -euo pipefail

# Build artifacts for each microservice and package as tar.gz under dist-artifacts/
# Services covered: api, provisioning-service, twin-service, registry-service, core-service, ui
# This script is CI-friendly and can be run locally.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="${ROOT_DIR}/dist-artifacts"
mkdir -p "$ART_DIR"

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

  # Stage artifact
  local stage
  stage="$(mktemp -d)"
  mkdir -p "$stage/${svc}"
  rsync -a --exclude ".git" --exclude "node_modules/.cache" \
    "${dir}/" "$stage/${svc}/"
  # Include root config when useful
  if [[ -f "${ROOT_DIR}/config/mosquitto.conf" && "$svc" == "provisioning-service" ]]; then
    mkdir -p "$stage/config"
    cp "${ROOT_DIR}/config/mosquitto.conf" "$stage/config/" || true
  fi
  # Create tar.gz
  local tarname
  tarname="devicehub-${svc}-${VERSION}.tar.gz"
  tar -C "$stage" -czf "${ART_DIR}/${tarname}" .
  rm -rf "$stage"
  log "artifact: ${ART_DIR}/${tarname}"
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
    local stage="$(mktemp -d)"
    mkdir -p "$stage/${name}"
    rsync -a --exclude ".git" --exclude "node_modules/.cache" \
      "${dir}/" "$stage/${name}/"
    local tarname="devicehub-${name}-${VERSION}.tar.gz"
    tar -C "$stage" -czf "${ART_DIR}/${tarname}" .
    rm -rf "$stage"
    log "artifact: ${ART_DIR}/${tarname}"
  else
    log "skip UI: not found"
  fi
}

# Build UI first so other services (e.g., core-service) can rely on its presence
build_ui

build_node_service api
build_node_service core-service
build_node_service provisioning-service
build_node_service twin-service
build_node_service registry-service

# Create a single combined tarball that contains all artifacts
if [[ -d "$ART_DIR" ]]; then
  COMBINED_TAR="devicehub-${VERSION}.tar.gz"
  # Create outside of ART_DIR to avoid "file changed as we read it" while tar is being written
  TMP_OUT="${ROOT_DIR}/${COMBINED_TAR}"
  tar -C "$ART_DIR" -czf "$TMP_OUT" .
  mv "$TMP_OUT" "${ART_DIR}/${COMBINED_TAR}"
  log "combined artifact: ${ART_DIR}/${COMBINED_TAR}"
  # Remove individual tarballs so only one tarball remains
  find "$ART_DIR" -maxdepth 1 -type f -name 'devicehub-*.tar.gz' ! -name "$COMBINED_TAR" -print -delete || true
fi

log "done"
