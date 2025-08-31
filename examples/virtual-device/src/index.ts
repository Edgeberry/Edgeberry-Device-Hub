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

// Map MQTT CONNACK reason codes to human-readable text (MQTT v5 and MQTT v3.1.1)
function connackReasonText(code: number): string {
  const v5: Record<number, string> = {
    0: 'Success',
    128: 'Unspecified error',
    129: 'Malformed Packet',
    130: 'Protocol Error',
    131: 'Implementation specific error',
    132: 'Unsupported Protocol Version',
    133: 'Client Identifier not valid',
    134: 'Bad User Name or Password',
    135: 'Not authorized',
    136: 'Server unavailable',
    137: 'Server busy',
    138: 'Banned',
    140: 'Bad authentication method',
    149: 'Packet too large',
    151: 'Quota exceeded',
    153: 'Payload format invalid',
    156: 'Use another server',
    157: 'Server moved',
    159: 'Connection rate exceeded',
  };
  const v3: Record<number, string> = {
    0: 'Connection Accepted',
    1: 'Unacceptable protocol version',
    2: 'Identifier rejected',
    3: 'Server unavailable',
    4: 'Bad user name or password',
    5: 'Not authorized',
  };
  return v5[code] || v3[code] || `Unknown (${code})`;
}

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
  // Enforce fetching of provisioning TLS materials before provisioning flow
  if (!fetched.ca || !fetched.cert || !fetched.key) {
    console.error('[virtual-device] ERROR: provisioning TLS materials missing. Set PROV_API_BASE and ensure ca.crt, provisioning.crt, provisioning.key are accessible.');
    process.exit(1);
  }
  // Validate fetched cert/key pair match
  try {
    const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-vd-pair-'));
    const cPath = path.join(tmp, 'api.crt');
    const kPath = path.join(tmp, 'api.key');
    writeFileSync(cPath, fetched.cert);
    writeFileSync(kPath, fetched.key);
    const modC = openssl(['x509', '-noout', '-modulus', '-in', cPath]);
    const modK = openssl(['rsa', '-noout', '-modulus', '-in', kPath]);
    if (modC.code !== 0 || modK.code !== 0 || modC.out.trim() !== modK.out.trim()) {
      console.error('[virtual-device] ERROR: fetched provisioning cert/key do not match');
      process.exit(1);
    }
  } catch (e) {
    console.error('[virtual-device] ERROR: failed to validate provisioning cert/key pair', (e as Error)?.message || e);
    process.exit(1);
  }
  const ca = fetched.ca;
  const cert: Buffer | undefined = fetched.cert;
  const key: Buffer | undefined = fetched.key;
  console.log('[virtual-device] TLS source: ca=api certKey=api');

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
    console.log(`[virtual-device] CONNECT accepted → ${MQTT_URL} clientId=${client.options.clientId}`);
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
      
      // Save device key to temporary file for runtime use
      const keyPath = DEVICE_KEY_OUT || path.join(tmpdir(), `${String(PROV_UUID)}.key`);
      writeFileSync(keyPath, keyPem);
      console.log(`[virtual-device] saved device key to ${keyPath}`);
      
      // Store the key path for later use in runtime
      (client as any)._deviceKeyPath = keyPath;
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
      
      // Save CA chain to a temporary file for runtime use
      let caPath: string | undefined;
      if (msg.caChainPem) {
        caPath = path.join(tmpdir(), `${runtimeDeviceId}-ca.crt`);
        writeFileSync(caPath, msg.caChainPem);
        console.log(`[virtual-device] saved CA chain to ${caPath}`);
      }
      
      // End bootstrap session and start runtime session using device cert
      const deviceKeyPath = (client as any)._deviceKeyPath;
      try { client.end(true); } catch {}
      startRuntime(runtimeDeviceId, certPath, deviceKeyPath, caPath);
    } else if (topic === provRejTopic) {
      console.error(`[virtual-device] <- rejected: ${payload.toString()}`);
    }
  });

  client.on('error', (err: any) => {
    console.error('[virtual-device] CONNECT rejected/error', err?.message || err);
  });

  client.on('close', () => {
    console.log('[virtual-device] connection closed');
  });

  // Inspect CONNACK to explicitly log accept/reject with reason code (MQTT v5)
  client.on('packetreceive', (packet: any) => {
    if (packet && packet.cmd === 'connack') {
      const reason = typeof packet.reasonCode !== 'undefined' ? packet.reasonCode : packet.returnCode;
      const sp = packet.sessionPresent;
      if (reason === 0) {
        console.log(`[virtual-device] CONNACK accepted (reasonCode=0 ${connackReasonText(0)}, sessionPresent=${sp})`);
      } else {
        console.error(`[virtual-device] CONNACK rejected (reasonCode=${reason} ${connackReasonText(reason)}, sessionPresent=${sp})`);
      }
    }
  });

  function shutdown() {
    console.log('[virtual-device] shutting down...');
    if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
    try { client.end(true, {}, () => process.exit(0)); } catch { process.exit(0); }
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function startRuntime(deviceId: string, deviceCertPath?: string, deviceKeyPath?: string, caPath?: string) {
  const ca = caPath ? readFileSync(caPath) : (MQTT_TLS_CA && existsSync(MQTT_TLS_CA) ? readFileSync(MQTT_TLS_CA) : undefined);
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

  // Connect to MQTT for runtime operations with Last Will and Testament
  const runtimeClient = connect(MQTT_URL, {
    clientId: deviceId,
    will: {
      topic: `$devicehub/devices/${deviceId}/status`,
      payload: JSON.stringify({ status: 'offline', ts: Date.now() }),
      qos: 1,
      retain: true
    },
    ...tlsOptions,
  });

  runtimeClient.on('connect', () => {
    console.log(`[virtual-device] runtime CONNACK accepted with device cert → ${MQTT_URL}`);
    
    // Publish online status immediately upon connection
    const onlinePayload = { status: 'online', ts: Date.now() };
    runtimeClient.publish(`$devicehub/devices/${deviceId}/status`, JSON.stringify(onlinePayload), { qos: 1, retain: true });
    console.log(`[virtual-device] -> $devicehub/devices/${deviceId}/status`, onlinePayload);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('[virtual-device] shutting down...');
      // Publish offline status before disconnecting
      const offlinePayload = { status: 'offline', ts: Date.now() };
      runtimeClient.publish(`$devicehub/devices/${deviceId}/status`, JSON.stringify(offlinePayload), { qos: 1, retain: true }, () => {
        runtimeClient.end();
        process.exit(0);
      });
    });
  });

  // Inspect CONNACK for runtime session too
  runtimeClient.on('packetreceive', (packet: any) => {
    if (packet && packet.cmd === 'connack') {
      const reason = typeof packet.reasonCode !== 'undefined' ? packet.reasonCode : packet.returnCode;
      const sp = packet.sessionPresent;
      if (reason === 0) {
        console.log(`[virtual-device] runtime CONNACK accepted (reasonCode=0 ${connackReasonText(0)}, sessionPresent=${sp})`);
      } else {
        console.error(`[virtual-device] runtime CONNACK rejected (reasonCode=${reason} ${connackReasonText(reason)}, sessionPresent=${sp})`);
      }
    }
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
