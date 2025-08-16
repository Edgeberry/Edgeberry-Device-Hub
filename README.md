![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_hub.png)

<img src="documentation/devicehub.png" align="right" width="50%"/>

**A self-hostable device management service for Edgeberry devices.**

**Edgeberry Device Hub** is the single control plane for your Edgeberry fleet — a dashboard and API to onboard devices, manage their digital twins, and observe the system in real time.

Use it to:

- **Self-host a single dashboard** to operate your fleet on your own infrastructure (no vendor lock‑in).
- **Onboard devices securely** via MQTT + mTLS with a CSR-based bootstrap flow.
- **Manage certificates** in the UI: generate Root CA, issue provisioning certs, inspect/delete, and download ready-to-use bundles.
- **Maintain a device registry** with identity, status, tags, and last-seen presence.
- **Control digital twins**: read/update desired and reported state, with automatic deltas published to devices.
- **Monitor health and services**: view systemd unit status, version, and service logs (snapshot and live stream) from the dashboard.
- **Use a clean HTTP API and WebSocket** for automation and integrations; the Web UI consumes the same public endpoints.
- **Run lightweight and offline-friendly**: Node.js + SQLite, designed for small hosts; ships as `systemd` services.
- **Extend easily** with modular microservices while keeping a single public surface (`/` UI and `/api/*`).

<br clear="right"/>

## Getting Started

See the [alignment document](documentation/alignment.md) for detailed setup instructions and architecture overview.

## Description

Edgeberry Device Hub is a self-hostable device management server for Edgeberry devices. It provides a single, secure control plane to provision devices (MQTT + mTLS), observe telemetry, manage digital twins, and expose a clean HTTP API and UI. Internally, independent microservices communicate over D-Bus; devices communicate via MQTT.

## Services
Microservice architecture seperates the responsibilities. Each service is a separate process that communicates with the others via D-Bus.

- **Core Service**
  - Main HTTP service serving the Web UI and all `/api/*` endpoints. Handles authentication, coordinates with microservices via D-Bus.
  - Handles the configuration of the Device Hub, including the MQTT broker, D-Bus, and other services.

- **Provisioning Service**
  - Handles bootstrap and certificate lifecycle via MQTT-only CSR flow. Subscribes to `$devicehub/certificates/create-from-csr`, signs CSRs, and returns signed certs.
  - Upserts device records into SQLite table `devices` (fields: `id`, `name?`, `token?`, `meta?`, `created_at`)

- **Device Twin Service**
  - Owns desired/reported twin state. Persists state, generates deltas, and publishes twin updates over `$devicehub/devices/{deviceId}/twin/#`. Provides D-Bus methods for the core service to read/update twin state.
  - Persists desired/reported documents in SQLite tables `twin_desired` and `twin_reported`

- **Device Registry Service**
  - Authoritative inventory for devices. Stores identity anchors (device ID, cert metadata, optional manufacturer UUID hash), status, and operational context. Exposes a D-Bus interface to query/update registry data.
  - Persists device records in SQLite table `devices` (fields: `id`, `name?`, `token?`, `meta?`, `created_at`)

See `documentation/alignment.md` for architecture and interface details.

## MQTT API

| Topic | Direction | Description |
| --- | --- | --- |
| `$devicehub/certificates/create-from-csr` | Inbound | Create a new certificate from a CSR |
| `$devicehub/certificates/create-from-csr` | Outbound | Create a new certificate from a CSR | 
| `$devicehub/devices/{deviceId}/provision/request` | Inbound | Request a new device to be provisioned |
| `$devicehub/devices/{deviceId}/provision/accepted` | Outbound | Device has been provisioned |
| `$devicehub/devices/{deviceId}/provision/rejected` | Outbound | Device has been rejected |
| `$devicehub/devices/{deviceId}/twin/get` | Inbound | Request a new device to be provisioned |
| `$devicehub/devices/{deviceId}/twin/update` | Inbound | Request a new device to be provisioned |  
| `$devicehub/devices/{deviceId}/twin/update/accepted` | Outbound | Device has been provisioned |
| `$devicehub/devices/{deviceId}/twin/update/rejected` | Outbound | Device has been rejected |
| `$devicehub/devices/{deviceId}/twin/update/delta` | Outbound | Device has been rejected |

## Architecture (MVP)

- __Core-service (`core-service/`)__ serves the SPA and exposes JSON under `/api/*`.
- __Auth model__: single-user admin, JWT stored in HttpOnly cookie `dh_session`.
  - Endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
  - UI gates routes via `RequireAuth` in `ui/src/App.tsx`.
- __Certificates__ (Overview modal): Root CA generate/download; Provisioning certs issue/inspect/delete/download bundle.
  - Root CA: `GET/POST /api/settings/certs/root`, `GET /api/settings/certs/root/download`.
  - Provisioning: `GET/POST /api/settings/certs/provisioning`, `GET/DELETE /api/settings/certs/provisioning/:name`, `GET .../:name/download`.
- __Services & metrics__: `/api/services`, `/api/logs`, `/api/metrics` consumed by dashboard widgets.

## Development

- __Prereqs__: Node 18+, a local MQTT broker (e.g., Mosquitto) for metrics/device features.
- __Environment__ (core-service): `ADMIN_USER`, `ADMIN_PASSWORD`, `JWT_SECRET`, `JWT_TTL_SECONDS`, `MQTT_URL`.
- __Workflow__:
  1. Build UI first so core-service serves fresh SPA bundles:
     ```bash
     cd ui && npm run build
     ```
  2. Start core-service (dev or prod):
     ```bash
     # dev convenience
     npm run dev
     # or just core-service
     cd core-service && npm start
     ```
  3. Open http://localhost:8080 → login → open Certificates from the Overview page (top-right) to manage certificates and provisioning whitelist.
- __Gotchas__:
  - Hard refresh the browser after UI rebuilds to bust cache if needed.
  - All UI `fetch` calls include `credentials: 'include'` so the JWT cookie is sent.
  - Admin-only actions (e.g., service start/stop) are enabled after login.

## Current Implementation (MVP)

The repository contains a working MVP focused on MQTT- and SQLite-backed microservices with a minimal UI and example Node-RED node.

### Features present

- **Node-RED example (`examples/nodered/`)**
  - Node `edgeberry-device` (TypeScript) with settings: `host`, `uuid`, credential `token`
  - On input, logs "hello world" and forwards the message

### Build, run, and artifacts

- Build all artifacts:
  ```bash
  npm run build
  # outputs tarballs under dist-artifacts/
  ```

- Dev run (starts core + services, assumes a broker at MQTT_URL or localhost):
  ```bash
  npm run dev
  # core-service on http://localhost:8080
  ```

### Notes

- Services use `mqtt@4.x` (with built-in TypeScript types) and `better-sqlite3` for persistence.
- You need a working MQTT broker (e.g., Mosquitto) reachable at `MQTT_URL`.
- See `alignment.md` for deeper architecture, topic contracts, and security posture.

## License & Collaboration
**Copyright 2025 Sanne 'SpuQ' Santens**. The Edgeberry Device Hub project is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.