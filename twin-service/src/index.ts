/**
 * Twin Service (MVP)
 * ---------------------------------------------
 * Responsibilities:
 * - Maintain desired and reported device state ("twin") in SQLite
 * - Handle MQTT topics for twin get/update
 * - Publish accepted responses and deltas (desired - reported)
 *
 * Topic contract (per device):
 * - Request current twin: `$fleethub/devices/{deviceId}/twin/get`
 *   -> Respond: `$fleethub/devices/{deviceId}/twin/update/accepted`
 * - Update desired/reported: `$fleethub/devices/{deviceId}/twin/update`
 *   -> Respond: `.../accepted` and optionally `.../delta`
 */
import { SERVICE, DB_PATH } from './config.js';
import { initDb } from './db.js';
import { startMqtt } from './mqtt.js';
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
  registerShutdown(db, client);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
