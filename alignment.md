# Alignment Document – Edgeberry Fleet Hub

This file defines the foundational philosophy, design intent, and system architecture for the Edgeberry Fleet Hub. It exists to ensure that all contributors—human or artificial—are aligned with the core values and structure of the project.
 
 Last updated: 2025-08-14
 
 ## Alignment Maintenance
 - This document is the single source of truth for project vision and high-level specs.
 - Update it in the same pull request as any change that materially affects: technology stack, roles/permissions, public observability, device lifecycle, or system boundaries.
 - Required sections to keep accurate: All
 - Prefer clarity over completeness: link to detailed docs when necessary, but ensure intent and scope live here.

## Purpose

Edgeberry Fleet Hub is a **self-hostable device management service** designed specifically for Edgeberry devices. It provides a transparent, flexible, and open alternative without vendor lock-in.

## Core Principles

* **Self-hosted by design** – Each Fleet Hub is an independent server, giving full ownership and control to the user.
* **Radical transparency without vulnerability** – The system is observable by default, but always anonymizes sensitive data.
* **Composable and modular** – The architecture is intentionally simple, broken into meaningful parts rather than built as a monolith.
* **Decentralization** – Each server instance is sovereign but can optionally sync or interoperate with others.
* **Bounded flexibility** – The system supports many use cases, but always within the defined scope of managing Edgeberry devices.

## Technology Stack

Edgeberry Fleet Hub is based on open-source technologies to ensure transparency, interoperability, and ease of contribution:

* **TypeScript** – For backend and frontend logic, providing type safety and maintainability.
* **Mosquitto (MQTT broker)** – For lightweight, publish-subscribe communication with Edgeberry devices.
* **Node.js** – As the base runtime environment for the backend.
* **Express** – For serving the HTTP API.
* **React** – For building the user interface.
* **SQLite (MVP)** – Primary persistent storage for users, permissions, device registry, and digital twins. Postgres may be introduced post-MVP if needs arise.

These choices are made to maximize simplicity, performance, and long-term maintainability.

## Project Structure

The Fleet Hub is a set of smaller projects in a single monorepo to keep development tight and interfaces explicit:

External presentation: To the outside world, Edgeberry Fleet Hub is a monolithic product — a single hostname, a single API surface, and a single dashboard UI. Internal modularity is an implementation detail and must not leak into the public surface area. The `core-service` acts as the orchestrator and public entrypoint for the UI.

Public Surface Area (single HTTP(S) server):

- Base URL: single hostname (e.g., `https://fleethub.edgeberry.io`).
- Only `core-service` binds public HTTP(S).
- UI entrypoint: `/` serves the dashboard SPA from the `core-service` (static file server in production).
- HTTP API prefix: `/api` (versioning via headers or path TBD) — served directly by `core-service`.
 - Observability endpoints are provided by `core-service`, including logs snapshot and SSE stream (`/api/logs`, `/api/logs/stream`).
  - No dedicated WebSocket server at present; live logs use SSE via `core-service`.

Execution model & IPC:

- Each microservice runs independently as a `systemd` service (units per component).
- Internal service-to-service communication uses D-Bus (method calls + signals). No internal HTTP between microservices.
- Device communication remains via MQTT; D-Bus is only for server-internal coordination.
- Configuration: `systemd` unit templates, D-Bus service/policy files, and Mosquitto broker configs are stored at the repo root under `config/`. For the MVP, `config/` is flat (no subdirectories).
 - Release packaging (MVP): we publish per-microservice build artifacts (tar.gz) attached to GitHub Releases and install them on the host via a privileged installer. No Docker is used for release packaging.
 - Host installation (MVP): `scripts/install.sh` installs artifacts under `/opt/Edgeberry/fleethub/<service>/`, installs `systemd` unit files from `config/`, reloads, enables, and restarts services.

