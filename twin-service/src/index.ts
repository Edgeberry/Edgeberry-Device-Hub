/**
 * Twin Service (MVP)
 * ---------------------------------------------
 * Purpose
 * - Manage device digital twins (desired/reported) and reconcile deltas.
 *
 * Responsibilities
 * - Store desired/reported twin docs in SQLite (`twin.db`) with versions.
 * - Handle MQTT topics for twin get/update.
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
 * - TWIN_DB: path to SQLite database file (default `twin.db`).
 *
 * Operational Notes
 * - Uses QoS 1 for message handling to reduce loss.
 * - Maintains simple versioning to avoid lost updates; reconciliation is shallow in MVP.
 * - Shutdown closes MQTT and DB via `registerShutdown()`.
 *
 * Security Notes
 * - Avoid logging full payloads; device data may contain sensitive material.
 * - Ensure broker ACLs restrict devices to their own twin topics.
 */
import { SERVICE, DB_PATH } from './config.js';
import { initDb } from './db.js';
import { startMqtt } from './mqtt.js';
import { startTwinDbusServer } from './dbus.js';
import { registerShutdown } from './shutdown.js';

type Json = Record<string, unknown>;

// Moved: DB init now in src/db.ts

// Moved: getTwin now in src/db.ts

// Moved: shallowDelta lives in handler

// Moved: setDoc now in src/db.ts

// Moved: topic parsing now in src/topics.ts

async function main() {
  console.log(`[${SERVICE}] starting...`);
  const db = initDb(DB_PATH);
  const client = startMqtt(db);
  await startTwinDbusServer(db);
  registerShutdown(db, client);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
