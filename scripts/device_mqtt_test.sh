#!/usr/bin/env bash
set -euo pipefail

# Device-side MQTT integration test script
# - Verifies mTLS connect + ACL mapping
# - Exercises provisioning flow
# - Exercises twin get/update flows
# - Publishes telemetry
#
# Requirements on device:
#   - mosquitto_pub and mosquitto_sub installed
#   - Device certificate CN must equal DEVICE_ID for ACL patterns
#
# Config via env vars (override as needed):
MQTT_URL="${MQTT_URL:-mqtts://localhost:8883}"
MQTT_TLS_CA="${MQTT_TLS_CA:-/etc/mosquitto/certs/ca.crt}"
MQTT_TLS_CERT="${MQTT_TLS_CERT:-/etc/mosquitto/certs/my-device.crt}"
MQTT_TLS_KEY="${MQTT_TLS_KEY:-/etc/mosquitto/certs/my-device.key}"
MQTT_TLS_REJECT_UNAUTHORIZED="${MQTT_TLS_REJECT_UNAUTHORIZED:-true}"
DEVICE_ID="${DEVICE_ID:-}"
TIMEOUT_SEC="${TIMEOUT_SEC:-10}"

# If DEVICE_ID is not provided, try to read CN from the client cert
if [[ -z "${DEVICE_ID}" && -f "${MQTT_TLS_CERT}" ]]; then
  SUBJECT=$(openssl x509 -in "${MQTT_TLS_CERT}" -noout -subject 2>/dev/null || true)
  # Extract CN using sed
  DEVICE_ID=$(sed -n 's/^subject=.*CN=\([^,/]*\).*/\1/p' <<<"${SUBJECT}" | head -n1)
fi

if [[ -z "${DEVICE_ID}" ]]; then
  echo "ERROR: DEVICE_ID not set and could not infer CN from ${MQTT_TLS_CERT}" >&2
  exit 1
fi

INSECURE_FLAG=()
if [[ "${MQTT_TLS_REJECT_UNAUTHORIZED}" == "false" ]]; then
  INSECURE_FLAG=(--insecure)
fi

PUB=(mosquitto_pub --url "${MQTT_URL}" --cafile "${MQTT_TLS_CA}" --cert "${MQTT_TLS_CERT}" --key "${MQTT_TLS_KEY}" "${INSECURE_FLAG[@]}")
SUB=(mosquitto_sub --url "${MQTT_URL}" --cafile "${MQTT_TLS_CA}" --cert "${MQTT_TLS_CERT}" --key "${MQTT_TLS_KEY}" "${INSECURE_FLAG[@]}")

req() {
  echo -e "\n==> $*" >&2
}

ok() {
  echo "[OK] $*" >&2
}

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

require_tools() {
  command -v mosquitto_pub >/dev/null || fail "mosquitto_pub not found"
  command -v mosquitto_sub >/dev/null || fail "mosquitto_sub not found"
}

# Test 1: Basic connectivity and ACL (device namespace read/write)
# - Publish to devices/${DEVICE_ID}/test
# - Subscribe to same topic and verify message
basic_connectivity() {
  req "Basic connectivity & ACL test (devices/${DEVICE_ID}/test)"
  local topic="devices/${DEVICE_ID}/test"
  local payload="hello-$(date +%s)"
  # Start subscriber in background to capture one message
  timeout "${TIMEOUT_SEC}" "${SUB[@]}" -C 1 -t "${topic}" > /tmp/mqtt_test_echo.$$ &
  local sub_pid=$!
  # Give sub a moment to attach
  sleep 0.3
  # Publish
  "${PUB[@]}" -t "${topic}" -m "${payload}" || fail "publish failed (ACL/connectivity)"
  wait ${sub_pid} || true
  if grep -q "${payload}" /tmp/mqtt_test_echo.$$; then
    ok "Echo received on ${topic}"
  else
    fail "Did not receive echo on ${topic} (check ACLs and CN mapping)"
  fi
  rm -f /tmp/mqtt_test_echo.$$
}