- `ui/` — Web UI (React). Consumes only public HTTP APIs and websocket endpoints. No direct DB access.
- `core-service/` — Orchestrator and public entrypoint. Serves the built UI in production and may provide light orchestration endpoints (e.g., `/healthz`).
- `api/` — Previously a standalone Node.js + Express HTTP API. Its responsibility has moved into `core-service`, which now serves all public HTTP(S) including `/api`. Any remaining code here will be migrated or retired.
- `provisioning-service/` — Long-running Node.js service subscribed to `$fleethub/#` topics for bootstrap flows (CSR handling, cert issuance, template provisioning). No device twin responsibility.
- `twin-service/` — Dedicated service for digital twin maintenance: processes twin updates/deltas, reconciliation, and desired→reported state sync.
- `mqtt-broker/` — TLS materials (dev-only), ACL templates, and helper scripts. Mosquitto broker config files live under `config/`. Production secrets are never committed.
- `shared/` — Isomorphic TypeScript packages used by multiple projects: DTOs/types, validation schemas, MQTT topic helpers, logging, config loader.
- `scripts/` — Developer tooling and CI checks (e.g., DB migrations, seeders).
  - Includes: `scripts/dev_start.sh` (hot-reload dev orchestrator with prefixed logs; starts `core-service` to serve UI locally when configured), `scripts/build-all.sh` (release builds), `scripts/install.sh` (host installer).
- `docs/` — Extended documentation referenced from this file.
- `config/` — `systemd` unit templates, D-Bus service/policy files, and Mosquitto broker configs (dev/prod variants). MVP: flat directory (no subfolders).
  - Example unit files (MVP): `fleethub-core.service`, `fleethub-provisioning.service`, `fleethub-twin.service`, `fleethub-registry.service`.

Responsibilities and boundaries:

- `ui/` calls `api/` only. It should never talk to MQTT directly.
- `api/` is the single writer to the database and the HTTP surface area for external clients. It must enforce the permission model.
- `provisioning-service/` owns MQTT bootstrap and certificate lifecycle. It may update DB via internal repositories shared with `api/` (from `shared/`). Exposes a D-Bus API for operations and emits signals for status.
- `twin-service/` maintains digital twins (desired/reported state, deltas, reconciliation). Subscribes/publishes to twin topics and updates the DB via shared repositories.
- `mqtt-broker/` config enforces mTLS, maps cert subject → device identity, and defines ACLs per topic family.
- All microservices expose stable D-Bus interfaces under a common namespace (e.g., `io.edgeberry.fleethub.*`).

Interfaces (high level):

- UI → API (served by `core-service`): REST endpoints like `/devices`, `/devices/:id/events`, `/config/public`, `/status`, plus operational endpoints `/api/services`, `/api/logs`, and service control under `/api/services/:unit/{start|stop|restart}`.
- API ↔ DB: SQLite via a thin data access layer in `shared/` (e.g., `shared/db` with query builders and schema migrations).
- API ↔ Workers over D-Bus: API invokes worker methods and subscribes to worker signals using well-defined D-Bus interfaces.
- API/Services (provisioning-service, twin-service) ↔ MQTT: Publish/subscribe using typed helpers from `shared/mqtt` and topic constants defined in this document.

Local development:

- Each subproject runs independently with its own `package.json` and start script. A top-level `dev` script can orchestrate broker, API, worker, and UI.
- No Docker for dev; Mosquitto runs locally with dev TLS materials under `mqtt-broker/dev-certs/` and config under `mqtt-broker/dev.conf`.
- Env via `.env` files per project; never commit secrets.
- D-Bus: prefer the user session bus during development (fallback to a private bus if needed); systemd user units can be used to emulate production `systemd` services locally.
 - Dev orchestrator: `scripts/dev_start.sh` starts Mosquitto and all services concurrently with hot-reload (prefers `npm run dev`/`tsx watch`). All process logs are multiplexed in a single terminal with per-service prefixes. Services run with `NODE_ENV=development`.

### D-Bus Interfaces (MVP)

Bus: system bus in production.
Common namespace: `io.edgeberry.fleethub.*`

#### Provisioning Service

- Object path: `/io/edgeberry/fleethub/ProvisioningService`
- Interface: `io.edgeberry.fleethub.ProvisioningService`
- Methods:
  - `RequestCertificate(s reqId, s csrPem, s deviceId) → (b accepted, s certPem, s caChainPem, s error)`
  - `GetStatus() → (s status)`
- Signals:
  - `CertificateIssued(s reqId, s deviceId)`
  - `CertificateRejected(s reqId, s deviceId, s error)`

#### Device Twin Service

- Object path: `/io/edgeberry/fleethub/TwinService`
- Interface: `io.edgeberry.fleethub.TwinService`
- Methods:
  - `GetDesired(s deviceId) → (u version, s docJson)`
  - `GetReported(s deviceId) → (u version, s docJson)`
  - `UpdateDesired(s deviceId, u baseVersion, s patchJson) → (u newVersion)`
  - `ForceDelta(s deviceId) → ()`
