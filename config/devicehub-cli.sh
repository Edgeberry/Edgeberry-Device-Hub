#!/bin/bash
# Edgeberry Device Hub admin CLI wrapper.
# Installed as /usr/local/bin/devicehub. Sources core.env so it talks to the
# same persistent database core-service uses, then hands off to the actual
# implementation (core-service/src/cli.ts, compiled to dist/cli.js).
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "ERROR: devicehub must be run as root (sudo)" >&2
  exit 1
fi

ENV_FILE="/etc/Edgeberry/devicehub/core.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

exec node /opt/Edgeberry/devicehub/core-service/dist/cli.js "$@"
