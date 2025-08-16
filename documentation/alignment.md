# Alignment Document – Edgeberry Device Hub

This file defines the foundational philosophy, design intent, and system architecture for the Edgeberry Device Hub. It exists to ensure that all contributors—human or artificial—are aligned with the core values and structure of the project.

**Last updated:** 2025-08-16 (evening)

## Alignment Maintenance

- This document is the single source of truth for project vision and high-level specs
- Update it in the same pull request as any change that materially affects:
  - Technology stack
  - Roles/permissions
  - Public observability
  - Device lifecycle
  - System boundaries
- **Required sections to keep accurate:** All
- **Prefer clarity over completeness:** Link to detailed docs when necessary, but ensure intent and scope live here

## Purpose

Edgeberry Device Hub is a **self-hostable device management service** designed specifically for Edgeberry devices. It provides a transparent, flexible, and open alternative without vendor lock-in.

## Core Principles

* **Self-hosted by design** – Each Device Hub is an independent server, giving full ownership and control to the user.
* **Radical transparency without vulnerability** – The system is observable by default, but always anonymizes sensitive data.
* **Composable and modular** – The architecture is intentionally simple, broken into meaningful parts rather than built as a monolith.
* **Decentralization** – Each server instance is sovereign but can optionally sync or interoperate with others.
* **Bounded flexibility** – The system supports many use cases, but always within the defined scope of managing Edgeberry devices.

## Maintainability & Developer Experience (Junior-Friendly)

Simple rules so you can contribute confidently:

### Required Tools
- **Core stack:** TypeScript, Node.js/Express, React, SQLite, Mosquitto (MQTT), D-Bus
- **No extra frameworks** - Keep it simple

### Running Locally
- **Quick start:** `npm run dev` or `bash scripts/dev_start.sh` (hot reload, broker + services)
- **Environment:** Copy `.env.example` → `.env` per project if needed

#### MQTT mTLS quickstart (MVP)

Minimal steps to run broker + services with mTLS locally:

1) Broker certs (dev)
- Generate dev CA and server certs using `config/certs/README.md`.
- Files used by dev broker: `config/certs/ca.crt`, `server.crt`, `server.key`.

2) Start Mosquitto (mTLS dev config)
- `mosquitto -c $(pwd)/config/mosquitto-dev.conf`
- Dev/prod configs enforce mTLS and set `use_subject_as_username true` (CN → username for ACLs).

3) Service client certs
- Create client certs with CNs matching service usernames: `provisioning`, `registry`, `twin`.
- CN mapping is required for ACLs (see `config/mosquitto.acl`).

4) Environment for services (example)
```
export MQTT_URL=mqtts://localhost:8883
export MQTT_TLS_CA=./config/certs/ca.crt
export MQTT_TLS_CERT=./config/certs/provisioning.crt
export MQTT_TLS_KEY=./config/certs/provisioning.key
export MQTT_TLS_REJECT_UNAUTHORIZED=true
```
- Run per service (adjust CERT/KEY per service):
  - `npm --prefix provisioning-service run dev`
  - `npm --prefix registry-service run dev`
  - `npm --prefix twin-service run dev`

5) Virtual device example
- Device client cert CN must equal the deviceId (e.g., `my-device-01`).
```
export DEVICE_ID=my-device-01
export MQTT_URL=mqtts://localhost:8883
export MQTT_TLS_CA=./config/certs/ca.crt
export MQTT_TLS_CERT=./config/certs/my-device-01.crt
export MQTT_TLS_KEY=./config/certs/my-device-01.key
```
- Run: `npm --prefix examples/virtual-device run dev`

#### MQTT connection env vars (standardized)

- `MQTT_URL` (default `mqtts://localhost:8883`)
- `MQTT_USERNAME` (optional; with mTLS, CN is used as username)
- `MQTT_PASSWORD` (optional)
- `MQTT_TLS_CA` path to CA cert file
- `MQTT_TLS_CERT` path to client cert file
- `MQTT_TLS_KEY` path to client key file
- `MQTT_TLS_REJECT_UNAUTHORIZED` boolean, default `true`

#### Diagnostics: MQTT Sanity Test (mTLS)

