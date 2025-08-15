# Alignment Document – Edgeberry Device Hub

This file defines the foundational philosophy, design intent, and system architecture for the Edgeberry Device Hub. It exists to ensure that all contributors—human or artificial—are aligned with the core values and structure of the project.
 
 Last updated: 2025-08-15 (morning)
 
 ## Alignment Maintenance
  - This document is the single source of truth for project vision and high-level specs.
  - Update it in the same pull request as any change that materially affects: technology stack, roles/permissions, public observability, device lifecycle, or system boundaries.
  - Required sections to keep accurate: All
  - Prefer clarity over completeness: link to detailed docs when necessary, but ensure intent and scope live here.

## Purpose

Edgeberry Device Hub is a **self-hostable device management service** designed specifically for Edgeberry devices. It provides a transparent, flexible, and open alternative without vendor lock-in.

## Core Principles

* **Self-hosted by design** – Each Device Hub is an independent server, giving full ownership and control to the user.
* **Radical transparency without vulnerability** – The system is observable by default, but always anonymizes sensitive data.
* **Composable and modular** – The architecture is intentionally simple, broken into meaningful parts rather than built as a monolith.
* **Decentralization** – Each server instance is sovereign but can optionally sync or interoperate with others.
* **Bounded flexibility** – The system supports many use cases, but always within the defined scope of managing Edgeberry devices.

## Maintainability & DX (Junior‑Friendly)

Simple rules so you can contribute confidently:

- **Tools you need**: TypeScript, Node.js/Express, React, SQLite, Mosquitto (MQTT), D‑Bus. No extra frameworks.

- **Run locally**:
  - `bash scripts/dev_start.sh` (hot reload, broker + services). 
  - Copy `.env.example` → `.env` per project if needed.

- **Add something new**:
  - API endpoint: add a handler, register route, add a short comment with request/response, add a tiny test.
  - MQTT topic: use `shared/mqtt` helpers, document request/response topic names here, add a fixture test.
  - UI widget: create a small component with loading/error states and a typed fetch hook.

- **Coding rules**:
  - TypeScript strict, ESLint + Prettier pass before commit.
  - Use types from `shared/` for DTOs/schemas; don’t duplicate shapes.
  - Never log secrets. Make errors actionable (what failed and what to try).

- **Before opening a PR**:
  - Run lint/typecheck/build locally.
  - If you changed an API/topic/contract, update this file and the nearest README or code comment.
  - Keep PRs small and focused.

## Readability & Documentation Standards

We prioritize human readability to reduce onboarding time and prevent operational mistakes. Contributors must follow these conventions:

- **Comment the why, not just the what**: Explain decisions, invariants, trade-offs, and security implications where non-obvious. Avoid restating code.
- **Document environment and contracts**: At each service entrypoint, document env vars, expected directory layout, network ports, and external dependencies (MQTT, D-Bus, HTTP).
- **APIs and topics**: Co-locate short endpoint/topic summaries near handlers (methods, routes, message handlers). Link to this file for the canonical contract.
- **Security notes**: Call out auth, authn/z boundaries, and sensitive data handling (cookies, tokens, certificates) at the point of use.
- **Operational clarity**: For background workers, document subscriptions, QoS, retry/backoff, and shutdown behavior.
- **UI code**: Briefly annotate data sources, loading/error fallbacks, and admin gating logic in components consuming APIs.
- **Keep comments truthful**: Update comments when behavior changes; treat stale comments as bugs.

Style:

- Prefer concise line comments near logic over large headers, except at file/service entrypoints where a short header is encouraged.
- Use TypeScript types and clear naming; comments supplement, not replace, types.
- Avoid leaking secrets in examples or logs. Include TODOs with owner/context when applicable.

PR checklist additions:

- If behavior or contracts changed, ensure inline comments are updated and this alignment file is amended when scope/principles are affected.
- New endpoints/topics: add a brief comment where implemented and ensure the corresponding section in this document stays accurate.

## Technology Stack

Edgeberry Device Hub is based on open-source technologies to ensure transparency, interoperability, and ease of contribution:

* **TypeScript** – For backend and frontend logic, providing type safety and maintainability.
* **Mosquitto (MQTT broker)** – For lightweight, publish-subscribe communication with Edgeberry devices.
* **Node.js** – As the base runtime environment for the backend.
* **Express** – For serving the HTTP API.
* **React** – For building the user interface.
* **SQLite (MVP)** – Primary persistent storage for users, permissions, device registry, and digital twins. Postgres may be introduced post-MVP if needs arise.

