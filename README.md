![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_hub.png)

<img src="documentation/devicehub.png" align="right" width="50%"/>

**A self-hostable device management service for Edgeberry devices.**

**Edgeberry Device Hub** is the single control plane for your Edgeberry fleet — a dashboard and API to onboard devices, manage their digital twins, and observe the system in real time.

**Keep your data private** • **Add devices instantly** • **Stay secure by default** • **Monitor your fleet** • **Control remotely** • **Troubleshoot easily** • **Integrate anywhere** • **Run offline** • **Scale as needed**

<br clear="right"/>

## Services
Microservice architecture seperates the responsibilities. Each service is a separate process that communicates with the others via D-Bus.

- **Core Service**
  - The main entry point that serves the web dashboard and handles all HTTP requests. Think of it as the "front desk" that coordinates everything behind the scenes.
  - Manages user authentication, system configuration, and provides the REST API that powers the web interface.
  - Owns the public D-Bus name `io.edgeberry.devicehub.Core` and exposes Core D-Bus interfaces (Whitelist, Certificate, Twin) to internal workers and tools.
  - Proxies device twin operations to `twin-service` over D-Bus so there is a single public API surface.
  - Owns device registry/inventory data and exposes the public HTTP endpoints for devices. No standalone registry microservice exists.

- **Provisioning Service**
  - Handles device onboarding and security certificates. When a new Edgeberry device wants to join your network, this service validates it and issues the proper credentials.
  - Creates and manages device identities, ensuring only authorized devices can connect to your hub.

- **Device Twin Service**
  - Maintains a "digital twin" for each device - a real-time mirror of its current state and desired configuration.
  - Tracks what you want each device to do (desired state) versus what it's actually doing (reported state), automatically syncing changes between your dashboard and devices.
  - **Monitors device online/offline status** by subscribing to Mosquitto broker connection events and stores device status history in SQLite database.
  - **Provides real-time device status updates** via D-Bus to Core service, which broadcasts status changes to UI clients over WebSocket.
  - Exposes an internal D-Bus interface `io.edgeberry.devicehub.Twin1` under bus `io.edgeberry.devicehub.Twin` for Core to call. Not directly exposed to external clients.

See `documentation/alignment.md` for architecture and interface details, including D-Bus contracts.

### HTTP API Notes

**Device Twin:**
- New endpoint in Core: `GET /api/devices/:id/twin` — returns desired/reported docs by calling Twin over D-Bus.

**Device Management:**
- `GET /api/devices` - List all registered devices with status
- `GET /api/devices/:uuid` - Get single device details
- `DELETE /api/devices/:uuid` - Remove device from registry (admin only)
- `PUT /api/devices/:uuid` - Update device properties like name (admin only)
- `POST /api/devices/:uuid/replace` - Replace device with another from registry (admin only)
- `GET /api/devices/:uuid/events` - Get device event history

**System Management:**
- `POST /api/system/sanity-check` - Run comprehensive system diagnostics (admin only)
- `POST /api/system/reboot` - Schedule system reboot (admin only)
- `POST /api/system/shutdown` - Schedule system shutdown (admin only)

**Whitelist Management:**
- `GET /api/admin/uuid-whitelist` - List whitelist entries
- `POST /api/admin/uuid-whitelist` - Add single UUID to whitelist (requires hardware_version and manufacturer)
- `POST /api/admin/uuid-whitelist/batch` - Batch upload UUIDs from array (requires uuids array, hardware_version and manufacturer)
- `DELETE /api/admin/uuid-whitelist/:uuid` - Remove UUID from whitelist
- `DELETE /api/admin/uuid-whitelist/by-device/:deviceId` - Remove whitelist entries by device ID

### UI Features

**System Widget:**
- Unified system monitoring and management interface with single-page layout
- **System Metrics**: Health status, CPU/memory/disk/network metrics with full-width sparklines
- **Services Section**: Systemd service status and control (start/stop/restart) with admin permissions
- **System Actions**: Sanity check (stethoscope icon) and power management (power icon)

**Device Management:**
- List and tile view toggle for device display
- Real-time search and filtering by device name, UUID, or group
- Inline device name editing with keyboard shortcuts (Enter to save, Escape to cancel)
- Device replacement functionality preserving original device names
- Delete device with optional whitelist cleanup

