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
import Database from 'better-sqlite3';
import { connect, IClientOptions, MqttClient } from 'mqtt';

type Json = Record<string, unknown>;

// Service id used for logs
const SERVICE = 'twin-service';
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;
const DB_PATH = process.env.TWIN_DB || 'twin.db';

/** Initialize SQLite and ensure tables exist. */
function initDb(path: string) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS twin_desired (
      device_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0,
      doc TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS twin_reported (
      device_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0,
      doc TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

/** Load desired and reported docs for a device (defaults to empty). */
function getTwin(db: Database, deviceId: string) {
  const getDesired = db.prepare('SELECT version, doc FROM twin_desired WHERE device_id = ?');
  const getReported = db.prepare('SELECT version, doc FROM twin_reported WHERE device_id = ?');
  const d = getDesired.get(deviceId) as { version: number; doc: string } | undefined;
  const r = getReported.get(deviceId) as { version: number; doc: string } | undefined;
  return {
    desired: d ? { version: d.version, doc: JSON.parse(d.doc) as Json } : { version: 0, doc: {} },
    reported: r ? { version: r.version, doc: JSON.parse(r.doc) as Json } : { version: 0, doc: {} },
  };
}

/**
 * Compute a shallow delta between desired and reported.
 * If values differ (by JSON string comparison) we include desired's value.
 */
function shallowDelta(desired: Json, reported: Json): Json {
  const delta: Json = {};
  const keys = new Set([...Object.keys(desired), ...Object.keys(reported)]);
  for (const k of keys) {
    const dv = desired[k];
    const rv = reported[k];
    if (JSON.stringify(dv) !== JSON.stringify(rv)) {
      delta[k] = dv;
    }
  }
  return delta;
}

/**
 * Merge a partial patch into either desired or reported doc, bump version, upsert.
 */
function setDoc(
  db: Database,
  table: 'twin_desired' | 'twin_reported',
  deviceId: string,
  patch: Json
) {
  const now = new Date().toISOString();
  const getStmt = db.prepare(`SELECT version, doc FROM ${table} WHERE device_id = ?`);
  const row = getStmt.get(deviceId) as { version: number; doc: string } | undefined;
  const current: Json = row ? (JSON.parse(row.doc) as Json) : {};
  const next: Json = { ...current, ...patch };
  const nextVersion = (row?.version || 0) + 1;
  const upsert = db.prepare(
    `INSERT INTO ${table} (device_id, version, doc, updated_at) VALUES (@device_id, @version, @doc, @updated_at)
     ON CONFLICT(device_id) DO UPDATE SET version=excluded.version, doc=excluded.doc, updated_at=excluded.updated_at`
  );
  upsert.run({ device_id: deviceId, version: nextVersion, doc: JSON.stringify(next), updated_at: now });
  return { version: nextVersion, doc: next };
}

/** Extract the deviceId from a topic ensuring it matches the expected suffix. */
function parseTopicDeviceId(topic: string, suffix: string): string | null {
  // $fleethub/devices/{deviceId}/twin/{suffix}
  const parts = topic.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== '$fleethub' || parts[1] !== 'devices') return null;
  if (parts[3] !== 'twin') return null;
  if (!topic.endsWith(suffix)) return null;
  return parts[2];
}

async function main() {
  console.log(`[${SERVICE}] starting...`);
  const db = initDb(DB_PATH);

  const options: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    reconnectPeriod: 2000,
  };
  const client: MqttClient = connect(MQTT_URL, options);

  // When connected, subscribe to twin get/update topics
  client.on('connect', () => {
    console.log(`[${SERVICE}] connected to MQTT`);
    client.subscribe('$fleethub/devices/+/twin/get', { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe get error`, err);
    });
    client.subscribe('$fleethub/devices/+/twin/update', { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe update error`, err);
    });
  });

  // Core message handler for twin topics
  client.on('message', (topic: string, payload: Buffer) => {
    try {
      if (topic.startsWith('$fleethub/devices/') && topic.endsWith('/twin/get')) {
        const deviceId = parseTopicDeviceId(topic, '/twin/get');
        if (!deviceId) return;
        const twin = getTwin(db, deviceId);
        const respTopic = `$fleethub/devices/${deviceId}/twin/update/accepted`;
        client.publish(respTopic, JSON.stringify({ deviceId, desired: twin.desired, reported: twin.reported }), { qos: 1 });
        return;
      }

      if (topic.startsWith('$fleethub/devices/') && topic.endsWith('/twin/update')) {
        const deviceId = parseTopicDeviceId(topic, '/twin/update');
        if (!deviceId) return;
        // Supported update payload shape: { desired?: {...}, reported?: {...} }
        const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
        let desiredUpdated: { version: number; doc: Json } | null = null;
        let reportedUpdated: { version: number; doc: Json } | null = null;

        if (body.desired && typeof body.desired === 'object') {
          desiredUpdated = setDoc(db, 'twin_desired', deviceId, body.desired as Json);
        }
        if (body.reported && typeof body.reported === 'object') {
          reportedUpdated = setDoc(db, 'twin_reported', deviceId, body.reported as Json);
        }

        const { desired, reported } = getTwin(db, deviceId);
        const acceptedTopic = `$fleethub/devices/${deviceId}/twin/update/accepted`;
        client.publish(
          acceptedTopic,
          JSON.stringify({ deviceId, desired, reported, updated: { desired: desiredUpdated, reported: reportedUpdated } }),
          { qos: 1 }
        );

        // Compute and publish delta (desired vs reported)
        // Compute delta so device can reconcile desired vs its reported state
        const delta = shallowDelta(desired.doc, reported.doc);
        if (Object.keys(delta).length > 0) {
          const deltaTopic = `$fleethub/devices/${deviceId}/twin/update/delta`;
          client.publish(deltaTopic, JSON.stringify({ deviceId, delta, desiredVersion: desired.version, reportedVersion: reported.version }), { qos: 1 });
        }
        return;
      }
    } catch (e) {
      console.error(`[${SERVICE}] message error on topic ${topic}:`, e);
      const deviceId = topic.includes('/devices/') ? topic.split('/')[2] : undefined;
      if (deviceId) {
        const rej = `$fleethub/devices/${deviceId}/twin/update/rejected`;
        client.publish(rej, JSON.stringify({ error: 'bad_request', message: (e as Error).message }), { qos: 1 });
      }
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