These choices are made to maximize simplicity, performance, and long-term maintainability.

## Project Structure

The Device Hub is a set of smaller projects in a single monorepo to keep development tight and interfaces explicit:

### Code Organization (Generalized)

- **Self-contained services**: Each microservice is organized by concern and starts from a thin entrypoint that only bootstraps dependencies and wiring.
- **Separation of concerns**: Configuration, data access, messaging, and shutdown live in focused modules. Business logic is isolated from startup code.
- **Cohesive modules, not micro-files**: Related logic is grouped into a few larger files per service (e.g., a single messaging module), prioritizing readability over fragmentation.
- **Consistent patterns**: Naming, logging style, and import conventions are uniform across services to reduce cognitive load.
- **Gateway service**: One service exposes the public HTTP API and serves the UI; internal workers communicate via their own channels.
- **Environment-driven**: Behavior is configured via environment variables (ports, paths, secrets, endpoints) and remains explicit.
- **Graceful teardown**: Each service provides a clear shutdown path to close external resources safely.

External presentation: To the outside world, Edgeberry Device Hub is a monolithic product — a single hostname, a single API surface, and a single dashboard UI. Internal modularity is an implementation detail and must not leak into the public surface area. The `core-service` acts as the orchestrator and public entrypoint for the UI.

Public Surface Area (single HTTP(S) server):

- Base URL: single hostname (e.g., `https://devicehub.edgeberry.io`).
- Only `core-service` binds public HTTP(S).
- UI entrypoint: `/` serves the dashboard SPA from the `core-service` (static file server in production).
- HTTP API prefix: `/api` (versioning via headers or path TBD) — served directly by `core-service`.
  - Observability endpoints are provided by `core-service`, including logs snapshot (`/api/logs`). Live streams are delivered over WebSocket at `/api/ws`.
  - WebSocket server at `/api/ws` (same origin). Authenticates via the `fh_session` JWT cookie on upgrade. Supports topic-based subscribe/unsubscribe and server push updates.

Execution model & IPC:

- Each microservice runs independently as a `systemd` service (units per component).
- Internal service-to-service communication uses D-Bus (method calls + signals). No internal HTTP between microservices.
- Device communication remains via MQTT; D-Bus is only for server-internal coordination.
- Configuration: `systemd` unit templates, D-Bus service/policy files, and Mosquitto broker configs are stored at the repo root under `config/`. For the MVP, `config/` is flat (no subdirectories).
 - Release packaging (MVP): we publish per-microservice build artifacts (tar.gz) attached to GitHub Releases and install them on the host via a privileged installer. No Docker is used for release packaging.
 - Host installation (MVP): `scripts/install.sh` installs artifacts under `/opt/Edgeberry/devicehub/<service>/`, installs `systemd` unit files from `config/`, reloads, enables, and restarts services.

- `ui/` — Web UI (React). Consumes only public HTTP APIs and websocket endpoints. No direct DB access.
- `core-service/` — Orchestrator and public entrypoint. Serves the built UI in production and may provide light orchestration endpoints (e.g., `/healthz`).
- `api/` — Previously a standalone Node.js + Express HTTP API. Its responsibility has moved into `core-service`, which now serves all public HTTP(S) including `/api`. Any remaining code here will be migrated or retired.
 - `provisioning-service/` — Long-running Node.js service subscribed to `$devicehub/#` topics for bootstrap flows (CSR handling, cert issuance, template provisioning). No device twin responsibility. MVP adds a simplified provisioning request/ack flow on `$devicehub/devices/{deviceId}/provision/request` for development.
- `twin-service/` — Dedicated service for digital twin maintenance: processes twin updates/deltas, reconciliation, and desired→reported state sync.
- `mqtt-broker/` — TLS materials (dev-only), ACL templates, and helper scripts. Mosquitto broker config files live under `config/`. Production secrets are never committed.
 - `shared/` — Isomorphic TypeScript packages used by multiple projects: DTOs/types, validation schemas, MQTT topic helpers, logging, config loader.
 - `scripts/` — Developer tooling and CI checks (e.g., DB migrations, seeders).
  - Includes: `scripts/dev_start.sh` (hot-reload dev orchestrator with prefixed logs; starts `core-service` to serve UI locally when configured), `scripts/build-all.sh` (release builds), `scripts/install.sh` (host installer).
