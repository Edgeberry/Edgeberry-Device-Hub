/**
 * Twin sub-service - device digital twins (desired/reported) and
 * connection-status tracking over MQTT. Ported from the standalone
 * twin-service; storage calls go directly into twin-store.ts, and device
 * status updates persist + broadcast via the callback passed to
 * startTwin() (previously a D-Bus round trip to core's TwinService).
 */
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, existsSync } from 'fs';
import { MQTT_PASSWORD, MQTT_URL, MQTT_USERNAME, MQTT_TLS_CA, MQTT_TLS_CERT, MQTT_TLS_KEY, MQTT_TLS_REJECT_UNAUTHORIZED } from '../../config.js';
import { getTwin, setTwinDoc, recordDeviceConnectionStatus } from '../../twin-store.js';

const SERVICE = 'twin';

type Json = Record<string, unknown>;
export type BroadcastFn = (topic: string, payload: any) => void;

// Topic helpers and constants
const TOPICS = {
  get: '$devicehub/devices/+/twin/get',
  update: '$devicehub/devices/+/twin/update',
  heartbeat: '$devicehub/devices/+/heartbeat',
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

function parseHeartbeatDeviceId(topic: string): string | null {
  const parts = topic.split('/');
  if (parts.length !== 4) return null;
  if (parts[0] !== '$devicehub' || parts[1] !== 'devices' || parts[3] !== 'heartbeat') return null;
  return parts[2];
}

// Filters $SYS connect/disconnect log clientIds down to "this is plausibly a
// device's assigned identity". Two things are deliberately excluded, not
// just unmatched by accident: a device's *provisioning* connection uses the
// bare UUID as its clientId (a one-time claim token, not its ongoing
// identity - see devices-store.ts's claimDeviceName), so recording "online"
// under it would misattribute status to an identity nothing else uses; and
// backend connections on the anonymous loopback listener use mqtt.js's
// auto-generated `mqttjs_*` clientIds, which are not devices at all.
function isValidDeviceId(clientId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(clientId)) return false;
  if (/^mqttjs_/i.test(clientId)) return false;
  // Matches device-names.ts's validation rule: alphanumeric/hyphen/
  // underscore, 4-32 chars, starting alphanumeric.
  return /^[a-zA-Z0-9][a-zA-Z0-9\-_]{3,31}$/.test(clientId);
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

export function startTwin(broadcast: BroadcastFn): MqttClient {
  function updateDeviceStatus(deviceId: string, isOnline: boolean): void {
    const timestampIso = new Date().toISOString();
    try {
      recordDeviceConnectionStatus(deviceId, isOnline, timestampIso);
    } catch (error) {
      console.error(`[${SERVICE}] Failed to persist device status for ${deviceId}:`, error);
      return;
    }
    const statusUpdate = {
      deviceId,
      status: isOnline,
      timestamp: timestampIso,
      last_seen: isOnline ? null : timestampIso
    };
    broadcast('device.status', { type: 'device.status', data: statusUpdate });
  }

  // Only consider TLS materials when using mqtts:// to avoid accidental TLS on mqtt://
  const usingTls = MQTT_URL.startsWith('mqtts://');
  const ca = usingTls && MQTT_TLS_CA && existsSync(MQTT_TLS_CA) ? readFileSync(MQTT_TLS_CA) : undefined;
  const cert = usingTls && MQTT_TLS_CERT && existsSync(MQTT_TLS_CERT) ? readFileSync(MQTT_TLS_CERT) : undefined;
  const key = usingTls && MQTT_TLS_KEY && existsSync(MQTT_TLS_KEY) ? readFileSync(MQTT_TLS_KEY) : undefined;

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
    client.subscribe(TOPICS.get, { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe get error`, err);
    });
    client.subscribe(TOPICS.update, { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe update error`, err);
    });
    // Devices publish a heartbeat every 30s specifically so online status
    // stays fresh between connect/disconnect events - the $SYS/broker/log/N
    // connect line only fires once, so without this a device shows whatever
    // it showed at that one moment forever.
    client.subscribe(TOPICS.heartbeat, { qos: 0 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe heartbeat error`, err);
    });
    // Subscribe to Mosquitto client connection events for device tracking
    client.subscribe('$SYS/broker/log/N', { qos: 1 }, (err) => {
      if (err) console.error(`[${SERVICE}] failed to subscribe to client events:`, err);
    });
  });
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));

  client.on('message', async (topic: string, payload: Buffer) => {
    try {
      // Handle Mosquitto client connection events
      if (topic === '$SYS/broker/log/N') {
        const message = payload.toString();
        // "New client connected from <ip>:<port> as <clientId>" /
        // "Client <clientId> closed its connection|disconnected|has exceeded timeout, disconnecting."
        const connectMatch = message.match(/New client connected from [^\s]+ as ([^\s]+)/);
        const disconnectMatch = message.match(/Client ([^\s]+) (?:closed its connection|disconnected|has exceeded timeout, disconnecting)/);

        if (connectMatch && isValidDeviceId(connectMatch[1])) {
          updateDeviceStatus(connectMatch[1], true);
        } else if (disconnectMatch && isValidDeviceId(disconnectMatch[1])) {
          updateDeviceStatus(disconnectMatch[1], false);
        }
        return;
      }
      const heartbeatDeviceId = parseHeartbeatDeviceId(topic);
      if (heartbeatDeviceId) {
        updateDeviceStatus(heartbeatDeviceId, true);
        return;
      }
      if (topic.startsWith('$devicehub/devices/') && topic.endsWith('/twin/get')) {
        const deviceId = parseTopicDeviceId(topic, '/twin/get');
        if (!deviceId) return;
        const twin = getTwin(deviceId);
        client.publish(TOPICS.accepted(deviceId), JSON.stringify({ deviceId, desired: twin.desired, reported: twin.reported }), { qos: 1 });
        return;
      }
      if (topic.startsWith('$devicehub/devices/') && topic.endsWith('/twin/update')) {
        const deviceId = parseTopicDeviceId(topic, '/twin/update');
        if (!deviceId) return;
        const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
        let desiredUpdated: { version: number; doc: Json } | null = null;
        let reportedUpdated: { version: number; doc: Json } | null = null;
        if (body.desired && typeof body.desired === 'object') desiredUpdated = setTwinDoc('twin_desired', deviceId, body.desired as Json);
        if (body.reported && typeof body.reported === 'object') reportedUpdated = setTwinDoc('twin_reported', deviceId, body.reported as Json);
        const { desired, reported } = getTwin(deviceId);
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
