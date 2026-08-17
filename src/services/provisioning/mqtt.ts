/**
 * Provisioning sub-service - handles the device claim-certificate handshake
 * over MQTT. Ported from the standalone provisioning-service; the D-Bus
 * calls to core became direct calls into whitelist-store.ts /
 * devices-store.ts / certs.ts (same call sites, same order, same error
 * handling).
 */
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, existsSync } from 'fs';
import { MQTT_PASSWORD, MQTT_URL, MQTT_USERNAME, ENFORCE_WHITELIST, MQTT_TLS_CA, MQTT_TLS_CERT, MQTT_TLS_KEY, MQTT_TLS_REJECT_UNAUTHORIZED, CERT_DAYS } from '../../config.js';
import { checkUuid, markUsed } from '../../whitelist-store.js';
import { claimDeviceName, resolveDeviceIdByUuid, registerDevice } from '../../devices-store.js';
import { issueDeviceCertFromCSR } from '../../certs.js';

const SERVICE = 'provisioning';

type Json = Record<string, unknown>;

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

export function startProvisioning(): MqttClient {
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
    ca,
    cert,
    key,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
  };
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
      console.log(`[${SERVICE}] provision request received for uuid=${uuidFromTopic}`);
      const body = payload.length ? (JSON.parse(payload.toString()) as Json) : {};
      const hasBodyUuid = typeof (body as any).uuid === 'string';
      const bodyUuid = hasBodyUuid ? String((body as any).uuid) : undefined;
      const uuid = hasBodyUuid ? (bodyUuid as string) : uuidFromTopic;
      const csrPem = typeof (body as any).csrPem === 'string' ? String((body as any).csrPem) : undefined;
      if (hasBodyUuid && bodyUuid !== uuidFromTopic) {
        console.warn(`[${SERVICE}] uuid mismatch: topic=${uuidFromTopic} body=${bodyUuid}`);
        client.publish(TOPICS.rejected(uuidFromTopic), JSON.stringify({ error: 'uuid_mismatch', message: 'body.uuid must match topic UUID' }), { qos: 1 });
        return;
      }
      if (ENFORCE_WHITELIST) {
        if (!uuid) throw new Error('missing_uuid');
        const checkResult = checkUuid(uuid);
        if (!checkResult.ok) throw new Error(checkResult.error || 'uuid_not_whitelisted');
        console.log(`[${SERVICE}] whitelist ok for uuid=${uuid}`);
      }
      const token = typeof body.token === 'string' ? (body.token as string) : undefined;
      let meta = typeof body.meta === 'object' && body.meta ? (body.meta as Json) : undefined;
      // Persist UUID inside device meta so it is available to the admin UI
      if (uuid) {
        try {
          const existing = (meta && typeof meta === 'object') ? (meta as any) : {};
          meta = { ...existing, uuid } as Json;
        } catch {
          meta = { uuid } as Json;
        }
      }

      // Two round trips over the same provisioning connection, distinguished
      // by whether a CSR is present, so the device's UUID (a one-time claim
      // token) never becomes its ongoing MQTT/TLS identity:
      //   1) claim  - no csrPem: a *fresh* random name is assigned (fresh
      //      start - see claimDeviceName in devices-store.ts), replacing
      //      whatever was claimed for this uuid before.
      //   2) issue  - csrPem present, CN'd for that assigned name: reads
      //      back the name round 1 just assigned (does NOT claim a new one -
      //      claiming is a one-shot-per-session action, not idempotent) and
      //      the device's CSR must match it exactly, else the request is
      //      rejected as deviceId_mismatch.
      let deviceId: string;
      if (!csrPem) {
        const claim = claimDeviceName(uuid);
        if (!claim.ok || !claim.deviceId) {
          throw new Error(claim.error || 'claim_failed');
        }
        deviceId = claim.deviceId;
        console.log(`[${SERVICE}] claim accepted for uuid=${uuid} -> deviceId=${deviceId}`);
        client.publish(TOPICS.accepted(uuid), JSON.stringify({ deviceId }), { qos: 1 });
        return;
      }

      const resolved = resolveDeviceIdByUuid(uuid);
      if (!resolved.ok || !resolved.deviceId) {
        throw new Error(resolved.error || 'no_claim_in_progress');
      }
      deviceId = resolved.deviceId;

      const bodyDeviceId = typeof body.deviceId === 'string' ? (body.deviceId as string) : undefined;
      if (bodyDeviceId !== deviceId) {
        throw new Error('deviceId_mismatch');
      }

      issueDeviceCertFromCSR(uuid, deviceId, csrPem, CERT_DAYS)
        .then(async ({ certPem, caChainPem }) => {
          // Record this as the whitelist entry's most recent claim. This is
          // informational only (used_at is a "last claimed" timestamp, not
          // a one-shot lock - a whitelisted UUID must be able to
          // reprovision indefinitely, see whitelist-store.ts), so it only
          // throws on a genuine failure (DB unavailable, UUID not in the
          // whitelist table at all), never on "already used". The real
          // defense against two devices sharing one UUID is upstream of
          // here: only one MQTT connection can hold this UUID's client ID
          // at a time, and claimDeviceName's uuid PRIMARY KEY +
          // DELETE-then-INSERT transaction makes each claim a fresh start.
          if (ENFORCE_WHITELIST && uuid) {
            const markResult = markUsed(uuid);
            if (!markResult.ok) {
              throw new Error(markResult.error || 'mark_used_failed');
            }
            console.log(`[${SERVICE}] recorded claim for UUID: ${uuid}`);
          }

          // Register device in database after successful certificate issuance
          try {
            const metaJson = JSON.stringify(meta || {});
            const regRes = registerDevice(uuid, deviceId, token || '', metaJson);
            if (regRes.ok) {
              console.log(`[${SERVICE}] device registered: ${uuid} -> ${deviceId}`);
            } else {
              console.warn(`[${SERVICE}] device registration failed for ${uuid}: ${regRes.error}`);
            }
          } catch (regErr) {
            console.warn(`[${SERVICE}] device registration error for ${uuid}:`, regErr);
          }

          console.log(`[${SERVICE}] provision accepted for uuid=${uuid} -> deviceId=${deviceId}`);
          client.publish(TOPICS.accepted(uuid), JSON.stringify({ deviceId, certPem, caChainPem }), { qos: 1 });
        })
        .catch((err) => {
          console.error(`[${SERVICE}] provision issue_failed for uuid=${uuidFromTopic}:`, err?.message || err);
          client.publish(TOPICS.rejected(uuidFromTopic), JSON.stringify({ error: 'issue_failed', message: String(err?.message || err) }), { qos: 1 });
        });
    } catch (e) {
      console.error(`[${SERVICE}] error handling provision request`, e);
      client.publish(TOPICS.rejected(uuidFromTopic), JSON.stringify({ error: 'bad_request', message: (e as Error).message }), { qos: 1 });
    }
  });

  return client;
}
