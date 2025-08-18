import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// Simple virtual device that:
// 1) Connects to MQTT broker
// 2) Sends provisioning request to $devicehub/devices/{deviceId}/provision/request
// 3) On accepted, publishes periodic telemetry to devices/{deviceId}/telemetry

const MQTT_URL = process.env.MQTT_URL || 'mqtts://localhost:8883';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TLS_CA = process.env.MQTT_TLS_CA;
const MQTT_TLS_CERT = process.env.MQTT_TLS_CERT; // Claim cert for bootstrap, or device cert for runtime
const MQTT_TLS_KEY = process.env.MQTT_TLS_KEY;   // Claim key for bootstrap, or device key for runtime
const MQTT_TLS_REJECT_UNAUTHORIZED = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';
const DEVICE_ID = process.env.DEVICE_ID || `vd-${Math.random().toString(36).slice(2, 8)}`;
const TELEMETRY_PERIOD_MS = Number(process.env.TELEMETRY_PERIOD_MS || 3000);
const PROV_UUID = process.env.PROV_UUID || process.env.UUID;

// Optional override paths where we store generated device cert/key
const DEVICE_CERT_OUT = process.env.DEVICE_CERT_OUT || '';
const DEVICE_KEY_OUT = process.env.DEVICE_KEY_OUT || '';

function openssl(args: string[], input?: string): { code: number, out: string, err: string } {
  const res = spawnSync('openssl', args, { input, encoding: 'utf8' });
  return { code: res.status ?? 1, out: res.stdout || '', err: res.stderr || '' };
}

function genKeyAndCsr(deviceId: string): { keyPem: string; csrPem: string } {
  const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-vd-'));
  const keyPath = path.join(tmp, `${deviceId}.key`);
  const csrPath = path.join(tmp, `${deviceId}.csr`);
  let r = openssl(['genrsa', '-out', keyPath, '2048']);
  if (r.code !== 0) throw new Error(`openssl genrsa failed: ${r.err || r.out}`);
  r = openssl(['req', '-new', '-key', keyPath, '-subj', `/CN=${deviceId}`, '-out', csrPath]);
  if (r.code !== 0) throw new Error(`openssl req -new failed: ${r.err || r.out}`);
  const keyPem = readFileSync(keyPath, 'utf8');
  const csrPem = readFileSync(csrPath, 'utf8');
  return { keyPem, csrPem };
}

function writeIfPath(content: string, outPath?: string): string | undefined {
  if (!outPath) return undefined;
  writeFileSync(outPath, content);
  return outPath;
}

