#!/usr/bin/env bash
# Edgeberry Device Hub dev orchestrator
# Starts Mosquitto (dev config) and all TypeScript microservices concurrently for local development.
# Stops everything cleanly on Ctrl-C.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_PREFIX="[dev]"
PIDS=()

# Graceful shutdown
shutdown_all() {
  echo "$LOG_PREFIX shutting down..."
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
      wait "$pid" || true
    fi
  done
  exit 0
}
trap shutdown_all INT TERM

log() { echo "$LOG_PREFIX $*"; }

# Run a command in background with line-buffered, prefixed output
run_prefixed() {
  local name="$1"; shift
  (
    # Use stdbuf to force line-buffered stdout/stderr where available
    if command -v stdbuf >/dev/null 2>&1; then
      stdbuf -oL -eL "$@"
    else
      "$@"
    fi
  ) 2>&1 | awk -v p="[$name]" '{print p, $0}' &
  PIDS+=("$!")
}

has_npm_script() {
  local dir="$1"; local name="$2"
  [[ -f "$dir/package.json" ]] || return 1
  node -e "const p=require('$dir/package.json'); process.exit(p.scripts&&p.scripts['$name']?0:1)" 2>/dev/null
}

start_mosquitto() {
  local conf
  if [[ -f "$ROOT_DIR/mqtt-broker/dev.conf" ]]; then
    conf="$ROOT_DIR/mqtt-broker/dev.conf"
  elif [[ -f "$ROOT_DIR/config/mosquitto-dev.conf" ]]; then
    conf="$ROOT_DIR/config/mosquitto-dev.conf"
  elif [[ -f "$ROOT_DIR/config/mosquitto.conf" ]]; then
    conf="$ROOT_DIR/config/mosquitto.conf"
  else
    log "mosquitto config not found; skipping broker startup"
    return 0
  fi
  if ! command -v mosquitto >/dev/null 2>&1; then
    log "mosquitto not installed; skipping broker startup"
    return 0
  fi
  log "starting mosquitto with $conf"
  run_prefixed mosquitto mosquitto -c "$conf" -v
}

start_service() {
  local name="$1"; local dir="$ROOT_DIR/$2"
  if [[ ! -f "$dir/package.json" ]]; then
    log "skip $name: no package.json in $dir"
    return 0
  fi
  pushd "$dir" >/dev/null
  # Prepare MQTT mTLS env for known services (MVP)
  local -a ENV_VARS=()
  case "$name" in
    provisioning-service)
      ENV_VARS+=("MQTT_URL=mqtts://localhost:8883")
      ENV_VARS+=("MQTT_TLS_CA=$ROOT_DIR/config/certs/ca.crt")
      ENV_VARS+=("MQTT_TLS_CERT=$ROOT_DIR/config/certs/provisioning.crt")
      ENV_VARS+=("MQTT_TLS_KEY=$ROOT_DIR/config/certs/provisioning.key")
      ENV_VARS+=("MQTT_TLS_REJECT_UNAUTHORIZED=true")
      ;;
    twin-service)
      ENV_VARS+=("MQTT_URL=mqtts://localhost:8883")
      ENV_VARS+=("MQTT_TLS_CA=$ROOT_DIR/config/certs/ca.crt")
      ENV_VARS+=("MQTT_TLS_CERT=$ROOT_DIR/config/certs/twin.crt")
      ENV_VARS+=("MQTT_TLS_KEY=$ROOT_DIR/config/certs/twin.key")
      ENV_VARS+=("MQTT_TLS_REJECT_UNAUTHORIZED=true")
      ;;
    registry-service)
      ENV_VARS+=("MQTT_URL=mqtts://localhost:8883")
      ENV_VARS+=("MQTT_TLS_CA=$ROOT_DIR/config/certs/ca.crt")
      ENV_VARS+=("MQTT_TLS_CERT=$ROOT_DIR/config/certs/registry.crt")
      ENV_VARS+=("MQTT_TLS_KEY=$ROOT_DIR/config/certs/registry.key")
      ENV_VARS+=("MQTT_TLS_REJECT_UNAUTHORIZED=true")
      ;;
  esac
  local cmd
  if has_npm_script "$dir" dev; then
    cmd=(env "${ENV_VARS[@]}" npm run dev)
  elif [[ -x node_modules/.bin/tsx && -f src/index.ts ]]; then
    cmd=(env "${ENV_VARS[@]}" node_modules/.bin/tsx watch src/index.ts)
  elif command -v npx >/dev/null 2>&1 && [[ -f src/index.ts ]]; then
    cmd=(env "${ENV_VARS[@]}" npx -y tsx watch src/index.ts)
  elif has_npm_script "$dir" start; then
    cmd=(env "${ENV_VARS[@]}" npm start)
  elif [[ -f dist/index.js ]]; then
    cmd=(env "${ENV_VARS[@]}" node dist/index.js)
  elif [[ -x node_modules/.bin/nodemon && -f src/index.ts ]]; then
    cmd=(env "${ENV_VARS[@]}" node_modules/.bin/nodemon --exec "node --loader ts-node/esm" src/index.ts)
  elif command -v npx >/dev/null 2>&1 && [[ -f src/index.ts ]]; then
    cmd=(env "${ENV_VARS[@]}" npx -y ts-node src/index.ts)
  else
    log "WARN: cannot determine start command for $name"
    popd >/dev/null
    return 0
  fi
  log "starting $name: ${cmd[*]} (NODE_ENV=development)"
  run_prefixed "$name" env NODE_ENV=development "${cmd[@]}"
  popd >/dev/null
}

