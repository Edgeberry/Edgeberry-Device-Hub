import Database from 'better-sqlite3';
import { connect, IClientOptions, MqttClient, ISubscriptionGrant } from 'mqtt';

const SERVICE = 'registry-service';
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;
const DB_PATH = process.env.REGISTRY_DB || 'registry.db';

function initDb(path: string) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload BLOB,
      ts TEXT NOT NULL
    );
  `);
  return db;
}

function extractDeviceId(topic: string): string | null {
  // devices/{deviceId}/...
  const parts = topic.split('/');
  if (parts.length < 2) return null;
  if (parts[0] !== 'devices') return null;
  return parts[1] || null;
}

async function main() {
  console.log(`[${SERVICE}] starting...`);
  const db = initDb(DB_PATH);
  const insert = db.prepare(
    'INSERT INTO device_events (device_id, topic, payload, ts) VALUES (@device_id, @topic, @payload, @ts)'
  );

  const options: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    reconnectPeriod: 2000,
  };
  const client: MqttClient = connect(MQTT_URL, options);

  client.on('connect', () => {
    console.log(`[${SERVICE}] connected to MQTT`);
    client.subscribe('devices/#', { qos: 1 }, (err: Error | null, _grants?: ISubscriptionGrant[]) => {
      if (err) console.error(`[${SERVICE}] subscribe error`, err);
    });
  });

  client.on('message', (topic: string, payload: Buffer) => {
    const deviceId = extractDeviceId(topic);
    if (!deviceId) return;
    try {
      const now = new Date().toISOString();
      insert.run({ device_id: deviceId, topic, payload, ts: now });
    } catch (e) {
      console.error(`[${SERVICE}] failed to persist event`, e);
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
