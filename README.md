![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_hub.png)

**A self-hostable device management service for Edgeberry devices.**

**Edgeberry Fleet Hub** acts as the central coordination layer in the Edgeberry ecosystem. It provides a structured way to onboard, monitor, and interact with your fleet of Edgeberry devices - serving as the interface between physical devices and their digital presence.

It’s designed to be lightweight, transparent, and fully under your control.

## Getting Started
[ToDo]

## Description

Edgeberry Fleet Hub is a self-hostable device management server for Edgeberry devices. It provides a single, secure control plane to provision devices (MQTT + mTLS), observe telemetry, manage digital twins, and expose a clean HTTP API and UI. Internally, independent microservices communicate over D-Bus; devices communicate via MQTT.

## Microservices

- **Core Orchestrator (`core-service/`)**
  - Hosts the Fleet Hub orchestrator HTTP service (default :8080) and serves the built Web UI from `ui/build` in production. Provides a health endpoint at `/healthz`. Intended as the entrypoint for users accessing the UI and, optionally, for light orchestration duties.

- **API (`api/`)**
  - Public HTTP surface for the Fleet Hub. Handles authn/z, exposes REST and WebSocket endpoints, talks to internal services over D-Bus, and attributes MQTT events to devices.

- **Provisioning Service (`provisioning-service/`)**
  - Handles bootstrap and certificate lifecycle via MQTT-only CSR flow. Subscribes to `$fleethub/certificates/create-from-csr`, signs CSRs, and returns signed certs. No digital twin responsibilities.

- **Device Twin Service (`twin-service/`)**
  - Owns desired/reported twin state. Persists state, generates deltas, and publishes twin updates over `$fleethub/devices/{deviceId}/twin/#`. Provides D-Bus methods for the API to read/update twin state.

- **Device Registry Service (`registry-service/`)**
  - Authoritative inventory for devices. Stores identity anchors (device ID, cert metadata, optional manufacturer UUID hash), status, and operational context. Exposes a D-Bus interface to query/update registry data.

- **Web UI (`ui/`)**
  - React SPA for dashboards, devices, events, and twin management. Consumes only public API/WebSocket endpoints.

See `alignment.md` for architecture and interface details.

## Architecture (MVP)

- __Core-service (`core-service/`)__ serves the SPA and exposes JSON under `/api/*`.
- __Auth model__: single-user admin, JWT stored in HttpOnly cookie `fh_session`.
  - Endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
  - UI gates routes via `RequireAuth` in `ui/src/App.tsx`.
- __Caching policy__: ETag disabled and strict no-cache headers on `/api/*` to avoid stale auth/UI state.
- __Certificates__ (Settings page): Root CA generate/download; Provisioning certs issue/inspect/delete/download bundle.
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
  3. Open http://localhost:8080 → login → navigate to Settings to manage certificates.
- __Gotchas__:
  - Hard refresh the browser after UI rebuilds to bust cache if needed.
  - All UI `fetch` calls include `credentials: 'include'` so the JWT cookie is sent.
  - Admin-only actions (e.g., service start/stop) are enabled after login.

## Current Implementation (MVP)

The repository contains a working MVP focused on MQTT- and SQLite-backed microservices with a minimal UI and example Node-RED node.

### Features present

- **Core service (`core-service/`)**
  - Serves the built Web UI on http://localhost:8080
  - Exposes basic endpoints used by the UI: `/api/health`, `/api/services`, `/api/logs`, `/api/version`, `/api/config/public`
  - Dev script `npm run dev` starts core and workers with hot reload (see `scripts/dev_start.sh`)

- **Provisioning service (`provisioning-service/`)**
  - Subscribes to `$fleethub/devices/{deviceId}/provision/request`
  - Upserts device records into SQLite table `devices` (fields: `id`, `name?`, `token?`, `meta?`, `created_at`)
  - Publishes `$fleethub/devices/{deviceId}/provision/accepted|rejected`
  - Env: `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `PROVISIONING_DB`

- **Twin service (`twin-service/`)**
  - Subscribes to `$fleethub/devices/{deviceId}/twin/get` and `.../twin/update`
  - Persists desired/reported documents in SQLite tables `twin_desired` and `twin_reported`
  - Publishes `.../twin/update/accepted` and `.../twin/update/delta`
  - Env: `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `TWIN_DB`

- **Registry service (`registry-service/`)**
  - Subscribes to `devices/#`
  - Persists raw events into SQLite `device_events` (`device_id`, `topic`, `payload` BLOB, `ts`)
  - Env: `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `REGISTRY_DB`

- **Web UI (`ui/`)**
  - React SPA built to `ui/build/`, served by core-service
  - Overview displays health, unit statuses, and sample devices/events placeholders

- **Node-RED example (`examples/nodered/`)**
  - Node `edgeberry-device` (TypeScript) with settings: `host`, `uuid`, credential `token`
  - On input, logs "hello world" and forwards the message

### MQTT topics (MVP subset)

- Provisioning (dev simplification):
  - Request: `$fleethub/devices/{deviceId}/provision/request`
  - Responses: `.../provision/accepted`, `.../provision/rejected`

- Twin:
  - Get: `$fleethub/devices/{deviceId}/twin/get` → responds on `.../twin/update/accepted`
  - Update: `$fleethub/devices/{deviceId}/twin/update` → `.../accepted`, optional `.../delta`

- Registry ingest:
  - Device publishes: `devices/{deviceId}/...` → persisted to `device_events`

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

- Individual service run (example):
  ```bash
  MQTT_URL="mqtt://localhost:1883" node provisioning-service/dist/index.js
  MQTT_URL="mqtt://localhost:1883" node twin-service/dist/index.js
  MQTT_URL="mqtt://localhost:1883" node registry-service/dist/index.js
  ```

- Produced artifacts (tar.gz) after build:
  - `dist-artifacts/fleethub-core-service-<version>.tar.gz`
  - `dist-artifacts/fleethub-provisioning-service-<version>.tar.gz`
  - `dist-artifacts/fleethub-twin-service-<version>.tar.gz`
  - `dist-artifacts/fleethub-registry-service-<version>.tar.gz`
  - `dist-artifacts/fleethub-ui-<version>.tar.gz`
  - CI also builds and uploads a packaged Node-RED example from `examples/nodered/`

### Notes

- Services use `mqtt@4.x` (with built-in TypeScript types) and `better-sqlite3` for persistence.
- You need a working MQTT broker (e.g., Mosquitto) reachable at `MQTT_URL`.
- See `alignment.md` for deeper architecture, topic contracts, and security posture.

## License & Collaboration
**Copyright 2024 Sanne 'SpuQ' Santens**. The Edgeberry Fleet Hub project is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.