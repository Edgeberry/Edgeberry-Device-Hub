/**
 * Provisioning Service (MVP)
 * ---------------------------------------------
 * Responsibilities:
 * - Accept provisioning requests from devices over MQTT
 * - Upsert device metadata into SQLite (id, name, token, meta)
 * - Acknowledge success or failure via MQTT topics
 *
 * Topics (per device):
 * - Request: `$fleethub/devices/{deviceId}/provision/request`
 * - Success: `$fleethub/devices/{deviceId}/provision/accepted`
 * - Failure: `$fleethub/devices/{deviceId}/provision/rejected`
 */
import { SERVICE, DB_PATH } from './config.js';
import { initDb } from './db.js';
import { startMqtt } from './mqtt.js';
import { registerShutdown } from './shutdown.js';

type Json = Record<string, unknown>;

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
