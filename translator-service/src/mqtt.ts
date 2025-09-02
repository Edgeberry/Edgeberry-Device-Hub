import { connect, IClientOptions, MqttClient } from 'mqtt';
import { existsSync, readFileSync } from 'fs';
import { MQTT_PASSWORD, MQTT_TLS_CA, MQTT_TLS_CERT, MQTT_TLS_KEY, MQTT_TLS_REJECT_UNAUTHORIZED, MQTT_URL, MQTT_USERNAME, SERVICE } from './config.js';
import { resolveUuidToName } from './router.js';
import { registerDeviceForMonitoring } from './monitor.js';

const SUB_TOPIC = 'devices/+/messages/events/';

function parseUuidFromTopic(topic: string): string | null {
  // devices/{uuid}/messages/events/
  const parts = topic.split('/');
  if (parts.length < 4) return null;
  if (parts[0] !== 'devices') return null;
  if (parts[2] !== 'messages') return null;
  if (!topic.endsWith('messages/events/')) return null;
  return parts[1];
}

function outTopic(deviceName: string): string { return `$devicehub/devicedata/${deviceName}/`; }

export function startMqtt(): MqttClient {
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
    ca, cert, key,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
  };

  console.log(`[${SERVICE}] MQTT config: url=${MQTT_URL} ca=${MQTT_TLS_CA || 'unset'} cert=${MQTT_TLS_CERT || 'unset'} key=${MQTT_TLS_KEY || 'unset'} rejectUnauthorized=${MQTT_TLS_REJECT_UNAUTHORIZED}`);

  const client = connect(MQTT_URL, options);
  client.on('connect', () => {
    console.log(`[${SERVICE}] connected to MQTT`);
    client.subscribe(SUB_TOPIC, { qos: 1 }, (err) => {
      if (err) console.error(`[${SERVICE}] subscribe error`, err);
      else console.log(`[${SERVICE}] subscribed to ${SUB_TOPIC}`);
    });
  });
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));
  client.on('reconnect', () => console.log(`[${SERVICE}] mqtt reconnecting...`));
  client.on('close', () => console.warn(`[${SERVICE}] mqtt connection closed`));

  client.on('message', (topic, payload) => {
    try {
      if (!topic.startsWith('devices/')) return;
      if (!topic.endsWith('messages/events/')) return;
      const uuid = parseUuidFromTopic(topic);
      if (!uuid) return;
      // Resolve asynchronously to avoid blocking the MQTT loop
      (async () => {
        try {
          const deviceName = await resolveUuidToName(uuid);
          if (!deviceName) return; // unmapped; drop silently
          
          // Register device for monitoring when first encountered
          registerDeviceForMonitoring(uuid, deviceName);
          
          const out = outTopic(deviceName);
          client.publish(out, payload, { qos: 1 });
          console.log(`[${SERVICE}] translated ${topic} -> ${out}`);
        } catch (e) {
          console.error(`[${SERVICE}] resolve/publish error for ${topic}:`, (e as Error).message);
        }
      })();
    } catch (e) {
      console.error(`[${SERVICE}] error handling message on ${topic}:`, (e as Error).message);
    }
  });

  return client;
}