- Signals:
  - `DesiredUpdated(s deviceId, u version)`
  - `ReportedUpdated(s deviceId, u version)`

#### Device Registry Service

- Object path: `/io/edgeberry/fleethub/DeviceRegistryService`
- Interface: `io.edgeberry.fleethub.DeviceRegistryService`
- Methods:
  - `GetDevice(s deviceId) → (s deviceJson)`
  - `ListDevices(s filterJson) → (s devicesJson)`
  - `UpdateStatus(s deviceId, s status) → (b ok, s error)`
  - `GetCertificateMeta(s deviceId) → (s subject, s fingerprint, s expiresAt)`
  - `BindManufacturerUUIDHash(s deviceId, s uuidHash) → (b ok, s error)`
- Signals:
  - `DeviceUpdated(s deviceId)`
  - `DeviceAdded(s deviceId)`
  - `DeviceRemoved(s deviceId)`

CI and releases:

- Lint, typecheck, test per project. Alignment checks run at repo root and fail if sections here drift from code.
- Versioning per project package; releases tagged at the repo root with affected packages noted in changelog.
- Release packaging (MVP): on GitHub release publish, the workflow runs `scripts/build-all.sh` to produce per-service artifacts under `dist-artifacts/` named `fleethub-<service>-<version>.tar.gz`, and uploads them as release assets. Consumers install them on target hosts using `sudo bash scripts/install.sh <artifact_dir>`.

### MVP Scope (Current)

The current MVP focuses on a lean, self-hostable `microservice`-based IoT device management application that validates the system boundaries and data flows:

- Device registry stored in SQLite.
- MQTT ingestion from `devices/#`, with development-only message previews for troubleshooting.
- Event logging to `device_events` for operational visibility.
- Minimal HTTP API:
  - `/health`, `/version`, `/config/public`, `/status`
  - `/devices`, `/devices/:id`, `/devices/:id/events`
- Native development environment (no Docker) to maximize speed.

Notes on privacy/transparency for MVP: Logged event payloads may include raw device data; Observer-level anonymization is enforced at the UI/API response layer and will be expanded as roles are implemented.

## UI Functionality (MVP)

The Web UI is a single-page app served by `core-service` and uses React + TypeScript.

### Routes

- `/` — Overview (primary landing)
- `/overview` — alias to Overview
- `/health` — detailed health view
- `/devices/:assetId` — device detail placeholder
- `/settings` — placeholder
- Additional placeholders: `/login`, `/register`, `/logout`

### Core Components

- `Navigationbar` (`ui/src/components/Navigationbar.tsx`) — top navigation; Overview is the root menu item
- `HealthWidget` (`ui/src/components/HealthWidget.tsx`) — shows system health; tolerant to missing optional endpoints
- `ServiceStatusWidget` (`ui/src/components/ServiceStatusWidget.tsx`) — shows microservice statuses from unified endpoint
  - Service tiles open a modal with recent logs and Start/Restart/Stop controls. Actions are visible to everyone but disabled unless the user has the `admin` role.
  - Display names hide the `fleethub-` prefix and `.service` suffix. The legacy `api` tile is removed (merged into core).
- `Overview` page (`ui/src/Pages/Overview.tsx`) — contains `HealthWidget`, `ServiceStatusWidget`, and a simple devices table

### API Contracts (UI dependencies)

- Required:
  - `GET /api/health` — returns `{ healthy: boolean, ... }`
  - `GET /api/services` — returns array or object of systemd unit statuses (includes `fleethub-registry.service`)
  - Default monitored units include Fleet Hub services and key dependencies: `fleethub-core.service`, `fleethub-provisioning.service`, `fleethub-twin.service`, `fleethub-registry.service`, `dbus.service`, `mosquitto.service`.
  - `GET /api/logs` — recent logs snapshot. Accepts `units` (comma-separated) or `unit` (single) and `lines`.
- Optional (UI handles absence gracefully; fields display as "-"):
  - `GET /api/status`
  - `GET /api/version`
  - `GET /api/config/public`
- Devices (optional placeholder in MVP):
  - `GET /api/devices` — may return `[]` or `{ devices: [] }`; UI tolerates other shapes by falling back to an empty list
 - Service controls (best-effort; may require host privileges):
   - `POST /api/services/:unit/start`
   - `POST /api/services/:unit/stop`
   - `POST /api/services/:unit/restart`