- `docs/` — Extended documentation referenced from this file.
- `examples/` — Example integrations and reference nodes.
  - `examples/nodered/` — TypeScript-based Node-RED node "edgeberry-device". Minimal example that sets status to ready, logs "hello world" on input, and passes the message through. Required settings when adding the node: `host` (Device Hub base URL), `uuid` (device UUID), and a credential `token` (host access token). Build with `npm install && npm run build` in this folder; outputs to `examples/nodered/dist/`. Install into Node-RED via `npm link` or `npm pack` from this folder. CI will build and upload this asset for easy install/testing.
- `config/` — `systemd` unit templates, D-Bus service/policy files, and Mosquitto broker configs (dev/prod variants). MVP: flat directory (no subfolders).
  - Example unit files (MVP): `devicehub-core.service`, `devicehub-provisioning.service`, `devicehub-twin.service`, `devicehub-registry.service`.

Responsibilities and boundaries:

- `ui/` calls `api/` only. It should never talk to MQTT directly.
- `api/` is the single writer to the database and the HTTP surface area for external clients. It must enforce the permission model.
- `provisioning-service/` owns MQTT bootstrap and certificate lifecycle. It may update DB via internal repositories shared with `api/` (from `shared/`). Exposes a D-Bus API for operations and emits signals for status.
- `twin-service/` maintains digital twins (desired/reported state, deltas, reconciliation). Subscribes/publishes to twin topics and updates the DB via shared repositories.
- `mqtt-broker/` config enforces mTLS, maps cert subject → device identity, and defines ACLs per topic family.
- All microservices expose stable D-Bus interfaces under a common namespace (e.g., `io.edgeberry.devicehub.*`).

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

### Branding

- **Sources**: Official assets live under the repo root `brand/`.
- **Navbar**: `ui/src/components/Navigationbar.tsx` imports `ui/src/EdgeBerry_Logo_text.svg` and renders it inside `Navbar.Brand` (32px height).
- **Login**: `ui/src/Pages/Login.tsx` renders the Edgeberry text logo centered above the form.
- **404**: `ui/src/Pages/NotFound.tsx` shows the logo with a centered "Page not found" message.
- **Favicon**: `ui/public/favicon.svg` referenced from `ui/index.html` via `/favicon.svg`.
- **TypeScript**: `ui/src/assets.d.ts` declares `*.svg` modules for asset imports.
- **Alternative mark**: You may switch to `brand/Edgeberry_icon.svg` (square icon) for tight spaces; swap the import path where needed.

Accessibility:
- All images include `alt` text ("Edgeberry"). Maintain sufficient color contrast when changing backgrounds.

Change policy:
- Changes to logo usage or asset filenames should be reflected here and in `brand/`.

### D-Bus Interfaces (MVP)

Bus: system bus in production.
Common namespace: `io.edgeberry.devicehub.*`

#### Provisioning Service

- Object path: `/io/edgeberry/devicehub/ProvisioningService`
- Interface: `io.edgeberry.devicehub.ProvisioningService`
- Methods:
  - `RequestCertificate(s reqId, s csrPem, s deviceId) → (b accepted, s certPem, s caChainPem, s error)`
  - `GetStatus() → (s status)`
- Signals:
  - `CertificateIssued(s reqId, s deviceId)`
  - `CertificateRejected(s reqId, s deviceId, s error)`

#### Device Twin Service

- Object path: `/io/edgeberry/devicehub/TwinService`
- Interface: `io.edgeberry.devicehub.TwinService`
- Methods:
  - `GetDesired(s deviceId) → (u version, s docJson)`
  - `GetReported(s deviceId) → (u version, s docJson)`
  - `UpdateDesired(s deviceId, u baseVersion, s patchJson) → (u newVersion)`
  - `ForceDelta(s deviceId) → ()`
- Signals:
  - `DesiredUpdated(s deviceId, u version)`
  - `ReportedUpdated(s deviceId, u version)`

#### Device Registry Service

- Object path: `/io/edgeberry/devicehub/DeviceRegistryService`
- Interface: `io.edgeberry.devicehub.DeviceRegistryService`
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
- Release packaging (MVP): on GitHub release publish, the workflow runs `scripts/build-all.sh` to produce per-service artifacts under `dist-artifacts/` named `devicehub-<service>-<version>.tar.gz`, and uploads them as release assets. Consumers install them on target hosts using `sudo bash scripts/install.sh <artifact_dir>`.
 - Additionally, the Node-RED example under `examples/nodered/` is built and uploaded as a packaged tarball asset for easy install/testing.

