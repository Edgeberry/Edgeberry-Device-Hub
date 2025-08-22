import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import http from 'http';
import https from 'https';
import { URL as NodeUrl } from 'url';

// Simple virtual device that:
// 1) Connects to MQTT broker
// 2) Sends provisioning request to $devicehub/devices/{uuid}/provision/request (uuid is PROV_UUID)
// 3) On accepted, publishes periodic telemetry to devices/{deviceId}/telemetry (deviceId provided by server; defaults to uuid)

const MQTT_URL = process.env.MQTT_URL || 'mqtts://127.0.0.1:8883';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const CERTS_DIR = new URL('../certs/', import.meta.url).pathname;
const MQTT_TLS_CA = process.env.MQTT_TLS_CA || path.join(CERTS_DIR, 'ca.crt');
const MQTT_TLS_CERT = process.env.MQTT_TLS_CERT || path.join(CERTS_DIR, 'provisioning.crt'); // Claim cert for bootstrap, or device cert for runtime
const MQTT_TLS_KEY = process.env.MQTT_TLS_KEY || path.join(CERTS_DIR, 'provisioning.key');   // Claim key for bootstrap, or device key for runtime
const MQTT_TLS_REJECT_UNAUTHORIZED = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';
const MQTT_NO_CLIENT_CERT = (process.env.MQTT_NO_CLIENT_CERT ?? 'false').toLowerCase() === 'true';
const DEVICE_ID = process.env.DEVICE_ID || `vd-${Math.random().toString(36).slice(2, 8)}`;
const TELEMETRY_PERIOD_MS = Number(process.env.TELEMETRY_PERIOD_MS || 3000);
const PROV_UUID = process.env.PROV_UUID || process.env.UUID;
const PROV_API_BASE = process.env.PROV_API_BASE || '';
// Optional headers/cookie to access authenticated endpoints (e.g., provisioning cert/key)
// PROV_API_HEADERS may contain a JSON object string of headers, PROV_API_COOKIE sets Cookie header directly
const PROV_API_HEADERS = process.env.PROV_API_HEADERS || '';
const PROV_API_COOKIE = process.env.PROV_API_COOKIE || '';
const ALLOW_SELF_SIGNED: boolean = ((process.env.ALLOW_SELF_SIGNED ?? (PROV_API_BASE ? 'true' : 'false')) as string).toLowerCase() === 'true';

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