**Whitelist Management:**
- **Single Entry Tab**: Add individual UUIDs with hardware version and manufacturer
- **Batch Upload Tab**: Upload plain text files with one UUID per line
- Automatic file processing with detailed results (added/skipped counts and error details)
- Support for manufacturer-provided UUID files (.txt, .csv formats)

**System Diagnostics:**
- Comprehensive sanity check covering services, metrics, database, and MQTT configuration
- Real-time health monitoring with warning and critical thresholds
- Admin-only power management with confirmation dialogs

## Internal MQTT (twin-service)

| Topic | Direction | Description |
| --- | --- | --- |
| `$devicehub/certificates/create-from-csr` | Inbound | Create a new certificate from a CSR |
| `$devicehub/certificates/create-from-csr/accepted` | Outbound | Certificate created successfully |
| `$devicehub/certificates/create-from-csr/rejected` | Outbound | Certificate creation failed |
| `$devicehub/devices/{uuid}/provision/request` | Inbound | Request a new device to be provisioned (uuid = whitelist/claim UUID) |
| `$devicehub/devices/{uuid}/provision/accepted` | Outbound | Device has been provisioned |
| `$devicehub/devices/{uuid}/provision/rejected` | Outbound | Device provisioning rejected |
| `$devicehub/devices/{deviceId}/twin/get` | Inbound | Request device twin state (handled by twin-service) |
| `$devicehub/devices/{deviceId}/twin/update` | Inbound | Update device twin state (handled by twin-service) |
| `$devicehub/devices/{deviceId}/twin/update/accepted` | Outbound | Twin update accepted |
| `$devicehub/devices/{deviceId}/twin/update/rejected` | Outbound | Twin update rejected |
| `$devicehub/devices/{deviceId}/twin/update/delta` | Outbound | Twin state delta notification |
| `$devicehub/devices/{deviceId}/status` | Inbound | Device status updates (online/offline with timestamp) |
| `$devicehub/devices/{deviceId}/heartbeat` | Inbound | Device heartbeat messages |
| `$SYS/broker/log/N` | Inbound | Mosquitto broker connection logs (monitored by twin-service) |

Note: Core no longer ingests MQTT directly. All device twin access for external clients goes through Core HTTP/D-Bus.

## Mosquitto broker configuration (MVP)

- Canonical broker config lives at `config/mosquitto.conf` (dual listeners: 8883 mTLS, 1883 loopback anonymous).
- ACLs live at `config/mosquitto.acl`.
- The installer (`scripts/install.sh`) deploys these to system paths and restarts Mosquitto:
  - Config snippet: `/etc/mosquitto/conf.d/edgeberry.conf`
  - Certs: `/etc/mosquitto/certs/{server.crt,server.key}`
  - ACL: `/etc/mosquitto/acl.d/edgeberry.acl`
  - CA trust directory (broker capath): `/etc/mosquitto/certs/edgeberry-ca.d`

For development, you can start Mosquitto with the repo config directly:

```
mosquitto -c $(pwd)/config/mosquitto.conf -v
```

Note this config references `/etc/mosquitto/...` paths. Either run the installer once on your dev host or place the files accordingly.

## Deployment

Deploy to a remote host via SSH:

```bash
# Deploy to test server (preserves certificates and database)
npm run deploy

# Or manually specify host/user
./scripts/deploy.sh -h 192.168.1.116 -u spuq

# Force clean install (removes all persistent data)
./scripts/deploy.sh -h 192.168.1.116 -u spuq --force-clean
```

The deployment process:
1. Builds all services locally
2. Copies artifacts to remote host
3. Installs and configures services (preserving persistent data by default)
4. Starts the Device Hub

**Persistent Data:**
- Certificates (CA root, provisioning, server) stored in `/var/lib/edgeberry/devicehub/certs/`
- Database stored in `/var/lib/edgeberry/devicehub/devicehub.db`
- Preserved between deployments unless `--force-clean` is used

## License & Collaboration
**Copyright 2025 Sanne 'SpuQ' Santens**. The Edgeberry Device Hub project is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.