# Ensure node modules for each service (fast path; optional)
ensure_deps() {
  local dir="$1"
  if [[ -f "$dir/package.json" ]]; then
    pushd "$dir" >/dev/null
    if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
    popd >/dev/null
  fi
}

ensure_deps "$ROOT_DIR/core-service"
ensure_deps "$ROOT_DIR/provisioning-service"
ensure_deps "$ROOT_DIR/twin-service"
ensure_deps "$ROOT_DIR/registry-service"

if [[ "${DEV_MOSQUITTO:-0}" = "1" ]]; then
  start_mosquitto
else
  log "skipping mosquitto (set DEV_MOSQUITTO=1 to enable)"
fi

# Build UI once if needed and serve it from core-service
build_ui_if_needed() {
  local ui_dir="$ROOT_DIR/ui"
  if [[ ! -d "$ui_dir" ]]; then
    log "UI project not present; skipping UI build"
    return 0
  fi
  ensure_deps "$ui_dir"
  if [[ ! -f "$ui_dir/build/index.html" ]]; then
    log "building UI for dev serving (no HMR)"
    pushd "$ui_dir" >/dev/null
    npm run build
    popd >/dev/null
  else
    log "UI build found; skipping rebuild"
  fi
}

build_ui_if_needed

# Core-service exposes both API and UI on port 8080 in development
# Pass UI_DIST to point at the UI build output
if [[ -d "$ROOT_DIR/ui/build" ]]; then
  export UI_DIST="$ROOT_DIR/ui/build"
fi

# Optionally watch and rebuild UI on changes (no HMR, just incremental build)
# Enable by default; set DEV_UI_WATCH=0 to disable
if [[ -d "$ROOT_DIR/ui" && "${DEV_UI_WATCH:-1}" = "1" ]]; then
  log "starting UI build watcher (vite build --watch)"
  run_prefixed ui-build bash -lc "cd \"$ROOT_DIR/ui\" && npm run build -- --watch"
fi
start_service core-service core-service
start_service provisioning-service provisioning-service
start_service twin-service twin-service
start_service registry-service registry-service

log "all dev processes started (PIDs: ${PIDS[*]-}). Core-service listening on http://localhost:8080. Press Ctrl-C to stop."

# Wait on any to exit, then shutdown all
wait -n || true
shutdown_all
