/**
 * Registry Service (MVP)
 * ---------------------------------------------
 * Purpose
 * - Collect and persist device runtime events for observability and auditing.
 *
 * Responsibilities
 * - Subscribe to `devices/#` MQTT topics and store raw payloads in SQLite (`registry.db`).
 * - Provide data for UI/API endpoints (e.g., `/api/devices/:id/events`).
 *
 * Messaging Contracts
 * - Ingests: `devices/#` (QoS 1). No outgoing topics from this service in MVP.
 * - Payloads are stored verbatim (BLOB). Interpretation is deferred to readers.
 *
 * Environment & Dependencies
 * - MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD: broker connection; production expects mTLS and ACLs.
 * - REGISTRY_DB: path to SQLite database file (default `registry.db`).
 *
 * Operational Notes
 * - QoS 1 for subscribe to balance reliability and throughput.
 * - WAL mode enabled in DB for concurrent writes/reads.
 * - Shutdown cleans up MQTT and DB via `registerShutdown()`.
 *
 * Security Notes
 * - Do not log payload contents if they may include sensitive data.
 * - Broker ACLs should scope each device to its namespace.
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