Purpose: Device-side connectivity and ACL verification against Mosquitto using mTLS.

Components:
- **Script**: `scripts/device_mqtt_test.sh`
  - Executed by the backend, validates connect, basic provisioning/twin topics, and telemetry publish/subscribe flows.
  - Uses the standardized MQTT envs above.
- **Backend API**: implemented in `core-service/src/index.ts`
  - `POST /api/diagnostics/mqtt-test`
    - Body (all optional): `{ deviceId, mqttUrl, ca, cert, key, rejectUnauthorized, timeoutSec }`
    - Returns: `{ ok, exitCode, startedAt, durationMs, stdout, stderr }`
  - `GET /diagnostics`
    - Minimal HTML page to run the same test manually from a browser.
- **UI**: `ui/src/components/ServiceStatusWidget.tsx`
  - Admin-only "Sanity Check" button next to "Refresh".
  - Opens a modal, runs the test, and displays pass/fail with full STDOUT/STDERR.
  - The button is visible to all, but disabled when the user is not admin.

Script path resolution (server-side):
- `core-service` resolves the test script from the first existing path:
  1) `DIAG_SCRIPT_PATH` (env override)
  2) `../scripts/device_mqtt_test.sh`
  3) `../../scripts/device_mqtt_test.sh`
  4) `/opt/Edgeberry/devicehub/scripts/device_mqtt_test.sh`
- If the script is missing, the API responds `500` with the attempted paths.

Installer & artifact notes (remote installs):
- Combined artifact (via `scripts/build-all.sh`) now includes the full `config/` and `scripts/` directories.
- Installer (`scripts/install.sh`) whitelists `scripts/` in `ALLOWED_NAMES` and installs it to `/opt/Edgeberry/devicehub/scripts/`.
- Installer sets `chmod +x /opt/Edgeberry/devicehub/scripts/*.sh` so diagnostics execute.
- Mosquitto config and materials are placed for AppArmor compatibility:
  - Broker snippet: `/etc/mosquitto/conf.d/edgeberry.conf` with mTLS listener `8883`, `require_certificate true`, `use_subject_as_username true`.
  - Server certs: `/etc/mosquitto/certs/{server.crt,server.key}`.
  - ACL: `/etc/mosquitto/acl.d/edgeberry.acl`.
  - TLS trust model: broker uses OpenSSL `capath` for dynamic CA trust at `/etc/mosquitto/certs/edgeberry-ca.d`.
    - Any CA PEM dropped into this directory is trusted after an automatic rehash and broker reload.
    - Systemd watcher: `edgeberry-ca-rehash.path` → triggers `edgeberry-ca-rehash.service` to run `c_rehash`/`openssl rehash` and `systemctl reload mosquitto` when contents change.
    - Helper scripts:
      - `scripts/update-broker-ca.sh` — installs an additional CA PEM into `edgeberry-ca.d`, rehashes, and reloads the broker.
      - `scripts/rotate-root-ca.sh` — replaces all prior trust with a new Root CA (and optionally rotates broker server cert/key), restarts services.
- Data persistence (provisioning DB):
  - Persistent data directory: `/var/lib/edgeberry/devicehub/` (created with 0750 perms).
  - Default provisioning DB path: `/var/lib/edgeberry/devicehub/provisioning.db` (configurable via `PROVISIONING_DB`).
  - The installer NEVER seeds whitelist entries. It will not create the DB file; the service initializes schema on first run if absent.
  - Re-install/update behavior: existing `provisioning.db` is preserved. If a legacy DB is found under the install tree, the installer migrates it to the persistent path once.

Operational tips:
- For remote production nodes, run the sanity check from the UI Services widget. If it fails:
  - Verify script presence/permissions on the host: `/opt/Edgeberry/devicehub/scripts/device_mqtt_test.sh` is executable.
  - Optionally set `DIAG_SCRIPT_PATH` in the `devicehub-core.service` environment to point directly at the script.
  - Confirm Mosquitto is running and reading `/etc/mosquitto/conf.d/edgeberry.conf` with the expected TLS files and ACL.

### Adding New Features
- **API endpoint:**
  - Add a handler and register route
  - Add short comment with request/response format
  - Add a minimal test
