/**
 * Provisioning Service (MVP)
 * ---------------------------------------------
 * Purpose
 * - Handle device bootstrap/provisioning over MQTT for Edgeberry devices.
 *
 * Responsibilities
 * - Subscribe to provisioning requests and validate optional UUID whitelist.
 * - Upsert device metadata into SQLite (`provisioning.db`).
 * - Publish accepted/rejected acknowledgements.
 *
 * Messaging Contracts (per device)
 * - Request:  `$devicehub/devices/{deviceId}/provision/request` (QoS 1)
 * - Accepted: `$devicehub/devices/{deviceId}/provision/accepted` (QoS 1)
 * - Rejected: `$devicehub/devices/{deviceId}/provision/rejected` (QoS 1)
 * Payload (request): `{ uuid?: string, name?: string, token?: string, meta?: object }`
 *
 * Environment & Dependencies
 * - MQTT_URL: broker URL (e.g., mqtts://host:8883). Client reconnects every 2s on failure.
 * - MQTT_USERNAME / MQTT_PASSWORD: optional; broker is expected to enforce mTLS in production.
 * - PROVISIONING_DB: path to SQLite database file (default `provisioning.db`).
 * - ENFORCE_WHITELIST: `true|false`. When true, request must include `uuid` present in `uuid_whitelist`
 *   with matching `device_id` and unused `used_at`.
 *
 * Operational Notes
 * - QoS: uses QoS 1 for subscribe/publish to reduce loss while keeping throughput reasonable.
 * - Backoff: MQTT client reconnectPeriod=2000ms; idempotent upsert avoids duplicates.
 * - Shutdown: closes MQTT client and SQLite connection via `registerShutdown()`.
 *
 * Security Notes
 * - Do not log secrets (tokens). Broker should require client certs (mTLS) and ACLs per device.
 * - When `ENFORCE_WHITELIST=true`, the `uuid` acts as a one-time claim token and is marked used.
 */
import { SERVICE } from './config.js';
import { startMqtt } from './mqtt.js';
import { registerShutdown } from './shutdown.js';

type Json = Record<string, unknown>;

async function main() {
  console.log(`[${SERVICE}] starting...`);
  const client = startMqtt();
  registerShutdown(client);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
