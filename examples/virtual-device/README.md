# Edgeberry Virtual Device

A simple virtual device used to test provisioning and MQTT connectivity against a running Edgeberry Device Hub.

## Prerequisites
- A deployed Device Hub with Core API and Mosquitto running (remote host/IP)
- Node.js 18+

## Quick Start (Remote Host)
Replace the host/IP if different.

```bash
# Install dependencies for the virtual device
npm --prefix examples/virtual-device ci

# Run the virtual device against your remote host
PROV_API_BASE=http://192.168.1.116 \
MQTT_URL=mqtts://192.168.1.116:8883 \
DEVICE_ID=my-device-01 \
npm --prefix examples/virtual-device run dev
```

Notes:
- The virtual device will:
  - Fetch bootstrap TLS materials from the Core API:
    - `GET /api/provisioning/certs/ca.crt`
    - `GET /api/provisioning/certs/provisioning.crt`
    - `GET /api/provisioning/certs/provisioning.key`
  - Connect to the broker over mTLS and publish provisioning request
  - On acceptance, reconnect with the issued device certificate and start sending telemetry
- Optional environment variables:
  - `PROV_UUID`: whitelist UUID to test gated provisioning
  - `ALLOW_SELF_SIGNED=true`: allow self-signed TLS when fetching over HTTP/HTTPS (defaults to true when `PROV_API_BASE` is set)
  - `TELEMETRY_PERIOD_MS`: telemetry interval (default 3000)
  - `DEVICE_CERT_OUT` / `DEVICE_KEY_OUT`: paths to save generated runtime cert/key

## Local Broker (Development)
If you’re running everything locally with the dev broker:
```bash
npm --prefix examples/virtual-device ci
MQTT_URL=mqtts://127.0.0.1:8883 \
PROV_API_BASE=http://127.0.0.1:8080 \
DEVICE_ID=vd-local-01 \
npm --prefix examples/virtual-device run dev
```