# Test 2: Provisioning flow
# - Sub to accepted/rejected
# - Pub request on $devicehub/devices/${DEVICE_ID}/provision/request
provisioning_test() {
  req "Provisioning test"
  local req_t="$devicehub/devices/${DEVICE_ID}/provision/request"
  local acc_t="$devicehub/devices/${DEVICE_ID}/provision/accepted"
  local rej_t="$devicehub/devices/${DEVICE_ID}/provision/rejected"

  # Start listener for accepted/rejected
  timeout "${TIMEOUT_SEC}" "${SUB[@]}" -v -t "${acc_t}" -t "${rej_t}" > /tmp/mqtt_prov_resp.$$ &
  local sub_pid=$!
  sleep 0.3

  # Publish request
  local payload
  payload=$(jq -n --arg id "${DEVICE_ID}" --arg ts "$(date -Is)" '{name:"Test Device "+$id, meta:{ts:$ts}}' 2>/dev/null || echo '{"name":"Test Device","meta":{"ts":"'"$(date -Is)"'"}}')
  "${PUB[@]}" -t "${req_t}" -m "${payload}" -q 1 || fail "publish provision request failed"

  # Await response
  wait ${sub_pid} || true
  if grep -q "${acc_t}" /tmp/mqtt_prov_resp.$$; then
    ok "Provisioning accepted"
  elif grep -q "${rej_t}" /tmp/mqtt_prov_resp.$$; then
    fail "Provisioning rejected"
  else
    fail "No provisioning response received (service down or ACL mismatch)"
  fi
  rm -f /tmp/mqtt_prov_resp.$$
}

# Test 3: Twin get/update flow
# - Sub to update/accepted, update/rejected, delta
# - Pub get and update
#   Topics per ACL: $devicehub/devices/${DEVICE_ID}/twin/*
twin_test() {
  req "Twin test"
  local get_t="$devicehub/devices/${DEVICE_ID}/twin/get"
  local upd_t="$devicehub/devices/${DEVICE_ID}/twin/update"
  local acc_t="$devicehub/devices/${DEVICE_ID}/twin/update/accepted"
  local rej_t="$devicehub/devices/${DEVICE_ID}/twin/update/rejected"
  local delta_t="$devicehub/devices/${DEVICE_ID}/twin/delta"

  timeout "${TIMEOUT_SEC}" "${SUB[@]}" -v -t "${acc_t}" -t "${rej_t}" -t "${delta_t}" > /tmp/mqtt_twin_resp.$$ &
  local sub_pid=$!
  sleep 0.3

  # Publish get
  "${PUB[@]}" -t "${get_t}" -n -q 1 || fail "publish twin get failed"
  # Publish update
  local desired
  desired=$(jq -n --arg ts "$(date -Is)" '{desired:{ping:$ts}}' 2>/dev/null || echo '{"desired":{"ping":"'"$(date -Is)"'"}}')
  "${PUB[@]}" -t "${upd_t}" -m "${desired}" -q 1 || fail "publish twin update failed"

  wait ${sub_pid} || true
  if grep -q "${rej_t}" /tmp/mqtt_twin_resp.$$; then
    fail "Twin update rejected"
  fi
  if grep -q "${acc_t}" /tmp/mqtt_twin_resp.$$; then
    ok "Twin update accepted"
  else
    echo "NOTE: No twin response observed; service might be down or using different topics" >&2
  fi
  if grep -q "${delta_t}" /tmp/mqtt_twin_resp.$$; then
    ok "Twin delta received"
  else
    echo "NOTE: No twin delta observed (may be expected if state unchanged)" >&2
  fi
  rm -f /tmp/mqtt_twin_resp.$$
}

# Test 4: Telemetry publish (registry backend consumes)
telemetry_test() {
  req "Telemetry publish"
  local tele_t="devices/${DEVICE_ID}/telemetry"
  local m
  m=$(jq -n --arg ts "$(date +%s)" '{ts: ($ts|tonumber), temp: (20 + (now%5)) }' 2>/dev/null || echo '{"ts":'"$(date +%s)"',"temp":22.1}')
  "${PUB[@]}" -t "${tele_t}" -m "${m}" || fail "telemetry publish failed"
  ok "Telemetry published to ${tele_t}"
}

usage() {
  cat <<USAGE
Device-side MQTT test
Env vars:
  MQTT_URL (default: ${MQTT_URL})
  MQTT_TLS_CA (default: ${MQTT_TLS_CA})
  MQTT_TLS_CERT (default: ${MQTT_TLS_CERT})
  MQTT_TLS_KEY (default: ${MQTT_TLS_KEY})
  MQTT_TLS_REJECT_UNAUTHORIZED (default: ${MQTT_TLS_REJECT_UNAUTHORIZED})
  DEVICE_ID (default: CN from cert)
  TIMEOUT_SEC (default: ${TIMEOUT_SEC})

Examples:
  DEVICE_ID=my-device MQTT_TLS_CERT=/opt/Edgeberry/devicehub/config/certs/my-device.crt \
  MQTT_TLS_KEY=/opt/Edgeberry/devicehub/config/certs/my-device.key \
  MQTT_TLS_CA=/etc/mosquitto/certs/ca.crt \
  bash scripts/device_mqtt_test.sh
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_tools
basic_connectivity
provisioning_test || true
# Continue even if provisioning not responding, to test twin/telemetry if broker up

twin_test || true
telemetry_test

echo "\nAll tests attempted. Review above for [OK]/[FAIL]/NOTE." >&2