### WebSocket Topics (Current)

Message envelope: JSON objects `{ type: string, data: any }`.

Auth: WebSocket upgrade validates the `fh_session` JWT cookie (SameSite=Lax; Secure over HTTPS). On reconnect, the client auto-resubscribes.

Subscribe protocol: client sends `{ type: "subscribe", topics: string[] }` (or `{ type: "unsubscribe", topics: string[] }`).

Topics implemented:

- `metrics.history`
  - On subscribe: server sends `{ type: "metrics.history", data: { hours, samples } }` (default 24h window).
  - Incremental updates may arrive as `{ type: "metrics.history.append", data: { sample } }` (UI normalizes to `metrics.history`).

- `services.status`
  - Snapshot of systemd managed units: `{ services: [{ unit, status }] }`.
  - Broadcast every 5s only when payload changes; also sent immediately on subscribe.

- `devices.list`
  - Device registry list with computed presence: `{ devices: [{ id, name, last_seen, online, ... }] }`.
  - Broadcast every 10s only when payload changes; also sent immediately on subscribe.

- `logs.stream:<unit>`
  - Control topic. Subscribing starts a `journalctl -f` stream for `<unit>` (validated). Unsubscribing stops it. Initial HTTP logs snapshot remains available at `GET /api/logs`.
  - Lines are pushed as `{ type: "logs.line", data: { unit, entry } }` where `entry` is a journal JSON object. When the stream closes, server sends `{ type: "logs.stream.end", data: { unit, code } }`.

### UI Functionality (MVP)

The Web UI is a single-page app served by `core-service` and uses React + TypeScript.

### Routes

- `/` — Overview (primary landing)
- `/overview` — alias to Overview
- `/health` — detailed health view
- `/devices/:assetId` — device detail placeholder
 - `/settings` — admin-only settings page: shows server snapshot, Root CA status/generator/download, and provisioning certificates list with issuance/inspect/delete/download
- Auth routes: `/login`, `/logout` (registration disabled for MVP; UI hides any register links)

### Core Components

- `Navigationbar` (`ui/src/components/Navigationbar.tsx`) — top navigation; Overview is the root menu item
- `HealthWidget` (`ui/src/components/HealthWidget.tsx`) — shows system health; tolerant to missing optional endpoints
- `ServiceStatusWidget` (`ui/src/components/ServiceStatusWidget.tsx`) — shows microservice statuses from unified endpoint
  - Service tiles open a modal with recent logs and Start/Restart/Stop controls. Actions are visible to everyone but disabled unless the user has the `admin` role.
  - Display names hide the `devicehub-` prefix and `.service` suffix. The legacy `api` tile is removed (merged into core).
- `Overview` page (`ui/src/Pages/Overview.tsx`) — contains `HealthWidget`, `ServiceStatusWidget`, and a simple devices table

### API Contracts (UI dependencies)

- Required:
  - `GET /api/health` — returns `{ healthy: boolean, ... }`
  - `GET /api/services` — returns array or object of systemd unit statuses (includes `devicehub-registry.service`)
  - Default monitored units include Device Hub services and key dependencies: `devicehub-core.service`, `devicehub-provisioning.service`, `devicehub-twin.service`, `devicehub-registry.service`, `dbus.service`, `mosquitto.service`.
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
- Caching controls: ETag disabled and strict no-cache headers applied for `/api/*` to avoid stale auth state (304) issues in the SPA.
- Dev: `npm run dev` at repo root runs core-service and serves the UI build; set `DEV_MOSQUITTO=1` to include the broker.
 - `core-service` exposes a WebSocket endpoint at `/api/ws` for live updates (metrics, services, devices, logs).

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
3. Device publishes CSR to `$devicehub/certificates/create-from-csr` with `{ reqId, csrPem, deviceId }`.
4. Provisioning worker validates CSR and issues a signed device certificate; replies on `$devicehub/certificates/create-from-csr/accepted` with `{ reqId, certPem, caChainPem }` (or `/rejected`).
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

- Enrollment binds the presented certificate to the device record. Certificate rotation will be handled post-MVP.

### Admin Authentication (MVP)