- **MQTT topic:**
  - Use `shared/mqtt` helpers
  - Document request/response topic names in this file
  - Add a fixture test
- **UI widget:**
  - Create small component with loading/error states
  - Use typed fetch hook

### Coding Standards
- **TypeScript:** Strict mode, ESLint + Prettier must pass before commit
- **Types:** Use types from `shared/` for DTOs/schemas; avoid duplication
- **Security:** Never log secrets
- **Errors:** Make errors actionable (what failed and what to try)

### Before Opening a PR
- Run lint/typecheck/build locally
- If you changed an API/topic/contract, update this file and nearest README/code comment
- Keep PRs small and focused

## Readability & Documentation Standards

We prioritize human readability to reduce onboarding time and prevent operational mistakes.

### Documentation Requirements

- **Comment the why, not just the what**
  - Explain decisions, invariants, trade-offs, and security implications where non-obvious
  - Avoid restating code

- **Document environment and contracts**
  - At each service entrypoint, document:
    - Environment variables
    - Expected directory layout
    - Network ports
    - External dependencies (MQTT, D-Bus, HTTP)

- **APIs and topics**
  - Co-locate short endpoint/topic summaries near handlers
  - Link to this file for canonical contracts

- **Security notes**
  - Call out auth/authz boundaries
  - Document sensitive data handling (cookies, tokens, certificates) at point of use

- **Operational clarity**
  - For background workers, document:
    - Subscriptions and QoS
    - Retry/backoff behavior
    - Shutdown behavior

- **UI code**
  - Annotate data sources
  - Document loading/error fallbacks
  - Note admin gating logic in API-consuming components

- **Keep comments truthful**
  - Update comments when behavior changes
  - Treat stale comments as bugs

### Style Guidelines

- **Prefer concise line comments** near logic over large headers
  - Exception: Short headers encouraged at file/service entrypoints
- **Use TypeScript types and clear naming**
  - Comments supplement, don't replace, types
- **Security conscious**
  - Avoid leaking secrets in examples or logs
  - Include TODOs with owner/context when applicable

### PR Checklist Additions

- **Contract changes:** Ensure inline comments are updated and this alignment file is amended when scope/principles are affected
- **New endpoints/topics:** Add brief comment where implemented and ensure corresponding section in this document stays accurate

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

The Device Hub is a set of smaller projects in a single monorepo to keep development tight and interfaces explicit.

### Code Organization Principles

#### Service Design
- **Self-contained services:** Each microservice is organized by concern and starts from a thin entrypoint that only bootstraps dependencies and wiring
- **Separation of concerns:** Configuration, data access, messaging, and shutdown live in focused modules. Business logic is isolated from startup code
- **Cohesive modules, not micro-files:** Related logic is grouped into a few larger files per service (e.g., a single messaging module), prioritizing readability over fragmentation
- **Consistent patterns:** Naming, logging style, and import conventions are uniform across services to reduce cognitive load

#### Architecture Patterns
- **Gateway service:** One service exposes the public HTTP API and serves the UI; internal workers communicate via their own channels
- **Environment-driven:** Behavior is configured via environment variables (ports, paths, secrets, endpoints) and remains explicit
- **Graceful teardown:** Each service provides a clear shutdown path to close external resources safely

#### External Presentation
To the outside world, Edgeberry Device Hub is a monolithic product:
- Single hostname
- Single API surface
- Single dashboard UI

Internal modularity is an implementation detail and must not leak into the public surface area. The `core-service` acts as the orchestrator and public entrypoint for the UI.

### Public Surface Area (Single HTTP(S) Server)

#### Base Configuration
- **Base URL:** Single hostname (e.g., `https://devicehub.edgeberry.io`)
- **HTTP binding:** Only `core-service` binds public HTTP(S)
- **UI entrypoint:** `/` serves the dashboard SPA from the `core-service` (static file server in production). The UI is a one-page app; all client routes resolve to `/`.

#### API Structure
- **HTTP API prefix:** `/api` (versioning via headers or path TBD) — served directly by `core-service`
- **Observability endpoints:** Provided by `core-service`, including logs snapshot (`/api/logs`)
- **Live streams:** Delivered over WebSocket at `/api/ws`