### Error Handling & Resilience

- Overview and Health widgets never crash on missing/invalid responses; errors are contained and UI renders with placeholders.
- Network errors do not block rendering the rest of the dashboard.

### Build & Serve

- UI built with Vite to `ui/build/` (`ui/vite.config.ts`).
- `core-service` serves static assets from `ui/build` and exposes `/api/*` endpoints on the same origin.
- Dev: `npm run dev` at repo root runs core-service and serves the UI build; set `DEV_MOSQUITTO=1` to include the broker.
 - `core-service` also exposes logs SSE at `/api/logs/stream` for live tailing.

### Device Registry & Provisioning (MVP)

Registry fields on `devices`:

- `id` (string, primary key)
- `name`, `model`, `firmware_version`, `tags`
- `status` (active/suspended/retired)
- `enrolled_at`, `last_seen`
- `created_at`, `updated_at`
- Certificate metadata (see Security): `cert_subject`, `cert_fingerprint`, `cert_expires_at`

Provisioning flow (MQTT-only):

1. Device generates a keypair and CSR (CN = `deviceId`).
2. Device connects to the broker using the claim/provisioning certificate (mTLS).
3. Device publishes CSR to `$fleethub/certificates/create-from-csr` with `{ reqId, csrPem, deviceId }`.
4. Provisioning worker validates CSR and issues a signed device certificate; replies on `$fleethub/certificates/create-from-csr/accepted` with `{ reqId, certPem, caChainPem }` (or `/rejected`).
5. Device saves cert, reconnects using its own certificate.
6. Server marks the device `active`, sets `enrolled_at`, and subsequent MQTT runtime updates `last_seen`/`updated_at`.

Security/roles (MVP):

- Registrar role required for `POST /devices`, `PATCH /devices/:id`.
- Anonymous users may be Observers (when public observability is enabled) and receive anonymized event payload previews.

### Security (MVP)

Devices MUST authenticate using X.509 client certificates.

- MQTT broker (Mosquitto):
  - TLS enabled with CA, server cert/key.
  - `require_certificate true`
  - `use_subject_as_username true` (CN or full subject maps to device identity)
  - ACLs keyed by subject/username to restrict topics (e.g., `devices/<deviceId>/#`).
- Provisioning is MQTT-only: devices obtain certificates exclusively via MQTT bootstrap topics with mTLS; no HTTP(S) path is provided for devices.

Registry includes certificate metadata to anchor identity:

- `cert_subject`, `cert_fingerprint`, `cert_expires_at`

Enrollment binds the presented certificate to the device record. Certificate rotation will be handled post-MVP.

### Fleet Provisioning Model (Current)

We use a single, admin-managed provisioning client certificate for initial device bootstrap and a secret manufacturer UUID per device:

- **Provisioning client certificate (admin-only):** A single certificate authorizes bootstrap requests. It is embedded in the installer and validated by the Fleet Hub via fingerprint pinning or by an mTLS reverse proxy.
- **Secret manufacturer UUID:** Each device has a secret UUID known only to the device owner and server admin. The UUID is never stored in plaintext; the server stores a salted SHA-256 hash.

Data model additions (on `devices`):

- `manufacturer_uuid_hash` (unique)
- `manufacturer_uuid_added_at`, `manufacturer_uuid_last_seen`

Admin onboarding:

1. Admin whitelists a device UUID and binds it to a device row:
   - `POST /admin/uuid-whitelist` (role: admin)
   - Body: `{ uuid, id?, name?, model?, firmwareVersion?, tags? }`
   - The server hashes the UUID with a secret pepper and stores the hash; a device row is created if missing.

Bootstrap (device installer) — MQTT-only:

1. Device connects to the MQTT broker using the fleet provisioning client certificate (mTLS at the broker).
2. Device publishes a provisioning request to `$fleethub/certificates/create-from-csr` or `$fleethub/certificates/create` with fields including `reqId`, `uuid`, and its system-wide `deviceId`.
3. Server validates provisioning client (via broker) and checks that the secret UUID whitelist entry matches the provided `deviceId`. If valid, it issues a device certificate, persists metadata, and responds on the corresponding `/accepted` or `/rejected` topic.
4. Device installs the returned cert/key, reconnects with its per-device client certificate, and uses runtime topics.

Security posture:

- Two gates protect bootstrap: the provisioning client certificate and the secret UUID whitelist.
- UUIDs are stored only as salted hashes. Never log raw UUIDs.
- Production enforces mTLS at the broker. Devices never use HTTP(S) to communicate with the server.

