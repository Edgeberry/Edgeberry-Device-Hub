import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { MQTT_PASSWORD, MQTT_URL, MQTT_USERNAME, SERVICE, ENFORCE_WHITELIST, MQTT_TLS_CA, MQTT_TLS_CERT, MQTT_TLS_KEY, MQTT_TLS_REJECT_UNAUTHORIZED, CERT_DAYS } from './config.js';
import { upsertDevice, getWhitelistByUuid, markWhitelistUsed } from './db.js';
import type { Json } from './types.js';
import { issueDeviceCertFromCSR } from './certs.js';

// Topic helpers
const TOPICS = {
  provisionRequest: '$devicehub/devices/+/provision/request',
  accepted: (deviceId: string) => `$devicehub/devices/${deviceId}/provision/accepted`,
  rejected: (deviceId: string) => `$devicehub/devices/${deviceId}/provision/rejected`,
};

function parseDeviceId(topic: string, suffix: string): string | null {
  // $devicehub/devices/{deviceId}/provision/{suffix}
  const parts = topic.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== '$devicehub' || parts[1] !== 'devices') return null;
  if (parts[3] !== 'provision') return null;
  if (!topic.endsWith(suffix)) return null;
  return parts[2];
}

export function startMqtt(db: any): MqttClient {
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
  // Log effective MQTT settings for diagnostics (avoid secrets)
  console.log(
    `[${SERVICE}] MQTT config: url=${MQTT_URL} ca=${MQTT_TLS_CA || 'unset'} cert=${MQTT_TLS_CERT || 'unset'} key=${MQTT_TLS_KEY || 'unset'} rejectUnauthorized=${MQTT_TLS_REJECT_UNAUTHORIZED}`
  );
  // Attempt to log client certificate CN (username when broker uses use_subject_as_username)
  if (MQTT_TLS_CERT) {
    try {
      const res = spawnSync('openssl', ['x509', '-in', MQTT_TLS_CERT, '-noout', '-subject'], { encoding: 'utf8' });
      const subj = (res.stdout || '').trim();
      const cnMatch = subj.match(/CN=([^,\/]+)/);
      const cn = cnMatch ? cnMatch[1] : 'unknown';
      console.log(`[${SERVICE}] client cert subject: ${subj || 'unavailable'} (CN=${cn})`);
      if (cn !== 'provisioning') {
        console.warn(`[${SERVICE}] WARNING: client cert CN is '${cn}', but ACL expects username 'provisioning'.`);
      }
    } catch {}
  }
  const client: MqttClient = connect(MQTT_URL, options);
  client.on('connect', () => {
    console.log(`[${SERVICE}] connected to MQTT`);
    client.subscribe(TOPICS.provisionRequest, { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe error`, err);
    });
  });
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));

  client.on('message', (topic: string, payload: Buffer) => {
    if (!(topic.startsWith('$devicehub/devices/') && topic.endsWith('/provision/request'))) return;
    const deviceId = parseDeviceId(topic, '/provision/request');
    if (!deviceId) return;
    try {
      console.log(`[${SERVICE}] provision request received for deviceId=${deviceId}`);
      const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
      const uuid = typeof (body as any).uuid === 'string' ? String((body as any).uuid) : undefined;
      const csrPem = typeof (body as any).csrPem === 'string' ? String((body as any).csrPem) : undefined;
      if (ENFORCE_WHITELIST) {
        if (!uuid) throw new Error('missing_uuid');
        const entry = getWhitelistByUuid((db as any), uuid);
        if (!entry) throw new Error('uuid_not_whitelisted');
        if (entry.used_at) throw new Error('uuid_already_used');
        // device_id is no longer enforced; whitelist is UUID-only
      }
      const name = typeof body.name === 'string' ? (body.name as string) : undefined;
      const token = typeof body.token === 'string' ? (body.token as string) : undefined;
      let meta = typeof body.meta === 'object' && body.meta ? (body.meta as Json) : undefined;
      // Persist UUID inside device meta so it is available to admin UI; harmless for anonymous as UI won't render it
      if (uuid) {
        try {
          const existing = (meta && typeof meta === 'object') ? (meta as any) : {};
          meta = { ...existing, uuid } as Json;
        } catch {
          meta = { uuid } as Json;
        }
      }
      // If CSR provided, issue device certificate using Root CA
      if (!csrPem) {
        throw new Error('missing_csrPem');
      }
      issueDeviceCertFromCSR(deviceId, csrPem, CERT_DAYS)
        .then(({ certPem, caChainPem }) => {
          upsertDevice(db, deviceId, name, token, meta);
          if (ENFORCE_WHITELIST && uuid) {
            try { markWhitelistUsed(db, uuid); } catch {}
          }
          const respTopic = TOPICS.accepted(deviceId);
          console.log(`[${SERVICE}] provision accepted for ${deviceId}; publishing ${respTopic}`);
          client.publish(respTopic, JSON.stringify({ deviceId, certPem, caChainPem }), { qos: 1 });
        })
        .catch((err) => {
          const rej = TOPICS.rejected(deviceId);
          console.error(`[${SERVICE}] provision issue_failed for ${deviceId}:`, err?.message || err);
          client.publish(rej, JSON.stringify({ error: 'issue_failed', message: String(err?.message || err) }), { qos: 1 });
        });
    } catch (e) {
      console.error(`[${SERVICE}] error handling provision request`, e);
      const rej = TOPICS.rejected(deviceId);
      client.publish(rej, JSON.stringify({ error: 'bad_request', message: (e as Error).message }), { qos: 1 });
    }
  });

  return client;
}