#### WebSocket Configuration
- **Endpoint:** `/api/ws` (same origin)
- **Authentication:** Via the `fh_session` JWT cookie on upgrade
- **Features:** Topic-based subscribe/unsubscribe and server push updates

#### UI Routing (One-Page App)
- The UI is a single Overview page; all routes redirect/resolve to `/`.
- Anonymous mode is enabled: non-sensitive data is visible without login; admin-only actions are disabled.
- Login is presented as a modal triggered from the navbar (no dedicated `/login` page).
- Logout returns to `/` (anonymous view) instead of redirecting to a login page.
- The former menu/off-canvas is removed. Navbar shows auth status and a Login/Logout control only.
- Layout: full-viewport (100vh/100vw) with a sticky footer. Only the inner content container scrolls.
- Footer: transparent background with a subtle top border and license notice.

### Execution Model & IPC

#### Service Runtime
- **Process model:** Each microservice runs independently as a `systemd` service (units per component)
- **Internal communication:** D-Bus (method calls + signals). No internal HTTP between microservices
- **Device communication:** Remains via MQTT; D-Bus is only for server-internal coordination

#### Configuration Management
- **Storage location:** `systemd` unit templates, D-Bus service/policy files, and Mosquitto broker configs stored at repo root under `config/`
- **MVP structure:** `config/` is flat (no subdirectories)

#### Release & Installation (MVP)
- **Release packaging:** Per-microservice build artifacts (tar.gz) attached to GitHub Releases, installed via privileged installer
- **No Docker:** Docker is not used for release packaging
- **Host installation:** `scripts/install.sh` installs artifacts under `/opt/Edgeberry/devicehub/<service>/`, installs `systemd` unit files from `config/`, reloads, enables, and restarts services

### Directory Structure

#### Core Services
- **`ui/`** — Web UI (React)
  - Consumes only public HTTP APIs and websocket endpoints
  - No direct DB access

- **`core-service/`** — Orchestrator and public entrypoint
  - Serves the built UI in production
  - May provide light orchestration endpoints (e.g., `/healthz`)

- **`api/`** — Previously a standalone Node.js + Express HTTP API
  - Its responsibility has moved into `core-service`, which now serves all public HTTP(S) including `/api`
  - Any remaining code here will be migrated or retired

- **`provisioning-service/`** — Long-running Node.js service
  - Subscribed to `$devicehub/#` topics for bootstrap flows
  - Handles CSR processing, cert issuance, template provisioning
  - No device twin responsibility
  - MVP adds simplified provisioning request/ack flow on `$devicehub/devices/{deviceId}/provision/request` for development

- **`twin-service/`** — Dedicated service for digital twin maintenance
  - Processes twin updates/deltas
  - Handles reconciliation and desired→reported state sync

#### Infrastructure & Support
- **`mqtt-broker/`** — MQTT broker configuration and materials
  - TLS materials (dev-only)
  - ACL templates and helper scripts
  - Mosquitto broker config files live under `config/`
  - Production secrets are never committed

- **`shared/`** — Isomorphic TypeScript packages used by multiple projects
  - DTOs/types
  - Validation schemas
  - MQTT topic helpers
  - Logging and config loader

- **`scripts/`** — Developer tooling and CI checks
  - DB migrations, seeders
  - **Key scripts:**
    - `scripts/dev_start.sh` — Hot-reload dev orchestrator with prefixed logs; starts `core-service` to serve UI locally when configured
    - `scripts/build-all.sh` — Release builds
    - `scripts/install.sh` — Host installer
    - `scripts/deploy.sh` — SSH deployment to remote hosts

#### Documentation & Examples
- **`docs/`** — Extended documentation referenced from this file

- **`examples/`** — Example integrations and reference nodes
  - **`examples/nodered/`** — TypeScript-based Node-RED node "edgeberry-device"
    - Minimal example that sets status to ready, logs "hello world" on input, and passes the message through
    - **Required settings:** `host` (Device Hub base URL), `uuid` (device UUID), and credential `token` (host access token)
    - **Build:** `npm install && npm run build` in this folder; outputs to `examples/nodered/dist/`
    - **Install:** Into Node-RED via `npm link` or `npm pack` from this folder
    - CI will build and upload this asset for easy install/testing

