/**
 * Twin Service (MVP)
 * ---------------------------------------------
 * Purpose
 * - Manage device digital twins (desired/reported) and reconcile deltas.
 *
 * Responsibilities
 * - Handle MQTT topics for twin get/update, delegating all desired/reported
 *   storage to core-service over D-Bus (see src/dbus.ts) - this service
 *   never opens a database itself; core-service is twin.db's sole owner.
 * - Publish accepted responses and deltas (desired − reported) as needed.
 *
 * Topic Contracts (per device)
 * - Get current twin: `$devicehub/devices/{deviceId}/twin/get`
 *   -> Respond: `$devicehub/devices/{deviceId}/twin/update/accepted`
 * - Update desired/reported: `$devicehub/devices/{deviceId}/twin/update`
 *   -> Respond: `.../accepted` and optionally `.../delta`
 *
 * Environment & Dependencies
 * - MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD: broker connection (expect mTLS + ACLs in prod).
 *
 * Operational Notes
 * - Uses QoS 1 for message handling to reduce loss.
 * - Maintains simple versioning to avoid lost updates; reconciliation is shallow in MVP.
 * - Shutdown closes the MQTT connection via `registerShutdown()`.
 *
 * Security Notes
 * - Avoid logging full payloads; device data may contain sensitive material.
 * - Ensure broker ACLs restrict devices to their own twin topics.
 */
import { SERVICE } from './config.js';
import { startMqtt } from './mqtt.js';
import { startTwinDbusClient } from './dbus.js';
import { registerShutdown } from './shutdown.js';

async function main() {
  console.log(`[${SERVICE}] starting...`);
  const client = startMqtt();
  await startTwinDbusClient();
  registerShutdown(client);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
