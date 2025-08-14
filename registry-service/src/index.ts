/**
 * Registry Service (MVP)
 * ---------------------------------------------
 * Responsibilities:
 * - Ingest device runtime events from MQTT topics `devices/#`
 * - Persist raw events into SQLite for operational visibility
 *
 * Notes:
 * - Payloads are stored as raw BLOBs for simplicity in MVP.
 */
import { SERVICE, DB_PATH } from './config.js';
import { initDb } from './db.js';
import { startMqtt } from './mqtt.js';
import { registerShutdown } from './shutdown.js';

// Service id used for logs
// See src/config.ts for configuration

// Moved: DB init and topic helpers now live in src/db.ts and src/topics.ts

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
