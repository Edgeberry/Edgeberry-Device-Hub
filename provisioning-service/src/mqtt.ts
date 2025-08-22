import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, existsSync } from 'fs';
import { MQTT_PASSWORD, MQTT_URL, MQTT_USERNAME, SERVICE, ENFORCE_WHITELIST, MQTT_TLS_CA, MQTT_TLS_CERT, MQTT_TLS_KEY, MQTT_TLS_REJECT_UNAUTHORIZED, CERT_DAYS } from './config.js';
import { dbusCheckUUID, dbusMarkUsed, dbusIssueFromCSR } from './dbus.js';
import type { Json } from './types.js';

// Topic helpers and constants
const TOPICS = {
  provisionRequest: '$devicehub/devices/+/provision/request',
  accepted: (uuid: string) => `$devicehub/devices/${uuid}/provision/accepted`,
  rejected: (uuid: string) => `$devicehub/devices/${uuid}/provision/rejected`,
};

function parseTopicUuid(topic: string, suffix: string): string | null {
  // $devicehub/devices/{uuid}/provision/{suffix}
  const parts = topic.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== '$devicehub' || parts[1] !== 'devices') return null;
  if (parts[3] !== 'provision') return null;
  if (!topic.endsWith(suffix)) return null;
  return parts[2];
}

