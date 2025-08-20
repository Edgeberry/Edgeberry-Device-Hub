import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, existsSync } from 'fs';
import { MQTT_PASSWORD, MQTT_URL, MQTT_USERNAME, SERVICE, MQTT_TLS_CA, MQTT_TLS_CERT, MQTT_TLS_KEY, MQTT_TLS_REJECT_UNAUTHORIZED } from './config.js';
import { Json } from './types.js';
import { getTwin, setDoc } from './db.js';

// Topic helpers and constants
const TOPICS = {
  get: '$devicehub/devices/+/twin/get',
  update: '$devicehub/devices/+/twin/update',
  accepted: (deviceId: string) => `$devicehub/devices/${deviceId}/twin/update/accepted`,
  delta: (deviceId: string) => `$devicehub/devices/${deviceId}/twin/update/delta`,
  rejected: (deviceId: string) => `$devicehub/devices/${deviceId}/twin/update/rejected`,
};

function parseTopicDeviceId(topic: string, suffix: string): string | null {
  const parts = topic.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== '$devicehub' || parts[1] !== 'devices') return null;
  if (parts[3] !== 'twin') return null;
  if (!topic.endsWith(suffix)) return null;
  return parts[2];
}

function shallowDelta(desired: Json, reported: Json): Json {
  const delta: Json = {};
  const keys = new Set([...Object.keys(desired), ...Object.keys(reported)]);
  for (const k of keys) {
    const dv = desired[k];
    const rv = reported[k];
    if (JSON.stringify(dv) !== JSON.stringify(rv)) delta[k] = dv;
  }
  return delta;
}

export function startMqtt(db: any): MqttClient {
  // Only consider TLS materials when using mqtts:// to avoid accidental TLS on mqtt://
  const usingTls = MQTT_URL.startsWith('mqtts://');
  const ca = usingTls && MQTT_TLS_CA && existsSync(MQTT_TLS_CA) ? readFileSync(MQTT_TLS_CA) : undefined;
  if (usingTls && MQTT_TLS_CA && !ca) console.warn(`[${SERVICE}] WARNING: MQTT_TLS_CA path set but file not found: ${MQTT_TLS_CA}`);
  const cert = usingTls && MQTT_TLS_CERT && existsSync(MQTT_TLS_CERT) ? readFileSync(MQTT_TLS_CERT) : undefined;
  if (usingTls && MQTT_TLS_CERT && !cert) console.warn(`[${SERVICE}] WARNING: MQTT_TLS_CERT path set but file not found: ${MQTT_TLS_CERT}`);
  const key = usingTls && MQTT_TLS_KEY && existsSync(MQTT_TLS_KEY) ? readFileSync(MQTT_TLS_KEY) : undefined;
  if (usingTls && MQTT_TLS_KEY && !key) console.warn(`[${SERVICE}] WARNING: MQTT_TLS_KEY path set but file not found: ${MQTT_TLS_KEY}`);

  const options: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    reconnectPeriod: 2000,
    ca,
    cert,
    key,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
  };
  // Log effective MQTT settings for diagnostics (avoid secrets)
  console.log(
    `[${SERVICE}] MQTT config: url=${MQTT_URL} ca=${MQTT_TLS_CA || 'unset'} cert=${MQTT_TLS_CERT || 'unset'} key=${MQTT_TLS_KEY || 'unset'} rejectUnauthorized=${MQTT_TLS_REJECT_UNAUTHORIZED}`
  );
  const client: MqttClient = connect(MQTT_URL, options);
  client.on('connect', () => {
    console.log(`[${SERVICE}] connected to MQTT`);
    client.subscribe(TOPICS.get, { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe get error`, err);
    });
    client.subscribe(TOPICS.update, { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe update error`, err);
    });
  });
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));

  client.on('message', (topic: string, payload: Buffer) => {
    try {
      if (topic.startsWith('$devicehub/devices/') && topic.endsWith('/twin/get')) {
        const deviceId = parseTopicDeviceId(topic, '/twin/get');
        if (!deviceId) return;
        const twin = getTwin(db, deviceId);
        client.publish(TOPICS.accepted(deviceId), JSON.stringify({ deviceId, desired: twin.desired, reported: twin.reported }), { qos: 1 });
        return;
      }
      if (topic.startsWith('$devicehub/devices/') && topic.endsWith('/twin/update')) {
        const deviceId = parseTopicDeviceId(topic, '/twin/update');
        if (!deviceId) return;
        const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
        let desiredUpdated: { version: number; doc: Json } | null = null;
        let reportedUpdated: { version: number; doc: Json } | null = null;
        if (body.desired && typeof body.desired === 'object') desiredUpdated = setDoc(db, 'twin_desired', deviceId, body.desired as Json);
        if (body.reported && typeof body.reported === 'object') reportedUpdated = setDoc(db, 'twin_reported', deviceId, body.reported as Json);
        const { desired, reported } = getTwin(db, deviceId);
        client.publish(TOPICS.accepted(deviceId), JSON.stringify({ deviceId, desired, reported, updated: { desired: desiredUpdated, reported: reportedUpdated } }), { qos: 1 });
        const delta = shallowDelta(desired.doc, reported.doc);
        if (Object.keys(delta).length > 0) {
          client.publish(TOPICS.delta(deviceId), JSON.stringify({ deviceId, delta, desiredVersion: desired.version, reportedVersion: reported.version }), { qos: 1 });
        }
        return;
      }
    } catch (e) {
      console.error(`[${SERVICE}] message error on topic ${topic}:`, e);
      const deviceId = topic.includes('/devices/') ? topic.split('/')[2] : undefined;
      if (deviceId) client.publish(TOPICS.rejected(deviceId), JSON.stringify({ error: 'bad_request', message: (e as Error).message }), { qos: 1 });
    }
  });

  return client;
}