For the dashboard and HTTP APIs, the MVP uses a single-user admin login with JWT-based stateless auth implemented in `core-service`:

- Login required for all UI pages and `/api/*` endpoints, except health (`/healthz`, `/api/health`) and auth endpoints.
- No registration endpoint exists in the MVP; UI hides any register links.
- Endpoints:
  - `POST /api/auth/login` with `{ username, password }` → issues a signed JWT and sets it in an HttpOnly cookie `fh_session`.
  - `POST /api/auth/logout` → clears the cookie.
  - `GET /api/auth/me` → verifies JWT and returns `{ authenticated: boolean, user?: string }`.
- Token:
  - Stored in cookie `fh_session` (HttpOnly, SameSite=Lax; set `Secure` when served over HTTPS).
  - Signed with `JWT_SECRET` using HS256.
  - Expiration `JWT_TTL_SECONDS` (default 86400 = 24h).
- Configuration:
  - `ADMIN_USER` (default `admin`)
  - `ADMIN_PASSWORD` (MUST be set in production)
  - `JWT_SECRET` (MUST be strong in production; default dev value only for local use)
  - `JWT_TTL_SECONDS` (optional)
- UI behavior:
  - The SPA reads auth state from `GET /api/auth/me` and conditionally renders admin UI.
  - Navbar shows “Signed in as <admin>”; Logout is available in the menu.
  - Server no longer injects a separate auth bar into `index.html`; duplication was removed. Registration affordances may still be hidden best-effort via a small injected script.

### Settings & Certificate Management

Root CA and provisioning certificates are managed under `/api/settings/certs/*` and surfaced in the SPA Settings page (`/settings`).

- Root CA
  - `GET /api/settings/certs/root` → returns `{ pem, meta }` if present; `404` if absent
  - `POST /api/settings/certs/root` with `{ cn?, days?, keyBits? }` → generate Root CA if absent
  - `GET /api/settings/certs/root/download` → downloads `ca.crt` (PEM)

- Provisioning certificates
  - `GET /api/settings/certs/provisioning` → `{ certs: [{ name, cert, key, meta }] }`
  - `POST /api/settings/certs/provisioning` with `{ name, days? }` → issues a new cert/key signed by Root CA
  - `GET /api/settings/certs/provisioning/:name` → `{ name, pem, meta }`
  - `DELETE /api/settings/certs/provisioning/:name` → deletes `:name.crt` and `:name.key`
  - `GET /api/settings/certs/provisioning/:name/download` → downloads a `.tgz` bundle containing:
    - `ca.crt` (Root CA), `:name.crt`, `:name.key`, and `config.json` with `{ mqttUrl, caCert, cert, key }`

UI behavior on `/settings`:
- Root CA card shows presence, subject, validity, with actions: Generate (if absent), Download CA (if present).
- Provisioning section lists certs with subject/validity, with actions: Issue, Inspect (PEM + meta), Delete, Download bundle.

Whitelist & lifecycle (MVP additions):
- Settings page includes a Provisioning Whitelist section:
  - Lists entries from `provisioning.db` table `uuid_whitelist` with fields `{ uuid, device_id, name, note, created_at, used_at }`.
  - Allows creating a new entry via `POST /api/admin/uuid-whitelist` (optionally supplying a `uuid`, otherwise auto-generated).
  - Allows deleting entries via `DELETE /api/admin/uuid-whitelist/:uuid` and copying UUIDs.
- Settings page includes a Device Lifecycle Status section:
  - Shows Total/Online/Offline counts and a small table (ID, Name, Status, Last seen) using `GET /api/devices`.

### Fleet Provisioning Model (Current)

We use a single, admin-managed provisioning client certificate for initial device bootstrap and a secret manufacturer UUID per device:

- **Provisioning client certificate (admin-only):** A single certificate authorizes bootstrap requests. It is embedded in the installer and validated by the Device Hub via fingerprint pinning or by an mTLS reverse proxy.
- **Secret manufacturer UUID:** Each device has a secret UUID known only to the device owner and server admin. The UUID is never stored in plaintext; the server stores a salted SHA-256 hash.

Data model additions (on `devices`):

- `manufacturer_uuid_hash` (unique)
- `manufacturer_uuid_added_at`, `manufacturer_uuid_last_seen`

Admin onboarding:

1. Admin whitelists a device UUID and binds it to a device row:
   - `POST /api/admin/uuid-whitelist` (role: admin)
   - Body (MVP): `{ device_id, name?, note?, uuid? }` → returns `{ uuid, device_id, name, note, created_at, used_at }`.
   - Production plan: store only salted hashes of UUIDs. MVP stores plaintext UUIDs in `provisioning.db` for simplicity.

Bootstrap (device installer) — MQTT-only:

Production model:
1. Device connects to the broker using the fleet provisioning client certificate (mTLS at the broker).
2. Device publishes a provisioning request to `$devicehub/certificates/create-from-csr` (CSR-based) including `reqId`, `uuid`, `deviceId`.
3. Server validates the provisioning client and UUID whitelist (hash-based), issues a signed device certificate, and replies on `/accepted` or `/rejected`.
4. Device installs the returned cert/key and reconnects using its per-device client certificate.

MVP/dev model (implemented):
1. Device connects to the broker and publishes to `$devicehub/devices/{deviceId}/provision/request` with JSON `{ name?, token?, meta?, uuid? }`.
2. Provisioning service validates the whitelist when `ENFORCE_WHITELIST=true`:
   - Looks up `uuid` in `uuid_whitelist` and requires `device_id` match and `used_at` null.
   - On success, marks `used_at` and upserts the device row in `provisioning.db`.
3. Service replies on `$devicehub/devices/{deviceId}/provision/accepted|rejected`.

Security posture:

- Two gates protect bootstrap (production): provisioning client certificate and secret UUID whitelist (stored as salted hashes).
- MVP stores plaintext UUIDs in a local SQLite table for speed of iteration; never log raw UUIDs where avoidable.
- `ENFORCE_WHITELIST` (provisioning-service env) controls whether whitelist is required during provisioning.
- Production enforces mTLS at the broker. Devices never use HTTP(S) to communicate with the server.

### Provisioning Service (MVP, dev path) — Step-by-Step

This is a simplified, development-focused bootstrap flow that uses a shared "claim" certificate and static ACL patterns. It is intended for fast iteration; production posture remains as defined above.

Goal: Devices start with a generic claim certificate, request a per-device certificate via MQTT, then reconnect using their own cert.

1) Device starting point

- Ships with: claim certificate + private key (same for all devices) and the CA chain (to trust the broker).

2) First boot (device)

- Generate a new private key and CSR (CN = deviceId/serial).
- Connect to broker using the claim cert (mTLS).
- Publish CSR to `$devicehub/certificates/create-from-csr` with payload `{ reqId, csrPem, deviceId }`.

3) Provisioning service (worker)

- Subscribes to `$devicehub/certificates/create-from-csr`.
- Validates CSR (structure, expected CN shape).
- Signs CSR with the Intermediate CA and publishes reply to `$devicehub/certificates/create-from-csr/accepted` with `{ reqId, certPem, caChainPem }` (or `/rejected` with `{ reqId, error }`).
- Correlation is via `reqId` in payload; the claim client filters by `reqId`.

4) Device after provisioning

- Saves returned certificate and CA chain.
- Disconnects and reconnects using the new device certificate + private key.
- Continues normal operation under device-specific ACLs.

5) Broker configuration (Mosquitto)

- `require_certificate true`, `use_subject_as_username true`.
- ACL examples:
  - Claim CN = `claim`: allow publish to `$devicehub/certificates/create-from-csr` and subscribe to `$devicehub/certificates/create-from-csr/+` (accepted/rejected).
  - Device CN = `<deviceId>`: allow publish to `devices/<deviceId>/#`, subscribe to `devices/<deviceId>/commands/#`, and twin topics `$devicehub/devices/<deviceId>/twin/#`.

6) MVP rules (dev path)

- No rotation automation; long-lived device certs are acceptable for MVP.
- No DB writes required by the provisioning worker in this mode; it only issues certs.
- Single broker listener; no separate bootstrap vs runtime brokers.
- Static ACL patterns; no per-device broker reconfiguration.

### MQTT Topic Architecture

Prefix: `$devicehub`

Provisioning (bootstrap) — All payloads are JSON:

- Request (CSR): `$devicehub/certificates/create-from-csr`
  - Payload: `{ reqId, csrPem, uuid, deviceId, daysValid? }`
  - Responses:
    - `$devicehub/certificates/create-from-csr/accepted`
    - `$devicehub/certificates/create-from-csr/rejected`