#### Configuration
- **`config/`** — System configuration files
  - `systemd` unit templates
  - D-Bus service/policy files
  - Mosquitto broker configs (dev/prod variants)
  - **MVP structure:** Flat directory (no subfolders)
  - **Example unit files:** `devicehub-core.service`, `devicehub-provisioning.service`, `devicehub-twin.service`, `devicehub-registry.service`

Responsibilities and boundaries:

- `ui/` calls `api/` only. It should never talk to MQTT directly.
- `api/` is the single writer to the database and the HTTP surface area for external clients. It must enforce the permission model.
- `provisioning-service/` owns MQTT bootstrap and certificate lifecycle. It may update DB via internal repositories shared with `api/` (from `shared/`). Exposes a D-Bus API for operations and emits signals for status.
- `twin-service/` maintains digital twins (desired/reported state, deltas, reconciliation). Subscribes/publishes to twin topics and updates the DB via shared repositories.
- `mqtt-broker/` config enforces mTLS, maps cert subject → device identity, and defines ACLs per topic family.
    - Provisioning topics are open to any authenticated client (mTLS) at the broker layer; authorization is enforced by `provisioning-service` via whitelist UUID validation. This supports shared provisioning certificates.
- All microservices expose stable D-Bus interfaces under a common namespace (e.g., `io.edgeberry.devicehub.*`).

Interfaces (high level):

- UI → API (served by `core-service`): REST endpoints like `/devices`, `/devices/:id/events`, `/config/public`, `/status`, plus operational endpoints `/api/services`, `/api/logs`, and service control under `/api/services/:unit/{start|stop|restart}`.
- API ↔ DB: SQLite via a thin data access layer in `shared/` (e.g., `shared/db` with query builders and schema migrations).
- API ↔ Workers over D-Bus: API invokes worker methods and subscribes to worker signals using well-defined D-Bus interfaces.
- API/Services (provisioning-service, twin-service) ↔ MQTT: Publish/subscribe using typed helpers from `shared/mqtt` and topic constants defined in this document.

Local development:

- Each subproject runs independently with its own `package.json` and start script. A top-level `dev` script can orchestrate broker, API, worker, and UI.
 - No Docker for dev; Mosquitto runs locally. MVP uses `config/mosquitto-dev.conf` and dev TLS materials under `config/certs/`.
   - Future: consolidate under `mqtt-broker/dev.conf` and `mqtt-broker/dev-certs/` for clearer separation.
- Env via `.env` files per project; never commit secrets.
- D-Bus: prefer the user session bus during development (fallback to a private bus if needed); systemd user units can be used to emulate production `systemd` services locally.
 - Dev orchestrator: `scripts/dev_start.sh` starts Mosquitto and all services concurrently with hot-reload (prefers `npm run dev`/`tsx watch`). All process logs are multiplexed in a single terminal with per-service prefixes. Services run with `NODE_ENV=development`.
 - Deployment: `scripts/deploy.sh` provides SSH-based deployment to remote hosts. Supports key-based or password authentication, builds artifacts locally (unless `--skip-build`), copies to remote staging, and runs the installer with sudo.

### Branding

- **Sources**: Official assets live under the repo root `brand/`.
- **Navbar**: `ui/src/components/Navigationbar.tsx` imports `ui/src/EdgeBerry_Logo_text.svg` and renders it inside `Navbar.Brand` (32px height).
- **Login**: Implemented as a modal (`ui/src/components/LoginModal.tsx`) opened from the navbar; no dedicated route/page.
- **404**: The app redirects unknown routes to `/` (single-page). The `NotFound` component is not linked in routing.
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
- Release packaging (MVP): on GitHub release publish, the workflow runs `scripts/build-all.sh` to produce per-service artifacts under `dist-artifacts/` named `devicehub-<service>-<version>.tar.gz`, and uploads them as release assets. Consumers install them on target hosts using `sudo bash scripts/install.sh <artifact_dir>` or deploy remotely using `scripts/deploy.sh`.
 - Additionally, the Node-RED example under `examples/nodered/` is built and uploaded as a packaged tarball asset for easy install/testing.