### Provisioning Service (MVP, dev path) — Step-by-Step

This is a simplified, development-focused bootstrap flow that uses a shared "claim" certificate and static ACL patterns. It is intended for fast iteration; production posture remains as defined above.

Goal: Devices start with a generic claim certificate, request a per-device certificate via MQTT, then reconnect using their own cert.

1) Device starting point

- Ships with: claim certificate + private key (same for all devices) and the CA chain (to trust the broker).

2) First boot (device)

- Generate a new private key and CSR (CN = deviceId/serial).
- Connect to broker using the claim cert (mTLS).
- Publish CSR to `$fleethub/certificates/create-from-csr` with payload `{ reqId, csrPem, deviceId }`.

3) Provisioning service (worker)

- Subscribes to `$fleethub/certificates/create-from-csr`.
- Validates CSR (structure, expected CN shape).
- Signs CSR with the Intermediate CA and publishes reply to `$fleethub/certificates/create-from-csr/accepted` with `{ reqId, certPem, caChainPem }` (or `/rejected` with `{ reqId, error }`).
- Correlation is via `reqId` in payload; the claim client filters by `reqId`.

4) Device after provisioning

- Saves returned certificate and CA chain.
- Disconnects and reconnects using the new device certificate + private key.
- Continues normal operation under device-specific ACLs.

5) Broker configuration (Mosquitto)

- `require_certificate true`, `use_subject_as_username true`.
- ACL examples:
  - Claim CN = `claim`: allow publish to `$fleethub/certificates/create-from-csr` and subscribe to `$fleethub/certificates/create-from-csr/+` (accepted/rejected).
  - Device CN = `<deviceId>`: allow publish to `devices/<deviceId>/#`, subscribe to `devices/<deviceId>/commands/#`, and twin topics `$fleethub/devices/<deviceId>/twin/#`.

6) MVP rules (dev path)

- No rotation automation; long-lived device certs are acceptable for MVP.
- No DB writes required by the provisioning worker in this mode; it only issues certs.
- Single broker listener; no separate bootstrap vs runtime brokers.
- Static ACL patterns; no per-device broker reconfiguration.

### MQTT Topic Architecture

Prefix: `$fleethub`

Provisioning (bootstrap) — All payloads are JSON:

- Request (CSR): `$fleethub/certificates/create-from-csr`
  - Payload: `{ reqId, csrPem, uuid, deviceId, daysValid? }`
  - Responses:
    - `$fleethub/certificates/create-from-csr/accepted`
    - `$fleethub/certificates/create-from-csr/rejected`
- Request (server keygen): `$fleethub/certificates/create`
  - Payload: `{ reqId, uuid, deviceId, daysValid? }`
  - Responses:
    - `$fleethub/certificates/create/accepted`
    - `$fleethub/certificates/create/rejected`
- Provisioning template bind: `$fleethub/provisioning-templates/{templateName}/provision`
  - Payload: `{ reqId, uuid, deviceId, parameters? }`
  - Responses:
    - `$fleethub/provisioning-templates/{templateName}/provision/accepted`
    - `$fleethub/provisioning-templates/{templateName}/provision/rejected`

Digital Twin (subset):

- Update: `$fleethub/devices/{deviceId}/twin/update`
  - Responses: `/accepted`, `/rejected`
  - Delta notifications (server → device): `$fleethub/devices/{deviceId}/twin/update/delta`
- Get: `$fleethub/devices/{deviceId}/twin/get`
  - Responses: `/accepted`, `/rejected`

Runtime telemetry/events:

- Device publish: `devices/{deviceId}/...` (ingested and persisted to `device_events`)
- Server/ops publish (optional): `devices/{deviceId}/commands/#`

## Twin Service (MVP)

The `twin-service` owns the device digital twin lifecycle. It maintains desired/reported state, computes deltas, and emits updates to devices via MQTT.

Responsibilities:

- Subscribe to `$fleethub/devices/{deviceId}/twin/get` and `$fleethub/devices/{deviceId}/twin/update`.
- Publish `$fleethub/devices/{deviceId}/twin/update/accepted|rejected` and `.../delta`.
- Persist desired/reported state and versions; reconcile incoming reported state; generate deltas for devices.
- Expose D-Bus methods for the API to read/update twin state.

Storage (MVP):

