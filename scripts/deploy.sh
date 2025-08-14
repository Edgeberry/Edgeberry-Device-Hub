#!/usr/bin/env bash
set -euo pipefail

# Deploy Edgeberry Fleet Hub to a local testing server
# - Builds the UI with Vite into ui/build
# - Builds the core-service (Express) into core-service/dist
# - Starts the core-service in production mode, serving UI from ui/build

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT_DIR/ui"
CORE_DIR="$ROOT_DIR/core-service"
PORT="${PORT:-8080}"

info() { echo -e "\033[1;34m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy]\033[0m $*"; }
err()  { echo -e "\033[1;31m[deploy]\033[0m $*"; }

info "Working directory: $ROOT_DIR"

# 1) Build UI
info "Installing UI dependencies (if needed) and building UI..."
pushd "$UI_DIR" >/dev/null
if [ -f package-lock.json ]; then
  npm ci
else
  npm install --no-fund
fi
npm run build
popd >/dev/null

# 2) Build core-service
info "Installing core-service dependencies (if needed) and building core-service..."
pushd "$CORE_DIR" >/dev/null
if [ -f package-lock.json ]; then
  npm ci
else
  npm install --no-fund
fi
npm run build
popd >/dev/null

# 3) Start server
info "Starting core-service on http://localhost:$PORT (NODE_ENV=production)"
info "Serving UI from: $UI_DIR/build"

export NODE_ENV=production
export UI_DIST="$UI_DIR/build"
export PORT="$PORT"

# Use exec so that Ctrl-C stops the server cleanly
exec node "$CORE_DIR/dist/index.js"