- Request (server keygen): `$devicehub/certificates/create`
  - Payload: `{ reqId, uuid, deviceId, daysValid? }`
  - Responses:
    - `$devicehub/certificates/create/accepted`
     - `$devicehub/certificates/create/rejected`
- Provisioning template bind: `$devicehub/provisioning-templates/{templateName}/provision`
  - Payload: `{ reqId, uuid, deviceId, parameters? }`
  - Responses:
    - `$devicehub/provisioning-templates/{templateName}/provision/accepted`
     - `$devicehub/provisioning-templates/{templateName}/provision/rejected`

Provisioning (MVP simplified for development):

- Request: `$devicehub/devices/{deviceId}/provision/request`
  - Payload: `{ name?: string, token?: string, meta?: object }`
  - Responses:
    - `$devicehub/devices/{deviceId}/provision/accepted`
    - `$devicehub/devices/{deviceId}/provision/rejected`

Digital Twin (subset):

- Update: `$devicehub/devices/{deviceId}/twin/update`
  - Responses: `/accepted`, `/rejected`
- Get: `$devicehub/devices/{deviceId}/twin/get`
  - Responses: `/accepted`, `/rejected`

Runtime telemetry/events:

- Device publish: `devices/{deviceId}/...` (ingested and persisted to `device_events`)
- Server/ops publish (optional): `devices/{deviceId}/commands/#`

## Twin Service (MVP)

The `twin-service` owns the device digital twin lifecycle. It maintains desired/reported state, computes deltas, and emits updates to devices via MQTT.

Responsibilities:

- Subscribe to `$devicehub/devices/{deviceId}/twin/get` and `$devicehub/devices/{deviceId}/twin/update`.
- Publish `$devicehub/devices/{deviceId}/twin/update/accepted|rejected` and `.../delta`.
- Persist desired/reported state and versions; reconcile incoming reported state; generate deltas for devices.
- Expose D-Bus methods for the API to read/update twin state.

Storage (MVP):

- SQLite tables for `twin_desired`, `twin_reported`, with `device_id`, `version`, `doc` (JSON), `updated_at`.

Non-goals (MVP):

- Conflict resolution across multiple writers (kept simple: API is single writer for desired state).
- Cross-device orchestration and bulk updates (can be added later).

## Provisioning Service (MVP)

The `provisioning-service` provides a development-friendly provisioning path in addition to the full certificate bootstrap model. It listens for per-device requests and persists basic metadata.

Responsibilities:

- Subscribe to `$devicehub/devices/{deviceId}/provision/request`.
- Upsert device into SQLite `devices` table with fields: `id`, `name?`, `token?`, `meta?`, timestamps.
- Publish `$devicehub/devices/{deviceId}/provision/accepted|rejected`.

Storage (MVP):

- SQLite table `devices` with JSON `meta` column.

Non-goals (MVP):

- Certificate issuance/validation (covered by bootstrap model above).
- Complex templates or workflows.

## Registry Service (MVP)

The `registry-service` ingests runtime device events for operational visibility.

Responsibilities:

- Subscribe to `devices/#` to capture all device-published topics.
- Persist events into SQLite `device_events` with fields: `device_id`, `topic`, `payload` (BLOB), `ts`.

Storage (MVP):

- SQLite table `device_events`.

Non-goals (MVP):

- Semantic parsing of payloads or aggregations (can be added later).

## Device Registry

The Device Registry is the authoritative inventory of all Edgeberry devices known to a Device Hub instance. It anchors identity, status, and metadata, and links provisioning, digital twin state, and historical events.

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

Device Hubs can optionally expose a public dashboard. When enabled, anonymous users accessing the server are automatically assigned the Observer role. This supports education, transparency, and system replication without compromising security.

## Identity and Lineage

Digital twins maintain a full **lineage** of their operational history, including:

* Which hardware IDs they’ve inhabited
* When each replacement occurred
* Which role performed it (anonymized to Observer-level viewers)

This ensures continuity, traceability, and understanding of a device’s lifecycle.

## Alignment and Future Scope

This project will remain open-source and GPL-licensed. It will always assume Edgeberry as the reference device type, and will not attempt to support generic or arbitrary devices. Future work may include inter-server sync or federation, but this is optional and will follow the same principles of user ownership and clarity.

---

This file is meant to be read and followed by both people and artificial intelligence systems involved in the development of Edgeberry Device Hub. Any new features or decisions should be measured against the values described here.