- SQLite tables for `twin_desired`, `twin_reported`, with `device_id`, `version`, `doc` (JSON), `updated_at`.

Non-goals (MVP):

- Conflict resolution across multiple writers (kept simple: API is single writer for desired state).
- Cross-device orchestration and bulk updates (can be added later).

## Device Registry

The Device Registry is the authoritative inventory of all Edgeberry devices known to a Fleet Hub instance. It anchors identity, status, and metadata, and links provisioning, digital twin state, and historical events.

Purpose:

- Maintain unique, persistent records per device.
- Store identity anchors: device ID, X.509 certificate metadata, manufacturer UUID hash (if used).
- Provide operational context for UI/API (status, last seen, tags, firmware version).
- Link MQTT messages, twin state, and event logs.

Core data model (MVP):

- `id` (PK): globally unique device ID (typically the certificate CN).
- `name` (optional), `model`, `firmware_version`, `tags`.
- `status`: `active` | `suspended` | `retired`.
- `enrolled_at`, `last_seen`, `created_at`, `updated_at`.
- Certificate: `cert_subject`, `cert_fingerprint`, `cert_expires_at`.
- Manufacturer UUID (optional): `manufacturer_uuid_hash`, `manufacturer_uuid_added_at`, `manufacturer_uuid_last_seen`.

Behavior:

- On provisioning: create/update record by `id`, persist certificate metadata, set `status=active`, set `enrolled_at`.
- On connection: update `last_seen`; certificate change detection may trigger rotation handling (post-MVP).
- On suspension: set `status=suspended`; ACLs block publishes except administrative channels.
- On retirement: set `status=retired`; ACLs block all; record retained for lineage unless purged.

Interactions:

- API: `/devices`, `/devices/:id`, `/devices/:id/events` (RBAC governs sensitive fields).
- MQTT: topics and ACLs resolved via registry entries.
- Twin service: twin desired/reported state stored by `twin-service` and keyed by `deviceId`; registry provides identity and lineage references.

Design principles:

- Immutable identity: `id` is never reassigned; hardware replacements use a new `id` and are linked via lineage (post-MVP table).
- Minimal MVP fields; schema is extendable without breaking older instances.
- Role-based access: hide certificate/UUID fields from Observer-level users.

## Device Definition

An **Edgeberry device** is any physical unit running the **Edgeberry Device Software**. The system assumes that the device uses MQTT, supports enrollment, exposes a digital twin, and follows the Edgeberry lifecycle.

## Roles and Access

Access is modeled as **bundles of permissions** (keys) assigned to users per server. Users start with Observer permissions by default and gain further capabilities by being assigned named bundles (e.g., Technician, Registrar). Roles are additive and server-specific.

### Key Roles

* **Observer**: Default role. Can view the system, digital twins, logs, and operational state. All sensitive data (hardware IDs, user names, Wi-Fi SSIDs, etc.) is anonymized. Observers cannot interact with or modify anything.

* **Technician**: Has permission to enroll devices, perform replacements, and retire devices. Also includes observer-level access.

* **Registrar**: Can onboard (birth) new device IDs into the whitelist and dispose of (retire completely) devices. Also includes observer-level access.

* **Admin**: A user who holds **all permissions**. Not a separate role, but someone with the full keychain. Has the ability to manage users, roles, settings, and devices.

## Permission Model

* Every user has a keychain of permissions.
* Bundles like "Technician" or "Registrar" are simply named sets of keys.
* All permission checks are enforced across API and UI equally.
* Anonymous users can be granted Observer-level access if enabled by the admin.

## Public Observability

Fleet Hubs can optionally expose a public dashboard. When enabled, anonymous users accessing the server are automatically assigned the Observer role. This supports education, transparency, and system replication without compromising security.

## Identity and Lineage

Digital twins maintain a full **lineage** of their operational history, including:

* Which hardware IDs they’ve inhabited
* When each replacement occurred
* Which role performed it (anonymized to Observer-level viewers)

This ensures continuity, traceability, and understanding of a device’s lifecycle.

## Alignment and Future Scope

This project will remain open-source and GPL-licensed. It will always assume Edgeberry as the reference device type, and will not attempt to support generic or arbitrary devices. Future work may include inter-server sync or federation, but this is optional and will follow the same principles of user ownership and clarity.

---

This file is meant to be read and followed by both people and artificial intelligence systems involved in the development of Edgeberry Fleet Hub. Any new features or decisions should be measured against the values described here.