async function httpGetBuffer(urlStr: string, headers?: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new NodeUrl(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const options: any = { headers: headers || {} };
    const req = lib.get(u, options, (res) => {
      if ((res.statusCode || 0) >= 400) { reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`)); return; }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

async function fetchText(url: string, opts?: RequestInit): Promise<string> {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

// Fetch a provisioning file with fallback: try /api path first, on 401 retry alias without /api
async function fetchProvisioningFile(base: string, filename: 'ca.crt' | 'provisioning.crt' | 'provisioning.key'): Promise<string> {
  const primary = `${base.replace(/\/$/, '')}/api/provisioning/certs/${filename}`;
  const fallback = `${base.replace(/\/$/, '')}/provisioning/certs/${filename}`;
  try {
    const r = await fetch(primary, { credentials: 'include' as RequestCredentials });
    if (r.ok) return await r.text();
    if (r.status === 401) {
      const r2 = await fetch(fallback);
      if (r2.ok) return await r2.text();
      throw new Error(`HTTP ${r2.status} for ${fallback}`);
    }
    throw new Error(`HTTP ${r.status} for ${primary}`);
  } catch (e) {
    // last resort try fallback if network error occurred on primary
    try {
      const r2 = await fetch(fallback);
      if (r2.ok) return await r2.text();
      throw new Error(`HTTP ${r2.status} for ${fallback}`);
    } catch (e2) {
      throw e2;
    }
  }
}

async function loadBootstrapTls(): Promise<{ ca?: Buffer; cert?: Buffer; key?: Buffer }> {
  if (!PROV_API_BASE) return {};
  const base = PROV_API_BASE.replace(/\/$/, '');
  // Build headers from env
  let hdrs: Record<string, string> = {};
  if (PROV_API_HEADERS) {
    try { hdrs = { ...hdrs, ...JSON.parse(PROV_API_HEADERS) }; } catch {}
  }
  if (PROV_API_COOKIE) hdrs['Cookie'] = PROV_API_COOKIE;
  // 1) Fetch bootstrap provisioning certs (CA + provisioning client cert/key) with fallback aliases
  const caTxt = await fetchProvisioningFile(PROV_API_BASE, 'ca.crt');
  const certTxt = await fetchProvisioningFile(PROV_API_BASE, 'provisioning.crt');
  const keyTxt = await fetchProvisioningFile(PROV_API_BASE, 'provisioning.key');
  // Basic validation to avoid HTML fallback or proxy pages
  const isPem = (s: string) => /-----BEGIN [A-Z ]+-----/.test(s);
  if (!isPem(caTxt)) throw new Error('Invalid CA file received (not PEM)');
  if (!isPem(certTxt)) throw new Error('Invalid provisioning.crt received (not PEM)');
  if (!isPem(keyTxt)) throw new Error('Invalid provisioning.key received (not PEM)');
  return { ca: Buffer.from(caTxt), cert: Buffer.from(certTxt), key: Buffer.from(keyTxt) };
}

async function start() {
  const fetched = await loadBootstrapTls();
  const ca = fetched.ca || (MQTT_TLS_CA ? readFileSync(MQTT_TLS_CA) : undefined);
  // Use API-provided cert/key only if both are present and match; otherwise fall back to local pair
  let useApiPair = !!(fetched.cert && fetched.key);
  if (useApiPair) {
    try {
      const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-vd-pair-'));
      const cPath = path.join(tmp, 'api.crt');
      const kPath = path.join(tmp, 'api.key');
      writeFileSync(cPath, fetched.cert!);
      writeFileSync(kPath, fetched.key!);
      const modC = openssl(['x509', '-noout', '-modulus', '-in', cPath]);
      const modK = openssl(['rsa', '-noout', '-modulus', '-in', kPath]);
      if (modC.code !== 0 || modK.code !== 0 || modC.out.trim() !== modK.out.trim()) {
        console.warn('[virtual-device] WARNING: API cert/key do not match; falling back to file pair');
        useApiPair = false;
      }
    } catch { useApiPair = false; }
  }
  // Only load local cert/key if files actually exist; allow forcing no client cert via env
  let cert: Buffer | undefined;
  let key: Buffer | undefined;
  if (!MQTT_NO_CLIENT_CERT) {
    const certPath = useApiPair ? undefined : (MQTT_TLS_CERT || '');
    const keyPath = useApiPair ? undefined : (MQTT_TLS_KEY || '');
    cert = useApiPair ? fetched.cert : (certPath && existsSync(certPath) ? readFileSync(certPath) : undefined);
    key = useApiPair ? fetched.key : (keyPath && existsSync(keyPath) ? readFileSync(keyPath) : undefined);
  }
  console.log(`[virtual-device] TLS source: ca=${fetched.ca ? 'api' : (MQTT_TLS_CA ? 'file' : 'none')} certKey=${MQTT_NO_CLIENT_CERT ? 'none' : (useApiPair ? 'api' : ((cert && key) ? 'file' : 'none'))}`);

  const insecure = ALLOW_SELF_SIGNED || !ca;
  const buildOpts = (insecureFlag: boolean): IClientOptions => ({
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    protocolVersion: 5,
    reconnectPeriod: 2000,
    clean: true,
    // Use UUID as clientId during provisioning to satisfy brokers that scope ACLs by %c
    clientId: String(PROV_UUID),
    ca: insecureFlag ? undefined : ca,
    cert,
    key,
    rejectUnauthorized: insecureFlag ? false : MQTT_TLS_REJECT_UNAUTHORIZED,
  });

  // Require UUID for provisioning topic
  if (!PROV_UUID) {
    console.error('[virtual-device] ERROR: PROV_UUID is required for provisioning');
    process.exit(1);
  }

  const client: MqttClient = connect(MQTT_URL, buildOpts(insecure));

  let provisioned = false;
  let telemetryTimer: NodeJS.Timeout | null = null;

  // Use UUID for provisioning topics
  const provReqTopic = `$devicehub/devices/${PROV_UUID}/provision/request`;
  const provAccTopic = `$devicehub/devices/${PROV_UUID}/provision/accepted`;
  const provRejTopic = `$devicehub/devices/${PROV_UUID}/provision/rejected`;
  // Track the runtime device id (defaults to UUID until server overrides)
  let runtimeDeviceId = String(PROV_UUID);

  client.on('connect', () => {
    console.log(`[virtual-device] connected → ${MQTT_URL} clientId=${client.options.clientId}`);
    // Subscribe to provisioning responses and initiate CSR-based provisioning
    client.subscribe([provAccTopic, provRejTopic], { qos: 1 }, (err) => {
      if (err) console.error('[virtual-device] subscribe error', err);
      // Generate device key + CSR
      let keyPem: string; let csrPem: string;
      try {
        // Generate CSR with CN equal to UUID so issued device cert CN matches UUID
        ({ keyPem, csrPem } = genKeyAndCsr(String(PROV_UUID)));
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
        name: `Virtual Device ${runtimeDeviceId}`,
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
      // Update runtime device id from server response (expected to equal UUID)
      if (msg.deviceId && typeof msg.deviceId === 'string') {
        runtimeDeviceId = String(msg.deviceId);
      }
      // Persist cert if requested
      const certPath = DEVICE_CERT_OUT || path.join(tmpdir(), `${runtimeDeviceId}.crt`);
      writeFileSync(certPath, msg.certPem);
      if (msg.caChainPem && MQTT_TLS_CA && !existsSync(MQTT_TLS_CA)) {
        // If a CA path was provided but file missing, optionally write it
        try { writeFileSync(MQTT_TLS_CA, msg.caChainPem); } catch {}
      }
      // End bootstrap session and start runtime session using device cert
      try { client.end(true); } catch {}
      startRuntime(runtimeDeviceId, certPath, DEVICE_KEY_OUT || undefined);
    } else if (topic === provRejTopic) {
      console.error(`[virtual-device] <- rejected: ${payload.toString()}`);
    }
  });

  client.on('error', (err: any) => {
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

function startRuntime(deviceId: string, deviceCertPath?: string, deviceKeyPath?: string) {
  const ca = MQTT_TLS_CA ? readFileSync(MQTT_TLS_CA) : undefined;
  const cert = deviceCertPath ? readFileSync(deviceCertPath) : (MQTT_TLS_CERT ? readFileSync(MQTT_TLS_CERT) : undefined);
  const key = deviceKeyPath ? readFileSync(deviceKeyPath) : (MQTT_TLS_KEY ? readFileSync(MQTT_TLS_KEY) : undefined);
  const opts: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    protocolVersion: 5,
    reconnectPeriod: 3000,
    clean: true,
    // Use deviceId as clientId during runtime
    clientId: deviceId,
    ca,
    cert,
    key,
    rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
  };
  const client: MqttClient = connect(MQTT_URL, opts);
  const teleTopic = `devices/${deviceId}/telemetry`;
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

(async () => { await start(); })();
