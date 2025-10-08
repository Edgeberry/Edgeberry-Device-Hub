#!/usr/bin/env bash
set -euo pipefail

# Clean build all microservices and package as single artifact
# Services: core-service, provisioning-service, twin-service, application-service, ui

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="${ROOT_DIR}/dist-artifacts"
STAGE_DIR="$(mktemp -d)"

# Build tracking
declare -a FAILED_SERVICES=()

# Version from git tag or fallback
VERSION="${GITHUB_REF_NAME:-v0.0.0}"

log() { echo "[build-all] $*"; }
error() { echo "[build-all] ERROR: $*" >&2; exit 1; }

# Clean build a Node.js service
build_service() {
  local svc="$1"
  local dir="${ROOT_DIR}/${svc}"
  
  [[ -f "${dir}/package.json" ]] || { log "skip ${svc}: no package.json"; return 0; }
  
  log "building ${svc}..."
  
  (
    cd "$dir"
    
    # Clean install dependencies
    echo "[build-all] Installing dependencies for ${svc}..."
    rm -rf node_modules package-lock.json 2>/dev/null || true
    npm install --no-audit --no-fund || error "${svc}: npm install failed"
    
    # Clean build
    rm -rf dist .tsbuildinfo tsconfig.tsbuildinfo 2>/dev/null || true
    
    # Build if script exists
    if grep -q '"build"' package.json; then
      echo "[build-all] Running build for ${svc}..."
      npm run build || error "${svc}: npm run build failed"
      [[ -d dist && -n "$(ls -A dist)" ]] || error "${svc}: build produced no output in dist directory"
      echo "[build-all] Build completed for ${svc}, dist directory contains $(ls -1 dist | wc -l) files"
    else
      echo "[build-all] No build script found for ${svc}, skipping build step"
    fi
    
    # Remove dev dependencies
    echo "[build-all] Pruning dev dependencies for ${svc}..."
    npm prune --omit=dev || error "${svc}: npm prune failed"
  ) || { FAILED_SERVICES+=("${svc}"); error "${svc}: build failed"; }
  
  # Stage runtime files
  echo "[build-all] Staging runtime files for ${svc}..."
  mkdir -p "${STAGE_DIR}/${svc}" || error "${svc}: failed to create staging directory"
  
  # Verify dist directory exists if build script was present
  if grep -q '"build"' "${dir}/package.json"; then
    [[ -d "${dir}/dist" ]] || error "${svc}: dist directory missing after build"
    echo "[build-all] Copying dist directory for ${svc}..."
    cp -r "${dir}/dist" "${STAGE_DIR}/${svc}/" || error "${svc}: failed to copy dist directory"
  fi
  
  cp "${dir}/package.json" "${STAGE_DIR}/${svc}/" || error "${svc}: failed to copy package.json"
  [[ -f "${dir}/package-lock.json" ]] && cp "${dir}/package-lock.json" "${STAGE_DIR}/${svc}/" || true
  
  # Include node_modules with production dependencies
  if [[ -d "${dir}/node_modules" ]]; then
    echo "[build-all] Copying node_modules for ${svc} (this may take a moment)..."
    cp -r "${dir}/node_modules" "${STAGE_DIR}/${svc}/" || error "${svc}: failed to copy node_modules"
  fi
  
  log "✓ ${svc}"
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
  ) || { FAILED_SERVICES+=("ui"); error "ui: build failed"; }
  
  # Stage UI build output as 'build' directory for core-service compatibility
  echo "[build-all] Staging UI build output..."
  mkdir -p "${STAGE_DIR}/ui" || error "ui: failed to create staging directory"
  if [[ -d "${dir}/dist" ]]; then
    echo "[build-all] Copying UI dist directory..."
    cp -r "${dir}/dist" "${STAGE_DIR}/ui/build" || error "ui: failed to copy dist directory"
  else
    echo "[build-all] Copying UI build directory..."
    cp -r "${dir}/build" "${STAGE_DIR}/ui/build" || error "ui: failed to copy build directory"
  fi
  
  log "✓ ui"
}

# Clean artifacts directory
rm -rf "$ART_DIR"
mkdir -p "$ART_DIR"

# Build all services
build_ui
build_service core-service
build_service provisioning-service
build_service twin-service
build_service application-service

# Copy shared config and scripts
[[ -d "${ROOT_DIR}/config" ]] && cp -r "${ROOT_DIR}/config" "${STAGE_DIR}/"
[[ -d "${ROOT_DIR}/scripts" ]] && cp -r "${ROOT_DIR}/scripts" "${STAGE_DIR}/"

# Create artifact
ARTIFACT="devicehub-${VERSION}.tar.gz"
tar -C "$STAGE_DIR" -czf "${ART_DIR}/${ARTIFACT}" .
rm -rf "$STAGE_DIR"

log "✅ Build complete: ${ART_DIR}/${ARTIFACT}"

# Report any failures
if [[ ${#FAILED_SERVICES[@]} -gt 0 ]]; then
  error "Failed services: ${FAILED_SERVICES[*]}"
fi
