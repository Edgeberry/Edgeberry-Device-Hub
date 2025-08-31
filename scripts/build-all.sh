#!/usr/bin/env bash
set -euo pipefail

# Build artifacts for each microservice and package as a single tar.gz under dist-artifacts/
# Services covered: provisioning-service, twin-service, core-service, ui
# This script is CI-friendly and can be run locally.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ART_DIR="${ROOT_DIR}/dist-artifacts"
mkdir -p "$ART_DIR"

# Staging directory for the combined artifact (single tarball only)
COMBINED_STAGE="$(mktemp -d)"

# Build tracking variables
declare -a BUILD_RESULTS=()
declare -a FAILED_SERVICES=()
BUILD_SUCCESS=true

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
log_error() { echo "[build-all] ERROR: $*" >&2; }
log_success() { echo "[build-all] SUCCESS: $*"; }
log_fail() { echo "[build-all] FAILED: $*" >&2; }

build_node_service() {
  local svc="$1"; shift
  local dir="${ROOT_DIR}/${svc}"
  local build_start_time=$(date +%s)
  
  if [[ ! -f "${dir}/package.json" ]]; then
    log "skip ${svc}: no package.json"
    BUILD_RESULTS+=("${svc}: SKIPPED (no package.json)")
    return 0
  fi
  
  log "build ${svc}"
  
  # Capture build output and errors
  local build_log=$(mktemp)
  local build_failed=false
  
  {
    pushd "$dir" >/dev/null
    
    # Install deps (prefer ci, but fall back to install if lock is out of sync)
    if [[ -f package-lock.json ]]; then
      npm ci || npm install
    else
      npm install
    fi
    
    # Build if script exists
    if npm run | grep -qE '^\s*build\s'; then
      # Ensure a clean build to prevent stale dist/ from being packaged
      rm -rf dist 2>/dev/null || true
      # Clear TypeScript incremental cache
      rm -rf .tsbuildinfo tsconfig.tsbuildinfo 2>/dev/null || true
      # Force clean build without cache
      npm run build -- --force
    fi
    
    # Prune dev deps for artifact
    npm prune --omit=dev || true
    popd >/dev/null
    
    # Stage files into the combined artifact directory (whitelist only runtime assets)
    mkdir -p "$COMBINED_STAGE/${svc}"
    # Always include compiled output and package manifests
    if [[ -d "${dir}/dist" ]]; then
      rsync -a "${dir}/dist/" "$COMBINED_STAGE/${svc}/dist/"
    fi
    if [[ -f "${dir}/package.json" ]]; then
      rsync -a "${dir}/package.json" "$COMBINED_STAGE/${svc}/package.json"
    fi
    if [[ -f "${dir}/package-lock.json" ]]; then
      rsync -a "${dir}/package-lock.json" "$COMBINED_STAGE/${svc}/package-lock.json"
    fi
    # Optionally include service-local scripts needed at runtime (no source or data directories)
    if [[ -d "${dir}/scripts" ]]; then
      rsync -a "${dir}/scripts/" "$COMBINED_STAGE/${svc}/scripts/"
    fi
    # Include any environment files but do NOT copy source code
    if compgen -G "${dir}/.env*" > /dev/null; then
      rsync -a ${dir}/.env* "$COMBINED_STAGE/${svc}/" 2>/dev/null || true
    fi
    # Ensure full config directory is included in the combined artifact once
    if [[ ! -d "$COMBINED_STAGE/config" ]]; then
      if [[ -d "${ROOT_DIR}/config" ]]; then
        mkdir -p "$COMBINED_STAGE/config"
        # Copy everything under config (certs, ACLs, systemd units, broker configs)
        rsync -a "${ROOT_DIR}/config/" "$COMBINED_STAGE/config/"
      fi
    fi
    # Ensure root scripts directory (including device_mqtt_test.sh) is included once
    if [[ ! -d "$COMBINED_STAGE/scripts" ]]; then
      if [[ -d "${ROOT_DIR}/scripts" ]]; then
        mkdir -p "$COMBINED_STAGE/scripts"
        rsync -a "${ROOT_DIR}/scripts/" "$COMBINED_STAGE/scripts/"
      fi
    fi
    
  } > "$build_log" 2>&1 || build_failed=true
  
  local build_end_time=$(date +%s)
  local build_duration=$((build_end_time - build_start_time))
  
  if [[ "$build_failed" == "true" ]]; then
    log_fail "${svc} (${build_duration}s)"
    echo "Build log for ${svc}:" >&2
    cat "$build_log" >&2
    BUILD_SUCCESS=false
    FAILED_SERVICES+=("${svc}")
    BUILD_RESULTS+=("${svc}: FAILED (${build_duration}s)")
  else
    log_success "${svc} (${build_duration}s)"
    BUILD_RESULTS+=("${svc}: SUCCESS (${build_duration}s)")
    log "staged: ${svc}"
  fi
  
  rm -f "$build_log"
}