### Deployment Process (SSH)

The `scripts/deploy.sh` script provides automated deployment to remote hosts via SSH:

**Usage**: `bash scripts/deploy.sh -h <host> [-u <user>] [-i <identity_file>] [options]`

**Options**:
- `-h, --host` — Remote host or IP (required)
- `-u, --user` — SSH username (prompts if not provided; defaults to current user)
- `-i, --identity` — SSH private key file (optional; uses password auth if omitted)
- `--remote-dir` — Custom remote staging directory (default: `~/.edgeberry-deploy-<timestamp>`)
- `--skip-build` — Skip local artifact building (use existing `dist-artifacts/`)
- `-v, --verbose` — Verbose SSH/rsync output

**Process**:
1. Prompts for SSH credentials (user if not provided, password always)
2. Tests sudo access on remote host
3. Builds artifacts locally via `scripts/build-all.sh` (unless `--skip-build`)
4. Creates remote staging directory
5. Copies artifacts, config, and installer using rsync (with scp fallback)
6. Runs `scripts/install.sh` remotely with sudo privileges
7. Cleans up staging directory

**Dependencies**: `ssh`, `scp`, `sshpass` (for password auth). Optional: `rsync` for faster transfers.

**NPM Integration**: Use `npm run deploy` for quick deployment with predefined host/user, or `npm run build` + `scripts/deploy.sh --skip-build` for faster iterations.

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
- Admin controls are integrated into the Overview via admin-only modals (Certificates, Whitelist)
- Auth routes: `/login`, `/logout` (registration disabled for MVP; UI hides any register links)

### Core Components

- `Navigationbar` (`ui/src/components/Navigationbar.tsx`) — top navigation; Overview is the root menu item
- `HealthWidget` (`ui/src/components/HealthWidget.tsx`) — shows system health; tolerant to missing optional endpoints
- `ServiceStatusWidget` (`ui/src/components/ServiceStatusWidget.tsx`) — shows microservice statuses from unified endpoint
  - Service tiles open a modal with recent logs and Start/Restart/Stop controls. Actions are visible to everyone but disabled unless the user has the `admin` role.
  - Display names hide the `devicehub-` prefix and `.service` suffix. The legacy `api` tile is removed (merged into core).
- `Overview` page (`ui/src/Pages/Overview.tsx`) — contains `HealthWidget`, `ServiceStatusWidget`, and a simple devices table
- `CertificateSettingsModal` (`ui/src/components/CertificateSettingsModal.tsx`) — admin-only modal to manage Root CA and provisioning certificates, opened from Overview
- `WhitelistModal` (`ui/src/components/WhitelistModal.tsx`) — admin-only modal to manage provisioning UUID whitelist, opened from Overview

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

Root CA and provisioning certificates are managed under `/api/settings/certs/*` and surfaced in the Overview via admin-only modals.

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

UI behavior in Certificates modal:
- Root CA card shows presence, subject, validity, with actions: Generate (if absent), Download CA (if present).
- Provisioning section lists certs with subject/validity, with actions: Issue, Inspect (PEM + meta), Delete, Download bundle.

Whitelist & lifecycle (MVP additions):
- Overview includes a Provisioning Whitelist modal:
  - Lists entries from `provisioning.db` table `uuid_whitelist` with fields `{ uuid, device_id, name, note, created_at, used_at }`.
  - Allows creating a new entry via `POST /api/admin/uuid-whitelist` (optionally supplying a `uuid`, otherwise auto-generated).
  - Allows deleting entries via `DELETE /api/admin/uuid-whitelist/:uuid` and copying UUIDs.
 - Install & persistence rules:
    - Fresh installs MUST NOT populate the whitelist. The `uuid_whitelist` table is created empty on first run.
    - On re-install/update, the whitelist MUST persist. The provisioning DB lives under `/var/lib/edgeberry/devicehub/provisioning.db` by default and is not overwritten by the installer.
- Overview includes a Device Lifecycle section:
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
 - Default production path for whitelist DB: `/var/lib/edgeberry/devicehub/provisioning.db` (override with `PROVISIONING_DB`).
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
