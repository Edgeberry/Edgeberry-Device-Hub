import { connect, IClientOptions, MqttClient, ISubscriptionGrant } from 'mqtt';
import { readFileSync } from 'fs';
import {
  MQTT_PASSWORD,
  MQTT_URL,
  MQTT_USERNAME,
  SERVICE,
  MQTT_TLS_CA,
  MQTT_TLS_CERT,
  MQTT_TLS_KEY,
  MQTT_TLS_REJECT_UNAUTHORIZED,
} from './config.js';
import { prepareInsert } from './db.js';

function extractDeviceId(topic: string): string | null {
  const parts = topic.split('/');
  if (parts.length < 2) return null;
  if (parts[0] !== 'devices') return null;
  return parts[1] || null;
}

export function startMqtt(db: any): MqttClient {
  // Conditionally load TLS files if provided via env
  const ca = MQTT_TLS_CA ? readFileSync(MQTT_TLS_CA) : undefined;
  const cert = MQTT_TLS_CERT ? readFileSync(MQTT_TLS_CERT) : undefined;
  const key = MQTT_TLS_KEY ? readFileSync(MQTT_TLS_KEY) : undefined;

  const options: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    reconnectPeriod: 2000,
    ca,
    cert,
    key,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
  };
  const client: MqttClient = connect(MQTT_URL, options);
  client.on('connect', () => {
    console.log(`[${SERVICE}] connected to MQTT`);
    client.subscribe('devices/#', { qos: 1 }, (err: Error | null, _grants?: ISubscriptionGrant[]) => {
      if (err) console.error(`[${SERVICE}] subscribe error`, err);
    });
  });
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));

  // Prepare insert statement once
  const insert = prepareInsert(db);

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

  return client;
}