build_ui() {
  local dir
  local name="ui"
  local build_start_time=$(date +%s)
  
  if [[ -d "${ROOT_DIR}/ui" ]]; then
    dir="${ROOT_DIR}/ui"
    log "build ${name}"
    
    # Capture build output and errors
    local build_log=$(mktemp)
    local build_failed=false
    
    {
      pushd "$dir" >/dev/null
      if [[ -f package.json ]]; then
        if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
        if npm run | grep -qE '^\s*build\s'; then
          npm run build
          # Determine output dir (vite default is dist/ unless configured)
          local OUT_DIR=""
          if [[ -f "build/index.html" ]]; then OUT_DIR="build"; fi
          if [[ -z "$OUT_DIR" && -f "dist/index.html" ]]; then OUT_DIR="dist"; fi
          if [[ -z "$OUT_DIR" ]]; then
            echo "ERROR: UI build output missing (expected ui/build/ or ui/dist/)" >&2
            exit 1
          fi
          export UI_BUILD_OUT="$OUT_DIR"
        fi
        npm prune --omit=dev || true
      fi
      popd >/dev/null
      
      mkdir -p "$COMBINED_STAGE/${name}"
      # Only stage built static assets for the UI
      # Normalize any OUT_DIR (build/ or dist/) to staged ui/build/ to match core-service UI_DIST default
      if [[ -d "${dir}/build" ]]; then
        rsync -a --delete "${dir}/build/" "$COMBINED_STAGE/${name}/build/"
      elif [[ -d "${dir}/dist" ]]; then
        rsync -a --delete "${dir}/dist/" "$COMBINED_STAGE/${name}/build/"
      else
        echo "ERROR: No UI build output directory to stage (looked for build/ and dist/)" >&2
        exit 1
      fi
      
    } > "$build_log" 2>&1 || build_failed=true
    
    local build_end_time=$(date +%s)
    local build_duration=$((build_end_time - build_start_time))
    
    if [[ "$build_failed" == "true" ]]; then
      log_fail "${name} (${build_duration}s)"
      echo "Build log for ${name}:" >&2
      cat "$build_log" >&2
      BUILD_SUCCESS=false
      FAILED_SERVICES+=("${name}")
      BUILD_RESULTS+=("${name}: FAILED (${build_duration}s)")
    else
      log_success "${name} (${build_duration}s)"
      BUILD_RESULTS+=("${name}: SUCCESS (${build_duration}s)")
      log "staged: ${name}"
    fi
    
    rm -f "$build_log"
  else
    log "skip UI: not found"
    BUILD_RESULTS+=("${name}: SKIPPED (not found)")
  fi
}

# Build UI first so other services (e.g., core-service) can rely on its presence
build_ui

build_node_service core-service
build_node_service provisioning-service
build_node_service twin-service
build_node_service translator-service

# Create a single combined tarball from the staged content only
if [[ -d "$COMBINED_STAGE" ]] && [[ "$BUILD_SUCCESS" == "true" ]]; then
  COMBINED_TAR="devicehub-${VERSION}.tar.gz"
  rm -f "${ART_DIR}/${COMBINED_TAR}" || true
  TMP_OUT="${ROOT_DIR}/${COMBINED_TAR}"
  tar -C "$COMBINED_STAGE" -czf "$TMP_OUT" .
  mv "$TMP_OUT" "${ART_DIR}/${COMBINED_TAR}"
  log "combined artifact: ${ART_DIR}/${COMBINED_TAR}"
  rm -rf "$COMBINED_STAGE"
elif [[ "$BUILD_SUCCESS" == "false" ]]; then
  log_error "Skipping artifact creation due to build failures"
  rm -rf "$COMBINED_STAGE" 2>/dev/null || true
fi

# Print build summary
echo ""
echo "========================================="
echo "BUILD SUMMARY"
echo "========================================="
for result in "${BUILD_RESULTS[@]}"; do
  if [[ "$result" == *"FAILED"* ]]; then
    echo "❌ $result"
  elif [[ "$result" == *"SUCCESS"* ]]; then
    echo "✅ $result"
  else
    echo "⏭️  $result"
  fi
done
echo "========================================="

if [[ "$BUILD_SUCCESS" == "true" ]]; then
  log_success "All builds completed successfully"
  echo "Build Status: SUCCESS ✅"
  exit 0
else
  log_error "Build failed for: ${FAILED_SERVICES[*]}"
  echo "Build Status: FAILED ❌"
  echo "Failed Services: ${FAILED_SERVICES[*]}"
  exit 1
fi
