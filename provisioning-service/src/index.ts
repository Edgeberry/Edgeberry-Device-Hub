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
import Database from 'better-sqlite3';
import { connect, IClientOptions, MqttClient } from 'mqtt';

type Json = Record<string, unknown>;

// Service id used for logs
const SERVICE = 'provisioning-service';
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;
const DB_PATH = process.env.PROVISIONING_DB || 'provisioning.db';

/** Initialize SQLite and ensure device table exists. */
function initDb(path: string) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      token TEXT,
      meta TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

/** Insert or update a device record by id. */
function upsertDevice(db: Database, deviceId: string, name?: string, token?: string, meta?: Json) {
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO devices (id, name, token, meta, created_at) VALUES (@id, @name, @token, @meta, @created_at)
     ON CONFLICT(id) DO UPDATE SET name=coalesce(excluded.name, devices.name), token=coalesce(excluded.token, devices.token), meta=coalesce(excluded.meta, devices.meta)`
  );
  ins.run({ id: deviceId, name: name || null, token: token || null, meta: meta ? JSON.stringify(meta) : null, created_at: now });
}

/** Extract the deviceId from a provisioning topic. */
function parseDeviceId(topic: string, suffix: string): string | null {
  // $fleethub/devices/{deviceId}/provision/{suffix}
  const parts = topic.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== '$fleethub' || parts[1] !== 'devices') return null;
  if (parts[3] !== 'provision') return null;
  if (!topic.endsWith(suffix)) return null;
  return parts[2];
}

async function main() {
  console.log(`[${SERVICE}] starting...`);
  const db = initDb(DB_PATH);

  // MQTT client options — broker creds are optional for local dev
  const options: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    reconnectPeriod: 2000,
  };
  const client: MqttClient = connect(MQTT_URL, options);

  // Subscribe to provisioning requests when connected
  client.on('connect', () => {
    console.log(`[${SERVICE}] connected to MQTT`);
    client.subscribe('$fleethub/devices/+/provision/request', { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe error`, err);
    });
  });

  // Handle provisioning requests
  client.on('message', (topic: string, payload: Buffer) => {
    if (!(topic.startsWith('$fleethub/devices/') && topic.endsWith('/provision/request'))) return;
    const deviceId = parseDeviceId(topic, '/provision/request');
    if (!deviceId) return;
    try {
      // Expected payload: { name?: string, token?: string, meta?: object }
      const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
      const name = typeof body.name === 'string' ? (body.name as string) : undefined;
      const token = typeof body.token === 'string' ? (body.token as string) : undefined;
      const meta = typeof body.meta === 'object' && body.meta ? (body.meta as Json) : undefined;
      // Upsert keeps idempotency: repeated requests do not duplicate rows
      upsertDevice(db, deviceId, name, token, meta);
      const respTopic = `$fleethub/devices/${deviceId}/provision/accepted`;
      // QoS 1 to ensure delivery even with transient disconnects
      client.publish(respTopic, JSON.stringify({ deviceId, status: 'ok' }), { qos: 1 });
    } catch (e) {
      console.error(`[${SERVICE}] error handling provision request`, e);
      const rej = `$fleethub/devices/${deviceId}/provision/rejected`;
      // Avoid leaking internal error details; send a generic code + message
      client.publish(rej, JSON.stringify({ error: 'bad_request', message: (e as Error).message }), { qos: 1 });
    }
  });

  const shutdown = () => {
    console.log(`[${SERVICE}] shutting down...`);
    try { client.end(true); } catch {}
    try { (db as any).close?.(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
