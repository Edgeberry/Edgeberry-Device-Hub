import { connect, IClientOptions, MqttClient, ISubscriptionGrant } from 'mqtt';
import { MQTT_PASSWORD, MQTT_URL, MQTT_USERNAME, SERVICE } from './config.js';

function extractDeviceId(topic: string): string | null {
  const parts = topic.split('/');
  if (parts.length < 2) return null;
  if (parts[0] !== 'devices') return null;
  return parts[1] || null;
}

export function startMqtt(db: any): MqttClient {
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
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));

  // Lazy load prepared insert
  const { prepareInsert } = require('./db.js');
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
