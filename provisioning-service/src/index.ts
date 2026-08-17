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

// dbus-native has a known bug where D-Bus introspection throws an uncaught
// exception with message "No root XML node" instead of a catchable
// rejection. This service calls into core-service over D-Bus on every
// provisioning request (CheckUUID, IssueFromCSR, RegisterDevice, MarkUsed),
// so without this guard a single introspection hiccup during device
// provisioning kills the whole process. Mirrors the same guard in
// twin-service/src/dbus.ts. Any other uncaught exception remains fatal.
process.on('uncaughtException', (error) => {
  if (error?.message?.includes('No root XML node')) {
    console.error(`[${SERVICE}] D-Bus XML introspection error (non-fatal):`, error.message);
    return;
  }
  throw error;
});

async function main() {
  console.log(`[${SERVICE}] starting...`);
  const client = startMqtt();
  registerShutdown(client);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
