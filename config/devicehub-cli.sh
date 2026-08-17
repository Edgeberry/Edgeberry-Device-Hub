#!/bin/bash
# Edgeberry Device Hub admin CLI wrapper.
# Installed as /usr/local/bin/devicehub. Sources devicehub.env so it talks
# to the same persistent database the service uses, then hands off to the
# actual implementation (src/cli.ts, compiled to dist/cli.js).
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "ERROR: devicehub must be run as root (sudo)" >&2
  exit 1
fi

ENV_FILE="/etc/Edgeberry/devicehub/devicehub.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

exec node /opt/Edgeberry/devicehub/dist/cli.js "$@"