export function startMqtt(): MqttClient {
  const usingTls = MQTT_URL.startsWith('mqtts://');
  // Only attempt to load TLS files when using mqtts://. Wrap reads to avoid crashes on missing files.
  let ca: Buffer | undefined;
  let cert: Buffer | undefined;
  let key: Buffer | undefined;
  if (usingTls) {
    if (MQTT_TLS_CA) {
      try {
        if (existsSync(MQTT_TLS_CA)) ca = readFileSync(MQTT_TLS_CA);
        else console.warn(`[${SERVICE}] WARNING: MQTT_TLS_CA path set but file not found: ${MQTT_TLS_CA}`);
      } catch (e) {
        console.warn(`[${SERVICE}] WARNING: failed to read MQTT_TLS_CA (${MQTT_TLS_CA}): ${(e as Error).message}`);
      }
    }
    if (MQTT_TLS_CERT) {
      try {
        if (existsSync(MQTT_TLS_CERT)) cert = readFileSync(MQTT_TLS_CERT);
        else console.warn(`[${SERVICE}] WARNING: MQTT_TLS_CERT path set but file not found: ${MQTT_TLS_CERT}`);
      } catch (e) {
        console.warn(`[${SERVICE}] WARNING: failed to read MQTT_TLS_CERT (${MQTT_TLS_CERT}): ${(e as Error).message}`);
      }
    }
    if (MQTT_TLS_KEY) {
      try {
        if (existsSync(MQTT_TLS_KEY)) key = readFileSync(MQTT_TLS_KEY);
        else console.warn(`[${SERVICE}] WARNING: MQTT_TLS_KEY path set but file not found: ${MQTT_TLS_KEY}`);
      } catch (e) {
        console.warn(`[${SERVICE}] WARNING: failed to read MQTT_TLS_KEY (${MQTT_TLS_KEY}): ${(e as Error).message}`);
      }
    }
  }

  // Only send credentials if both username and password are set. Some broker configs reject
  // a CONNECT with username but empty password even when allow_anonymous is true.
  const auth: Partial<IClientOptions> = {};
  if (MQTT_USERNAME && MQTT_PASSWORD) {
    auth.username = MQTT_USERNAME;
    auth.password = MQTT_PASSWORD;
  } else if (MQTT_USERNAME && !MQTT_PASSWORD) {
    console.warn(`[${SERVICE}] WARNING: MQTT_USERNAME is set but MQTT_PASSWORD is missing; connecting without credentials`);
  }

  const options: IClientOptions = {
    ...auth,
    reconnectPeriod: 2000,
    // Mirror twin-service behavior: do not force protocol; mqtt.js will infer based on URL
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
    client.subscribe(TOPICS.provisionRequest, { qos: 1 }, (err: Error | null) => {
      if (err) console.error(`[${SERVICE}] subscribe error`, err);
      else console.log(`[${SERVICE}] subscribed to ${TOPICS.provisionRequest}`);
    });
  });
  client.on('error', (err) => console.error(`[${SERVICE}] mqtt error`, err));
  client.on('close', () => console.warn(`[${SERVICE}] mqtt connection closed`));
  client.on('offline', () => console.warn(`[${SERVICE}] mqtt offline`));
  client.on('reconnect', () => console.log(`[${SERVICE}] mqtt reconnecting...`));

  client.on('message', async (topic: string, payload: Buffer) => {
    if (!(topic.startsWith('$devicehub/devices/') && topic.endsWith('/provision/request'))) return;
    const uuidFromTopic = parseTopicUuid(topic, '/provision/request');
    if (!uuidFromTopic) return;
    try {
      const rawLen = payload?.length ?? 0;
      console.log(`[${SERVICE}] provision message topic=${topic} bytes=${rawLen}`);
      console.log(`[${SERVICE}] provision request received for uuid=${uuidFromTopic}`);
      const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
      const hasBodyUuid = typeof (body as any).uuid === 'string';
      const bodyUuid = hasBodyUuid ? String((body as any).uuid) : undefined;
      const uuid = hasBodyUuid ? (bodyUuid as string) : uuidFromTopic;
      const csrPem = typeof (body as any).csrPem === 'string' ? String((body as any).csrPem) : undefined;
      console.log(`[${SERVICE}] provision parsed uuid=${uuid} csrPemLen=${csrPem ? csrPem.length : 0}`);
      if (hasBodyUuid && bodyUuid !== uuidFromTopic) {
        console.warn(`[${SERVICE}] uuid mismatch: topic=${uuidFromTopic} body=${bodyUuid}`);
        const rej = TOPICS.rejected(uuidFromTopic);
        client.publish(rej, JSON.stringify({ error: 'uuid_mismatch', message: 'body.uuid must match topic UUID' }), { qos: 1 });
        return;
      }
      if (ENFORCE_WHITELIST) {
        if (!uuid) throw new Error('missing_uuid');
        // Ask Core over D-Bus
        const res = await dbusCheckUUID(uuid);
        if (!res.ok) throw new Error(res.error || 'uuid_not_whitelisted');
        console.log(`[${SERVICE}] whitelist ok for uuid=${uuid}`);
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
      // Use uuid as deviceId for certificate issuance (device identity equals UUID)
      dbusIssueFromCSR(uuid, csrPem, CERT_DAYS)
        .then(async (res) => {
          if (!res.ok || !res.certPem || !res.caChainPem) throw new Error(res.error || 'issue_failed');
          const { certPem, caChainPem } = res;
          if (ENFORCE_WHITELIST && uuid) {
            try { await dbusMarkUsed(uuid); } catch {}
          }
          const respTopic = TOPICS.accepted(uuid);
          console.log(`[${SERVICE}] provision accepted for uuid=${uuid}; publishing ${respTopic}`);
          client.publish(respTopic, JSON.stringify({ deviceId: uuid, certPem, caChainPem }), { qos: 1 });
        })
        .catch((err) => {
          const rej = TOPICS.rejected(uuidFromTopic);
          console.error(`[${SERVICE}] provision issue_failed for uuid=${uuidFromTopic}:`, err?.message || err);
          client.publish(rej, JSON.stringify({ error: 'issue_failed', message: String(err?.message || err) }), { qos: 1 });
        });
    } catch (e) {
      console.error(`[${SERVICE}] error handling provision request`, e);
      const rej = TOPICS.rejected(uuidFromTopic);
      client.publish(rej, JSON.stringify({ error: 'bad_request', message: (e as Error).message }), { qos: 1 });
    }
  });

  return client;
}
