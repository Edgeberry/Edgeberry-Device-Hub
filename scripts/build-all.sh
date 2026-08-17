#!/usr/bin/env bash
set -euo pipefail

# Clean build the Device Hub (single Node app at the repo root) plus the UI,
# and package everything as one release artifact.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="${ROOT_DIR}/dist-artifacts"
STAGE_DIR="$(mktemp -d)"

# Version from git tag or fallback
VERSION="${GITHUB_REF_NAME:-v0.0.0}"

log() { echo "[build-all] $*"; }
error() { echo "[build-all] ERROR: $*" >&2; exit 1; }

# Clean build the Device Hub app itself (repo root: src/ -> dist/)
build_app() {
  log "building devicehub..."
  (
    cd "$ROOT_DIR"

    # Clean install dependencies
    echo "[build-all] Installing dependencies..."
    rm -rf node_modules package-lock.json 2>/dev/null || true
    npm install --no-audit --no-fund || error "devicehub: npm install failed"

    # Clean build
    rm -rf dist .tsbuildinfo tsconfig.tsbuildinfo 2>/dev/null || true
    npm run build:app || error "devicehub: build failed"
    [[ -d dist && -n "$(ls -A dist)" ]] || error "devicehub: build produced no output in dist"

    # Remove dev dependencies
    echo "[build-all] Pruning dev dependencies..."
    npm prune --omit=dev || error "devicehub: npm prune failed"
  ) || error "devicehub: build failed"

  echo "[build-all] Staging runtime files..."
  cp -r "${ROOT_DIR}/dist" "${STAGE_DIR}/" || error "failed to copy dist"
  cp "${ROOT_DIR}/package.json" "${STAGE_DIR}/" || error "failed to copy package.json"
  [[ -f "${ROOT_DIR}/package-lock.json" ]] && cp "${ROOT_DIR}/package-lock.json" "${STAGE_DIR}/" || true
  if [[ -d "${ROOT_DIR}/node_modules" ]]; then
    echo "[build-all] Copying node_modules (this may take a moment)..."
    cp -r "${ROOT_DIR}/node_modules" "${STAGE_DIR}/" || error "failed to copy node_modules"
  fi

  log "✓ devicehub"
}

# Clean build UI
build_ui() {
  local dir="${ROOT_DIR}/ui"
  [[ -d "$dir" ]] || { log "skip ui: not found"; return 0; }

  log "building ui..."

  (
    cd "$dir"

    # Clean install and build
    echo "[build-all] Installing UI dependencies..."
    rm -rf node_modules package-lock.json dist build 2>/dev/null || true
    npm install --no-audit --no-fund || error "ui: npm install failed"
    echo "[build-all] Running UI build..."
    npm run build || error "ui: npm run build failed"

    # Find build output
    local build_dir
    [[ -d dist ]] && build_dir="dist" || build_dir="build"
    [[ -d "$build_dir" && -f "${build_dir}/index.html" ]] || error "ui: no build output found"

    echo "[build-all] Pruning UI dev dependencies..."
    npm prune --omit=dev || error "ui: npm prune failed"
  ) || error "ui: build failed"

  # Stage UI build output as 'ui/build' (matches UI_DIST)
  echo "[build-all] Staging UI build output..."
  mkdir -p "${STAGE_DIR}/ui" || error "ui: failed to create staging directory"
  if [[ -d "${dir}/dist" ]]; then
    cp -r "${dir}/dist" "${STAGE_DIR}/ui/build" || error "ui: failed to copy dist directory"
  else
    cp -r "${dir}/build" "${STAGE_DIR}/ui/build" || error "ui: failed to copy build directory"
  fi

  log "✓ ui"
}

# Clean artifacts directory
rm -rf "$ART_DIR"
mkdir -p "$ART_DIR"

build_ui
build_app

# Copy shared config and scripts
[[ -d "${ROOT_DIR}/config" ]] && cp -r "${ROOT_DIR}/config" "${STAGE_DIR}/"
[[ -d "${ROOT_DIR}/scripts" ]] && cp -r "${ROOT_DIR}/scripts" "${STAGE_DIR}/"

# Create artifact
ARTIFACT="devicehub-${VERSION}.tar.gz"
tar -C "$STAGE_DIR" -czf "${ART_DIR}/${ARTIFACT}" .
rm -rf "$STAGE_DIR"

log "✅ Build complete: ${ART_DIR}/${ARTIFACT}"
