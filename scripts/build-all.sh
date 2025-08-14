#!/usr/bin/env bash
set -euo pipefail

# Build artifacts for each microservice and package as tar.gz under dist-artifacts/
# Services covered: api, provisioning-service, twin-service, registry-service, fleet-hub-ui (or ui)
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
  # Install deps
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
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
  tarname="fleethub-${svc}-${VERSION}.tar.gz"
  tar -C "$stage" -czf "${ART_DIR}/${tarname}" .
  rm -rf "$stage"
  log "artifact: ${ART_DIR}/${tarname}"
}

build_ui() {
  local dir
  if [[ -d "${ROOT_DIR}/fleet-hub-ui" ]]; then
    dir="${ROOT_DIR}/fleet-hub-ui"
    local name="fleet-hub-ui"
    log "build ${name}"
    pushd "$dir" >/dev/null
    if [[ -f package.json ]]; then
      if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
      if npm run | grep -qE '^\s*build\s'; then
        npm run build
      fi
      npm prune --omit=dev || true
    fi
    popd >/dev/null
    local stage="$(mktemp -d)"
    mkdir -p "$stage/${name}"
    rsync -a --exclude ".git" --exclude "node_modules/.cache" \
      "${dir}/" "$stage/${name}/"
    local tarname="fleethub-${name}-${VERSION}.tar.gz"
    tar -C "$stage" -czf "${ART_DIR}/${tarname}" .
    rm -rf "$stage"
    log "artifact: ${ART_DIR}/${tarname}"
  elif [[ -d "${ROOT_DIR}/ui" ]]; then
    dir="${ROOT_DIR}/ui"
    local name="ui"
    log "build ${name}"
    pushd "$dir" >/dev/null
    if [[ -f package.json ]]; then
      if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
      if npm run | grep -qE '^\s*build\s'; then
        npm run build
      fi
      npm prune --omit=dev || true
    fi
    popd >/dev/null
    local stage="$(mktemp -d)"
    mkdir -p "$stage/${name}"
    rsync -a --exclude ".git" --exclude "node_modules/.cache" \
      "${dir}/" "$stage/${name}/"
    local tarname="fleethub-${name}-${VERSION}.tar.gz"
    tar -C "$stage" -czf "${ART_DIR}/${tarname}" .
    rm -rf "$stage"
    log "artifact: ${ART_DIR}/${tarname}"
  else
    log "skip UI: not found"
  fi
}

build_node_service api
build_node_service provisioning-service
build_node_service twin-service
build_node_service registry-service
build_ui

log "done"