function start() {
  const ca = MQTT_TLS_CA ? readFileSync(MQTT_TLS_CA) : undefined;
  const cert = MQTT_TLS_CERT ? readFileSync(MQTT_TLS_CERT) : undefined;
  const key = MQTT_TLS_KEY ? readFileSync(MQTT_TLS_KEY) : undefined;

  const opts: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    protocolVersion: 5,
    reconnectPeriod: 2000,
    clean: true,
    ca,
    cert,
    key,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
  };
  const client: MqttClient = connect(MQTT_URL, opts);

  let provisioned = false;
  let telemetryTimer: NodeJS.Timeout | null = null;

  const provReqTopic = `$devicehub/devices/${DEVICE_ID}/provision/request`;
  const provAccTopic = `$devicehub/devices/${DEVICE_ID}/provision/accepted`;
  const provRejTopic = `$devicehub/devices/${DEVICE_ID}/provision/rejected`;

  client.on('connect', () => {
    console.log(`[virtual-device] connected → ${MQTT_URL} as ${DEVICE_ID}`);
    // Subscribe to provisioning responses and initiate CSR-based provisioning
    client.subscribe([provAccTopic, provRejTopic], { qos: 1 }, (err) => {
      if (err) console.error('[virtual-device] subscribe error', err);
      // Generate device key + CSR
      let keyPem: string; let csrPem: string;
      try {
        ({ keyPem, csrPem } = genKeyAndCsr(DEVICE_ID));
      } catch (e: any) {
        console.error('[virtual-device] CSR generation failed', e?.message || e);
        return;
      }
      // Optionally persist generated device key/cert later
      if (DEVICE_KEY_OUT) {
        writeIfPath(keyPem, DEVICE_KEY_OUT);
        console.log(`[virtual-device] wrote device key to ${DEVICE_KEY_OUT}`);
      }
      const provisionPayload: any = {
        csrPem,
        name: `Virtual Device ${DEVICE_ID}`,
        token: process.env.DEVICE_TOKEN || undefined,
        meta: { model: 'simulator', firmware: '0.0.1', startedAt: new Date().toISOString() },
      };
      if (PROV_UUID) provisionPayload.uuid = PROV_UUID;
      console.log(`[virtual-device] -> ${provReqTopic} payload: csrPem(len=${csrPem.length}) uuid=${PROV_UUID ? 'set' : 'unset'}`);
      client.publish(provReqTopic, JSON.stringify(provisionPayload), { qos: 1 });
    });
  });

  client.on('message', (topic, payload) => {
    if (topic === provAccTopic) {
      const msg = JSON.parse(payload.toString() || '{}');
      console.log(`[virtual-device] <- accepted: keys(certPem:${msg.certPem ? 'yes' : 'no'} caChainPem:${msg.caChainPem ? 'yes' : 'no'})`);
      if (provisioned) return;
      if (!msg.certPem) { console.error('[virtual-device] missing certPem in accepted payload'); return; }
      provisioned = true;
      // Persist cert if requested
      const certPath = DEVICE_CERT_OUT || path.join(tmpdir(), `${DEVICE_ID}.crt`);
      writeFileSync(certPath, msg.certPem);
      if (msg.caChainPem && MQTT_TLS_CA && !existsSync(MQTT_TLS_CA)) {
        // If a CA path was provided but file missing, optionally write it
        try { writeFileSync(MQTT_TLS_CA, msg.caChainPem); } catch {}
      }
      // End bootstrap session and start runtime session using device cert
      try { client.end(true); } catch {}
      startRuntime(certPath, DEVICE_KEY_OUT || undefined);
    } else if (topic === provRejTopic) {
      console.error(`[virtual-device] <- rejected: ${payload.toString()}`);
    }
  });

  client.on('error', (err) => {
    console.error('[virtual-device] error', err);
  });

  client.on('close', () => {
    console.log('[virtual-device] connection closed');
  });

  function shutdown() {
    console.log('[virtual-device] shutting down...');
    if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
    try { client.end(true, {}, () => process.exit(0)); } catch { process.exit(0); }
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function startRuntime(deviceCertPath?: string, deviceKeyPath?: string) {
  const ca = MQTT_TLS_CA ? readFileSync(MQTT_TLS_CA) : undefined;
  const cert = deviceCertPath ? readFileSync(deviceCertPath) : (MQTT_TLS_CERT ? readFileSync(MQTT_TLS_CERT) : undefined);
  const key = deviceKeyPath ? readFileSync(deviceKeyPath) : (MQTT_TLS_KEY ? readFileSync(MQTT_TLS_KEY) : undefined);
  const opts: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    protocolVersion: 5,
    reconnectPeriod: 3000,
    clean: true,
    ca,
    cert,
    key,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
  };
  const client: MqttClient = connect(MQTT_URL, opts);
  const teleTopic = `devices/${DEVICE_ID}/telemetry`;
  let timer: NodeJS.Timeout | null = null;

  client.on('connect', () => {
    console.log(`[virtual-device] runtime connected with device cert → ${MQTT_URL}`);
    timer = setInterval(() => {
      const m = { ts: Date.now(), temperature: 20 + Math.random() * 5, voltage: 3.3 + Math.random() * 0.1, status: 'ok' };
      client.publish(teleTopic, JSON.stringify(m), { qos: 0 });
      console.log(`[virtual-device] -> ${teleTopic} ${JSON.stringify(m)}`);
    }, TELEMETRY_PERIOD_MS);
  });

  function shutdown() {
    if (timer) { clearInterval(timer); timer = null; }
    try { client.end(true, {}, () => process.exit(0)); } catch { process.exit(0); }
  }
  client.on('error', (e) => console.error('[virtual-device] runtime error', e));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
