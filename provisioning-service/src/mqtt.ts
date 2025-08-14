import { connect, IClientOptions, MqttClient } from 'mqtt';
import { MQTT_PASSWORD, MQTT_URL, MQTT_USERNAME, SERVICE, ENFORCE_WHITELIST } from './config.js';
import { upsertDevice, getWhitelistByUuid, markWhitelistUsed } from './db.js';
import type { Json } from './types.js';

// Topic helpers
const TOPICS = {
  provisionRequest: '$fleethub/devices/+/provision/request',
  accepted: (deviceId: string) => `$fleethub/devices/${deviceId}/provision/accepted`,
  rejected: (deviceId: string) => `$fleethub/devices/${deviceId}/provision/rejected`,
};

function parseDeviceId(topic: string, suffix: string): string | null {
  // $fleethub/devices/{deviceId}/provision/{suffix}
  const parts = topic.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== '$fleethub' || parts[1] !== 'devices') return null;
  if (parts[3] !== 'provision') return null;
  if (!topic.endsWith(suffix)) return null;
  return parts[2];
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
    client.subscribe(TOPICS.provisionRequest, { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe error`, err);
    });
  });
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));

  client.on('message', (topic: string, payload: Buffer) => {
    if (!(topic.startsWith('$fleethub/devices/') && topic.endsWith('/provision/request'))) return;
    const deviceId = parseDeviceId(topic, '/provision/request');
    if (!deviceId) return;
    try {
      const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
      const uuid = typeof (body as any).uuid === 'string' ? String((body as any).uuid) : undefined;
      if (ENFORCE_WHITELIST) {
        if (!uuid) throw new Error('missing_uuid');
        const entry = getWhitelistByUuid((db as any), uuid);
        if (!entry) throw new Error('uuid_not_whitelisted');
        if (entry.used_at) throw new Error('uuid_already_used');
        if (entry.device_id !== deviceId) throw new Error('uuid_device_mismatch');
      }
      const name = typeof body.name === 'string' ? (body.name as string) : undefined;
      const token = typeof body.token === 'string' ? (body.token as string) : undefined;
      const meta = typeof body.meta === 'object' && body.meta ? (body.meta as Json) : undefined;
      upsertDevice(db, deviceId, name, token, meta);
      if (ENFORCE_WHITELIST && uuid) {
        try { markWhitelistUsed(db, uuid); } catch {}
      }
      const respTopic = TOPICS.accepted(deviceId);
      client.publish(respTopic, JSON.stringify({ deviceId, status: 'ok' }), { qos: 1 });
    } catch (e) {
      console.error(`[${SERVICE}] error handling provision request`, e);
      const rej = TOPICS.rejected(deviceId);
      client.publish(rej, JSON.stringify({ error: 'bad_request', message: (e as Error).message }), { qos: 1 });
    }
  });

  return client;
}
