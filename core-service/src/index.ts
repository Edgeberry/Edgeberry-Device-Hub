/**
 * Edgeberry Device Hub — core-service
 * ---------------------------------------------
 * Purpose
 * - Public entrypoint. Serves the SPA and exposes all public HTTP(S) APIs and WebSocket.
 *
 * Responsibilities
 * - Serve SPA assets and implement `/api/*` endpoints (health, auth, settings/certs, services, devices, logs, metrics).
 * - Single-user admin auth with JWT in HttpOnly cookie `fh_session`.
 * - Apply strict no-cache headers on `/api/*` to avoid stale auth/UI state.
 * - Manage Root CA/provisioning certs and offer downloads (PEM and provisioning bundle `.tgz`).
 * - Provide WebSocket endpoint `/api/ws` for metrics/services/devices/logs streaming.
 *
 * Environment & Dependencies
 * - PORT: HTTP port (dev default 8080; prod may be 80/443 behind TLS terminator).
 * - ADMIN_USER, ADMIN_PASSWORD: single admin credentials (MUST set strong password in prod).
 * - JWT_SECRET, JWT_TTL_SECONDS: JWT signing (HS256) and expiration (default 86400s).
 * - CERTS_DIR: base dir for certs data; contains `root/ca.key|ca.crt` and `provisioning/*.crt|*.key`.
 * - UI_DIST: path to built SPA directory served in production.
 * - MQTT_URL: included in provisioning bundle config for device convenience.
 * - PROVISIONING_DB, REGISTRY_DB: SQLite files for devices list and events snapshot.
 * - ONLINE_THRESHOLD_SECONDS: window to consider device "online" from last seen event.
 * - External tools: `tar` (for bundle creation), `systemctl` and `journalctl` for services/logs.
 *
 * Operational Notes
 * - ETag disabled to prevent 304 on auth state; explicit no-store headers for `/api/*`.
 * - SQLite opened read-only per request scope; WAL expected; errors degrade gracefully.
 * - WS topic model: client subscribes to named topics; server pushes snapshots and increments.
 * - Service control endpoints are best-effort and may require host privileges.
 * - Shutdown handled by Node process signals; HTTP and WS share the same server instance.
 *
 * Security Notes
 * - Never log secrets. Cookies are HttpOnly and SameSite=Lax; set `Secure` on HTTPS.
 * - Root CA operations are local-only; ensure filesystem permissions on `CERTS_DIR`.
 * - Logs streaming validates unit names; only whitelisted units are allowed.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import morgan from 'morgan';
import serveStatic from 'serve-static';
import { connect, type MqttClient, type IClientOptions } from 'mqtt';
import {
  SERVICE,
  PORT,
  ADMIN_USER,
  ADMIN_PASSWORD,
  SESSION_COOKIE,
  JWT_SECRET,
  JWT_TTL_SECONDS,
  UI_DIST,
  CERTS_DIR,
  ROOT_DIR,
  PROV_DIR,
  CA_KEY,
  CA_CRT,
  DEVICEHUB_DB,
  REGISTRY_DB,
  PROVISIONING_DB,
  ONLINE_THRESHOLD_SECONDS,
  DEFAULT_LOG_UNITS,
  PROVISIONING_CERT_PATH,
  PROVISIONING_KEY_PATH,
  PROVISIONING_HTTP_ENABLE_CERT_API,
  MQTT_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TLS_CA,
  MQTT_TLS_CERT,
  MQTT_TLS_KEY,
  MQTT_TLS_REJECT_UNAUTHORIZED,
} from './config.js';
import { ensureDirs, caExists, generateRootCA, readCertMeta, generateProvisioningCert } from './certs.js';
import { buildJournalctlArgs } from './logs.js';
import { authRequired, clearSessionCookie, getSession, parseCookies, setSessionCookie } from './auth.js';
import { startWhitelistDbusServer } from './dbus-whitelist.js';
import { startCertificateDbusServer } from './dbus-certs.js';
import { startCoreTwinDbusServer, setBroadcastFunction } from './dbus-twin.js';
import { startDevicesDbusServer } from './dbus-devices.js';
import { twinGetTwin } from './dbus-twin-client.js';

// Function to get hardware UUID from device tree
function getHardwareUUID(): string | null {
  try {
    const uuid = fs.readFileSync('/proc/device-tree/hat/uuid', 'utf8').replace(/\0.*$/g, '');
    return uuid.trim();
  } catch (err) {
    console.warn(`[${SERVICE}] Could not read hardware UUID from /proc/device-tree/hat/uuid:`, err);
    return null;
  }
}

// MQTT client for direct method forwarding
let mqttClient: MqttClient | null = null;

function initMqttClient(): void {
  const hardwareUUID = getHardwareUUID();
  const clientId = hardwareUUID || `devicehub-${Math.random().toString(36).substring(2, 15)}`;
  
  const options: IClientOptions = {
    clientId,
    reconnectPeriod: 2000,
  };

  console.log(`[${SERVICE}] MQTT connecting to: ${MQTT_URL} with client_id: ${clientId}`);
  if (hardwareUUID) {
    console.log(`[${SERVICE}] Using hardware UUID as MQTT client_id: ${hardwareUUID}`);
  } else {
    console.warn(`[${SERVICE}] Hardware UUID not available, using random client_id: ${clientId}`);
  }

  mqttClient = connect(MQTT_URL, options);

  mqttClient.on('connect', () => {
    console.log(`[${SERVICE}] MQTT connected for direct method forwarding`);
  });

  mqttClient.on('error', (err) => {
    console.error(`[${SERVICE}] MQTT error:`, err);
  });

  mqttClient.on('close', () => {
    console.warn(`[${SERVICE}] MQTT connection closed`);
  });

  mqttClient.on('reconnect', () => {
    console.log(`[${SERVICE}] MQTT reconnecting...`);
  });
}

async function sendDirectMethod(deviceId: string, methodName: string, payload: any = {}): Promise<boolean> {
  if (!mqttClient || !mqttClient.connected) {
    console.error(`[${SERVICE}] MQTT client not connected, cannot send direct method`);
    return false;
  }

  const topic = `$devicehub/devices/${deviceId}/methods/post`;
  const message = {
    name: methodName,
    payload: payload,
    timestamp: new Date().toISOString(),
    requestId: Math.random().toString(36).substring(2, 15)
  };

  console.log(`[${SERVICE}] Sending direct method to topic: ${topic}`);
  console.log(`[${SERVICE}] Message:`, JSON.stringify(message, null, 2));

  try {
    await new Promise<void>((resolve, reject) => {
      mqttClient!.publish(topic, JSON.stringify(message), { qos: 0 }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    
    console.log(`[${SERVICE}] Direct method '${methodName}' sent to device ${deviceId}`);
    return true;
  } catch (error) {
    console.error(`[${SERVICE}] Failed to send direct method '${methodName}' to device ${deviceId}:`, error);
    return false;
  }
}

const app = express();
// Disable ETag so API responses (e.g., /api/auth/me) aren't served as 304 Not Modified
app.set('etag', false);
// PORT now comes from src/config.ts
// Environment variables overview (MVP):
// - PORT: HTTP port (defaults 8080 dev, 80 prod)
// - MQTT_URL: used for bundle config exposure
// - CERTS_DIR: where to store Root CA and provisioning certs (default: ./data/certs)
// - UI_DIST: path to built SPA (default: /opt/Edgeberry/devicehub/ui/build)
// - ADMIN_USER / ADMIN_PASSWORD: single-user admin credentials (dev defaults; MUST change in prod)
// - JWT_SECRET / JWT_TTL_SECONDS: cookie token signing and expiration

// Disable all colors globally to prevent ANSI escape codes in logs
process.env.NO_COLOR = '1';
process.env.FORCE_COLOR = '0';

// Configure morgan logging - use 'combined' format without colors to avoid ANSI escape codes in logs
app.use(morgan('combined'));
// Ensure API responses are not cached (avoid 304 for JSON endpoints)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

// ===== Merged Provisioning HTTP API (migrated from provisioning-service) =====
// GET /api/provisioning/health -> simple health check
app.get('/api/provisioning/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// GET /api/provisioning/certs/ca.crt -> download Root CA certificate (PEM)
app.get('/api/provisioning/certs/ca.crt', async (_req: Request, res: Response) => {
  try {
    console.log('[core-service] HIT /api/provisioning/certs/ca.crt');
    if (!(await caExists())) { res.status(404).end('not found'); return; }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="ca.crt"');
    const s = fs.createReadStream(CA_CRT);
    s.on('error', () => res.status(500).end());
    s.pipe(res);
  } catch {
    res.status(500).end('server error');
  }
});

// GET /api/provisioning/certs/provisioning.crt -> serve provisioning client cert (MVP: public)
app.get('/api/provisioning/certs/provisioning.crt', async (_req: Request, res: Response) => {
  try {
    console.log('[core-service] HIT /api/provisioning/certs/provisioning.crt');
    const provisioningCertPath = path.join(PROV_DIR, 'provisioning.crt');
    if (!fs.existsSync(provisioningCertPath)) { res.status(404).end('not found'); return; }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="provisioning.crt"');
    const certContent = fs.readFileSync(provisioningCertPath, 'utf8');
    res.send(certContent);
  } catch (err) {
    console.error('[core-service] Error serving provisioning cert:', err);
    res.status(500).end('server error');
  }
});

// NOTE: Public alias without /api removed (policy: all API under /api)

// GET /api/provisioning/certs/provisioning.key -> serve provisioning client key (MVP: public)
app.get('/api/provisioning/certs/provisioning.key', async (_req: Request, res: Response) => {
  try {
    console.log('[core-service] HIT /api/provisioning/certs/provisioning.key');
    const provisioningKeyPath = path.join(PROV_DIR, 'provisioning.key');
    if (!fs.existsSync(provisioningKeyPath)) { res.status(404).end('not found'); return; }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="provisioning.key"');
    const keyContent = fs.readFileSync(provisioningKeyPath, 'utf8');
    res.send(keyContent);
  } catch (err) {
    console.error('[core-service] Error serving provisioning key:', err);
    res.status(500).end('server error');
  }
});

// NOTE: Public alias without /api removed (policy: all API under /api)
// Serve static UI (built by Vite into UI_DIST). Place this before defining the
// catch-all so that /api/* routes remain handled by API handlers above.
try {
  if (fs.existsSync(UI_DIST)) {
    // Log which UI directory will be served and basic index.html info to aid deployments
    try {
      console.log('[core-service] UI_DIST:', UI_DIST);
      const uiIndexPath = path.join(UI_DIST, 'index.html');
      const st = fs.statSync(uiIndexPath);
      console.log('[core-service] UI index.html:', uiIndexPath, 'mtime=', st.mtime.toISOString(), 'size=', st.size);
    } catch {
      console.log('[core-service] UI index.html not found under UI_DIST:', path.join(UI_DIST, 'index.html'));
    }
    // Long-cache assets folder (Vite hashed filenames)
    app.use('/assets', express.static(path.join(UI_DIST, 'assets'), {
      setHeaders: (res: Response) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    } as any));
    // Other static files at UI root
    app.use(express.static(UI_DIST, {
      setHeaders: (res: Response, file: string) => {
        // Do not cache index.html to ensure new deployments are picked up
        if (file.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      }
    } as any));
    // SPA fallback: send index.html for non-API and non-provisioning GETs
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/provisioning/')) return next();
      const indexPath = path.join(UI_DIST, 'index.html');
      if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
      return res.status(404).send('UI not found');
    });
  }
} catch {}

// GET /api/settings/certs/root/download -> download Root CA certificate (PEM)
app.get('/api/settings/certs/root/download', authRequired, async (_req: Request, res: Response) => {
  try {
    if (!(await caExists())) { res.status(404).json({ error: 'root CA not found' }); return; }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="ca.crt"');
    const s = fs.createReadStream(CA_CRT);
    s.on('error', () => res.status(500).end());
    s.pipe(res);
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'failed to download root cert' });
  }
});

// GET /api/settings/certs/provisioning/:name/download -> tar.gz bundle for device
app.get('/api/settings/certs/provisioning/:name/download', authRequired, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) { res.status(400).json({ error: 'invalid name' }); return; }
    ensureDirs();
    const crtPath = path.join(PROV_DIR, `${name}.crt`);
    const keyPath = path.join(PROV_DIR, `${name}.key`);
    if (!fs.existsSync(crtPath) || !fs.existsSync(keyPath)) { res.status(404).json({ error: 'certificate not found' }); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-bundle-'));
    const bundleDir = path.join(tmpDir, `provisioning-${name}`);
    fs.mkdirSync(bundleDir);

    // Copy files into bundle directory with friendly names
    const caOut = path.join(bundleDir, 'ca.crt');
    const certOut = path.join(bundleDir, `${name}.crt`);
    const keyOut = path.join(bundleDir, `${name}.key`);
    fs.copyFileSync(CA_CRT, caOut);
    fs.copyFileSync(crtPath, certOut);
    fs.copyFileSync(keyPath, keyOut);

    const cfg = { caCert: 'ca.crt', cert: `${name}.crt`, key: `${name}.key` };
    fs.writeFileSync(path.join(bundleDir, 'config.json'), JSON.stringify(cfg, null, 2));

    // Stream tar.gz
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="provisioning-bundle-${name}.tgz"`);
    const tar = spawn('tar', ['-czf', '-', '-C', tmpDir, path.basename(bundleDir)]);
    tar.stdout.pipe(res);
    tar.stderr.on('data', () => {});
    tar.on('close', () => {
      // Cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'failed to create bundle' });
  }
});
// Apply CORS only to HTTP requests, not WebSocket upgrades
app.use((req: Request, res: Response, next: NextFunction) => {
  // Skip CORS for WebSocket upgrade requests
  if (req.headers.upgrade?.toLowerCase() === 'websocket') {
    return next();
  }
  // Apply CORS to regular HTTP requests - simple implementation
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
app.use(express.json({ limit: '1mb' }));
app.get('/healthz', (_req: Request, res: Response) => res.json({ status: 'ok' }));

// Core-service owns the public HTTP(S) surface: define API routes here.
// GET /api/health
app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

// GET /api/devices/:uuid/twin -> fetch twin from Twin service via D-Bus
app.get('/api/devices/:uuid/twin', authRequired, async (req: Request, res: Response) => {
  try {
    const deviceUuid = String(req.params.uuid || '').trim();
    if (!deviceUuid) { res.status(400).json({ error: 'invalid device uuid' }); return; }
    const [desiredJson, desiredVersion, reportedJson, err] = await twinGetTwin(deviceUuid);
    if (err) { res.status(502).json({ error: 'twin_error', detail: err }); return; }
    res.json({
      deviceUuid,
      desired: { version: desiredVersion >>> 0, doc: desiredJson ? JSON.parse(desiredJson) : {} },
      reported: { doc: reportedJson ? JSON.parse(reportedJson) : {} }
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to fetch twin' });
  }
});

// GET /api/config/public -> public configuration and environment info
app.get('/api/config/public', async (_req: Request, res: Response) => {
  try {
    // Helpers for robust OS + model detection
    const safeRead = (p: string) => {
      try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
    };
    const parseOsRelease = (): Record<string,string> => {
      const txt = safeRead('/etc/os-release');
      const out: Record<string,string> = {};
      if (!txt) return out;
      for (const line of txt.split(/\r?\n/)){
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if(!m) continue;
        const k = m[1];
        let v = m[2];
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1);
        out[k] = v;
      }
      return out;
    };
    const detectOsDistribution = (): string => {
      if (process.platform !== 'linux') return `${os.type()} ${os.release()}`;
      const rel = parseOsRelease();
      if (rel.PRETTY_NAME) return rel.PRETTY_NAME;
      const nameVer = [rel.NAME, rel.VERSION].filter(Boolean).join(' ');
      if (nameVer) return nameVer;
      // Raspberry Pi OS special cases
      if (rel.ID === 'raspbian' || /raspberry/i.test(rel.NAME||'')){
        const codename = rel.VERSION_CODENAME ? ` (${rel.VERSION_CODENAME})` : '';
        const vid = rel.VERSION_ID ? ` ${rel.VERSION_ID}` : '';
        return `Raspberry Pi OS${vid}${codename}`.trim();
      }
      // Other fallbacks
      const rpiIssue = safeRead('/etc/rpi-issue').split(/\r?\n/)[0]?.trim();
      if (rpiIssue) return rpiIssue;
      const issue = safeRead('/etc/issue').split(/\r?\n/)[0]?.trim();
      if (issue) return issue;
      return `${os.type()} ${os.release()}`;
    };
    const detectDeviceModel = (): string => {
      if (process.platform !== 'linux') return '';
      const candidates = [
        '/proc/device-tree/model',
        '/sys/firmware/devicetree/base/model',
      ];
      for (const p of candidates){
        if (fs.existsSync(p)){
          const v = safeRead(p).replace(/\u0000/g, '').trim();
          if (v) return v;
        }
      }
      const cpuinfo = safeRead('/proc/cpuinfo');
      const m = cpuinfo.match(/^Model\s*:\s*(.+)$/mi);
      if (m) return m[1].trim();
      return '';
    };

    const osDistribution = detectOsDistribution();
    const deviceModel = detectDeviceModel();

    const config = {
      environment: `Node.js ${process.version}`,
      platform: osDistribution,
      systemInfo: `${osDistribution} ${os.arch()}`,
      arch: os.arch(),
      hostname: os.hostname(),
      deviceModel: deviceModel || undefined,
      nodeVersion: process.version,
      nodeArch: process.arch,
      nodePlatform: process.platform,
      osType: os.type(),
      osRelease: os.release(),
      osDistribution,
      env: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()),
      pid: process.pid
    };
    res.json(config);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to get config' });
  }
});

// GET /api/status -> system status info  
app.get('/api/status', (_req: Request, res: Response) => {
  try {
    const status = {
      uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
      uptimeSeconds: Math.floor(os.uptime()),
      processUptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
      processUptimeSeconds: Math.floor(process.uptime()),
      loadAverage: os.loadavg(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem()
    };
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to get status' });
  }
});

// Helper function to get Mosquitto version
async function getMosquittoVersion(): Promise<string> {
  try {
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
      exec('mosquitto -h', (error, stdout, stderr) => {
        if (error) return resolve('unknown');
        // Mosquitto outputs version in the first line of stderr
        const versionMatch = stderr.trim().split('\n')[0].match(/mosquitto version (\d+\.\d+\.\d+)/i);
        resolve(versionMatch ? versionMatch[1] : 'unknown');
      });
    });
  } catch {
    return 'unknown';
  }
}

// Helper function to get D-Bus version
async function getDBusVersion(): Promise<string> {
  try {
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
      exec('dbus-daemon --version', (error, stdout) => {
        if (error) return resolve('unknown');
        // D-Bus outputs version like: D-Bus Message Bus Daemon 1.12.20
        const versionMatch = stdout.match(/D-Bus.*?(\d+\.\d+\.\d+)/i);
        resolve(versionMatch ? versionMatch[1] : 'unknown');
      });
    });
  } catch {
    return 'unknown';
  }
}

// GET /api/version -> service version info
app.get('/api/version', async (_req: Request, res: Response) => {
  try {
    // Try to read version from package.json
    let version = 'unknown';
    let name = 'Device Hub';
    try {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        version = pkg.version || version;
        name = pkg.name || name;
      }
    } catch {}
    
    // Get system component versions
    const [mosquittoVersion, dbusVersion] = await Promise.all([
      getMosquittoVersion(),
      getDBusVersion()
    ]);
    
    const versionInfo = {
      service: name,
      version,
      name,
      git: version, // alias for compatibility
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      components: {
        mosquitto: mosquittoVersion,
        dbus: dbusVersion
      }
    };
    res.json(versionInfo);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to get version' });
  }
});

// === Diagnostics: device-side MQTT sanity test ===
// POST /api/diagnostics/mqtt-test
// Body: { deviceId?, mqttUrl?, ca?, cert?, key?, rejectUnauthorized?, timeoutSec? }
// Runs scripts/device_mqtt_test.sh and returns stdout/stderr and exit code
app.post('/api/diagnostics/mqtt-test', authRequired, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (body.deviceId) env.DEVICE_ID = String(body.deviceId);
    if (body.mqttUrl) env.MQTT_URL = String(body.mqttUrl);
    if (body.ca) env.MQTT_TLS_CA = String(body.ca);
    if (body.cert) env.MQTT_TLS_CERT = String(body.cert);
    if (body.key) env.MQTT_TLS_KEY = String(body.key);
    if (typeof body.rejectUnauthorized === 'boolean') env.MQTT_TLS_REJECT_UNAUTHORIZED = body.rejectUnauthorized ? 'true' : 'false';
    if (body.timeoutSec) env.TIMEOUT_SEC = String(body.timeoutSec);

    // Resolve diagnostics script path robustly.
    // Priority:
    // 1) DIAG_SCRIPT_PATH env
    // 2) Repo dev path: ../scripts/device_mqtt_test.sh (relative to core-service cwd)
    // 3) Repo dev alt: ../../scripts/device_mqtt_test.sh (in case cwd differs)
    // 4) Installed path: /opt/Edgeberry/devicehub/scripts/device_mqtt_test.sh
    const candidates: string[] = [];
    if (process.env.DIAG_SCRIPT_PATH) candidates.push(String(process.env.DIAG_SCRIPT_PATH));
    candidates.push(
      path.resolve(process.cwd(), '..', 'scripts', 'device_mqtt_test.sh'),
      path.resolve(process.cwd(), '..', '..', 'scripts', 'device_mqtt_test.sh'),
      '/opt/Edgeberry/devicehub/scripts/device_mqtt_test.sh',
    );
    const scriptPath = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
    if (!scriptPath) {
      return res.status(500).json({ ok: false, error: 'device_mqtt_test.sh not found', tried: candidates });
    }
    const startedAt = Date.now();
    const proc = spawn('bash', [scriptPath], { env });
    let stdout = '';
    let stderr = '';
    let responded = false;
    const TIMEOUT_MS = Math.max(5_000, Math.min(120_000, Number((body && body.timeoutSec ? body.timeoutSec : 30)) * 1000));
    const killTimer = setTimeout(() => {
      if (responded) return;
      responded = true;
      try { proc.kill('SIGKILL'); } catch {}
      res.status(504).json({ ok: false, error: 'diagnostics timed out', startedAt, durationMs: Date.now() - startedAt, stdout, stderr });
    }, TIMEOUT_MS);

    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('error', (e) => {
      if (responded) return;
      responded = true;
      clearTimeout(killTimer);
      res.status(500).json({ ok: false, error: String(e), startedAt, durationMs: Date.now() - startedAt });
    });
    proc.on('close', (code) => {
      if (responded) return;
      responded = true;
      clearTimeout(killTimer);
      const ok = code === 0;
      res.status(ok ? 200 : 500).json({ ok, exitCode: code, startedAt, durationMs: Date.now() - startedAt, stdout, stderr });
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'failed to run diagnostics' });
  }
});

// Minimal diagnostics UI (independent of SPA) at /diagnostics
app.get('/diagnostics', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Edgeberry Device Hub — Diagnostics</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;margin:24px;}
      input,button{font-size:14px;padding:6px 8px;margin:4px 0}
      label{display:block;margin-top:8px}
      .row{display:flex;gap:8px;flex-wrap:wrap}
      textarea{width:100%;height:280px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace}
      .muted{color:#666}
      .ok{color:#0a0}
      .fail{color:#a00}
    </style>
  </head>
  <body>
    <h2>Diagnostics: MQTT Sanity Test</h2>
    <div class="muted">Runs device-side MQTT tests via mTLS (provisioning, twin, telemetry).</div>
    <div>
      <label>Device ID (CN) <input id="deviceId" placeholder="leave empty to infer from cert" /></label>
      <label>MQTT URL <input id="mqttUrl" value="mqtts://localhost:8883" /></label>
      <div class="row">
        <label>CA <input id="ca" value="/etc/mosquitto/certs/ca.crt" size="40"/></label>
        <label>Cert <input id="cert" value="/opt/Edgeberry/devicehub/config/certs/my-device.crt" size="40"/></label>
        <label>Key <input id="key" value="/opt/Edgeberry/devicehub/config/certs/my-device.key" size="40"/></label>
      </div>
      <div class="row">
        <label>Reject unauthorized
          <select id="reject">
            <option value="true" selected>true</option>
            <option value="false">false</option>
          </select>
        </label>
        <label>Timeout (sec) <input id="timeout" type="number" value="10" style="width:80px"/></label>
      </div>
      <button id="run">Run Test</button>
      <span id="status" class="muted"></span>
    </div>
    <h3>Result</h3>
    <div id="summary"></div>
    <textarea id="output" readonly></textarea>
    <script>
      const el = (id) => document.getElementById(id);
      el('run').onclick = async () => {
        el('status').textContent = 'Running...';
        el('summary').innerHTML = '';
        el('output').value = '';
        const body = {
          deviceId: el('deviceId').value || undefined,
          mqttUrl: el('mqttUrl').value || undefined,
          ca: el('ca').value || undefined,
          cert: el('cert').value || undefined,
          key: el('key').value || undefined,
          rejectUnauthorized: el('reject').value === 'true',
          timeoutSec: Number(el('timeout').value || '10')
        };
        try{
          const r = await fetch('/api/diagnostics/mqtt-test', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
          const data = await r.json();
          el('status').textContent = '';
          const ok = !!data.ok;
          const cls = ok ? 'ok' : 'fail';
          const exitCode = (data.exitCode ?? 'n/a');
          const dur = (data.durationMs ?? '?');
          el('summary').innerHTML = '<div class="' + cls + '">' + (ok ? 'OK' : 'FAIL') + ' — exit ' + exitCode + ' — ' + dur + ' ms</div>';
          el('output').value = 'STDOUT\n' + (data.stdout || '') + '\n\nSTDERR\n' + (data.stderr || '');
        }catch(e){
          el('status').textContent = '';
          el('summary').innerHTML = '<div class="fail">Request failed</div>';
          el('output').value = String(e);
        }
      };
    </script>
  </body>
</html>`);
});

// Log a startup hello from core-service
console.log('[core-service] hello from Device Hub core-service');
// Ensure provisioning DB schema exists (uuid_whitelist etc.) before exposing D-Bus API
try { 
  ensureDeviceHubSchema(); 
} catch (error) {
  console.error('[core-service] Failed to initialize database schema:', error);
}
// Start D-Bus services
await startDbusServices();

// Device connection tracking is handled by twin service via MQTT
// Unified logs: snapshot and streaming from systemd journal (journalctl)
// Services are expected to be systemd units like devicehub-*.service
// DEFAULT_LOG_UNITS now imported from src/logs.ts

// ... (rest of the code remains the same)
// buildJournalctlArgs moved to src/logs.ts

// ===== Simple single-user admin authentication using JWT =====
// The UI authenticates via `/api/auth/login` which sets an HttpOnly cookie (`fh_session`).
// We do not track server-side sessions; JWT is verified on each request.
// Auth/JWT config now imported from src/config.ts


// Auth routes (no registration)
// POST /api/auth/login
// Authenticate admin user and set JWT session cookie
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ user: ADMIN_USER }, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_TTL_SECONDS, subject: ADMIN_USER });
    setSessionCookie(res, token);
    res.json({ ok: true, user: ADMIN_USER });
  } else {
    res.status(401).json({ ok: false, error: 'invalid credentials' });
  }
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  // With JWT, we clear the cookie; server does not need to track state
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me -> verify cookie and report authentication status
app.get('/api/auth/me', (req: Request, res: Response) => {
  const s = getSession(req);
  if (!s) { res.status(401).json({ authenticated: false }); return; }
  res.json({ authenticated: true, user: s.user });
});

// Middleware moved to src/auth.ts
// Note: authRequired is now applied per-route instead of globally to avoid blocking WebSocket upgrades

// ===== Devices & Events (read-only MVP) =====
// Data sources:
//  - provisioning.db (table `devices`)
//  - registry.db (table `device_events`)
//  - twin.db (table `device_events` for connection status)
// For MVP we access SQLite files directly. In future, route via shared repos or D-Bus.

function openDb(file: string){
  try{
    // Ensure parent directory exists so sqlite can create the DB file
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch {}
    const db: any = new (Database as any)(file);
    db.pragma('journal_mode = WAL');
    return db as any;
  }catch(e){
    return null;
  }
}

// Ensure main devicehub database schema exists (whitelist, registry, events)
// This consolidates all tables into a single database file
function ensureDeviceHubSchema(){
  console.log(`[ensureDeviceHubSchema] Initializing database schema: ${DEVICEHUB_DB}`);
  const db = openDb(DEVICEHUB_DB);
  if(!db) {
    console.error(`[ensureDeviceHubSchema] Failed to open database: ${DEVICEHUB_DB}`);
    return;
  }
  try{
    // uuid_whitelist: tracks pre-approved provisioning UUIDs
    // Updated schema: uuid, hardware_version, manufacturer, created_at, used_at
    try {
      const whitelistInfo = db.prepare('PRAGMA table_info(uuid_whitelist)').all();
      const hasLegacyColumns = whitelistInfo.some((col: any) => col.name === 'device_id' || col.name === 'name' || col.name === 'note');
      const hasNewColumns = whitelistInfo.some((col: any) => col.name === 'hardware_version' && col.name === 'manufacturer');
      
      if (hasLegacyColumns || !hasNewColumns) {
        console.log('[ensureDeviceHubSchema] Migrating uuid_whitelist table to new schema');
        // Backup data, drop table, recreate with correct schema
        const existingData = db.prepare('SELECT uuid, created_at, used_at FROM uuid_whitelist').all();
        db.prepare('DROP TABLE uuid_whitelist').run();
        
        db.prepare(
          'CREATE TABLE uuid_whitelist ('+
          ' uuid TEXT PRIMARY KEY,'+
          ' hardware_version TEXT NOT NULL,'+
          ' manufacturer TEXT NOT NULL,'+
          ' created_at TEXT NOT NULL,'+
          ' used_at TEXT)'
        ).run();
        
        // Restore data with new schema (set default values for new fields)
        const insertStmt = db.prepare('INSERT INTO uuid_whitelist (uuid, hardware_version, manufacturer, created_at, used_at) VALUES (?, ?, ?, ?, ?)');
        for (const row of existingData) {
          insertStmt.run(row.uuid, 'Unknown', 'Unknown', row.created_at, row.used_at);
        }
        console.log(`[ensureDeviceHubSchema] Migrated ${existingData.length} whitelist entries`);
      } else {
        // Create table normally if no migration needed
        db.prepare(
          'CREATE TABLE IF NOT EXISTS uuid_whitelist ('+
          ' uuid TEXT PRIMARY KEY,'+
          ' hardware_version TEXT NOT NULL,'+
          ' manufacturer TEXT NOT NULL,'+
          ' created_at TEXT NOT NULL,'+
          ' used_at TEXT)'
        ).run();
      }
    } catch (e) {
      // Table doesn't exist, create it
      db.prepare(
        'CREATE TABLE IF NOT EXISTS uuid_whitelist ('+
        ' uuid TEXT PRIMARY KEY,'+
        ' hardware_version TEXT NOT NULL,'+
        ' manufacturer TEXT NOT NULL,'+
        ' created_at TEXT NOT NULL,'+
        ' used_at TEXT)'
      ).run();
    }

    // devices: device registry table
    // Columns: uuid, name, token, meta, created_at (consolidated schema)
    // Check if devices table exists with wrong schema and migrate if needed
    try {
      const tableInfo = db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string; type: string; pk: number }>;
      const hasUuidColumn = tableInfo.some(col => col.name === 'uuid');
      const hasIdColumn = tableInfo.some(col => col.name === 'id');
      
      if (tableInfo.length > 0 && !hasUuidColumn && hasIdColumn) {
        console.log('[ensureDeviceHubSchema] Migrating devices table from id to uuid schema');
        // Drop old table and recreate with correct schema
        db.prepare('DROP TABLE IF EXISTS devices').run();
      }
    } catch (e) {
      // Table doesn't exist yet, which is fine
    }
    
    try {
      db.prepare(
        'CREATE TABLE IF NOT EXISTS devices ('+
        ' uuid TEXT PRIMARY KEY,'+
        ' name TEXT NOT NULL,'+
        ' token TEXT,'+
        ' meta TEXT,'+
        ' created_at TEXT DEFAULT CURRENT_TIMESTAMP)'
      ).run();
      console.log(`[ensureDeviceHubSchema] Successfully created devices table`);
    } catch (error) {
      console.error(`[ensureDeviceHubSchema] Failed to create devices table:`, error);
      throw error;
    }
    
    console.log(`[ensureDeviceHubSchema] Created devices table with schema:`, 
      db.prepare('PRAGMA table_info(devices)').all().map((col: any) => col.name));

    // device_events: telemetry and event data
    db.prepare(
      'CREATE TABLE IF NOT EXISTS device_events ('+
      ' id INTEGER PRIMARY KEY AUTOINCREMENT,'+
      ' device_id TEXT NOT NULL,'+
      ' event_type TEXT NOT NULL,'+
      ' payload TEXT,'+
      ' ts TEXT NOT NULL,'+
      ' FOREIGN KEY (device_id) REFERENCES devices(uuid))'
    ).run();

    // Create indices for performance
    db.prepare('CREATE INDEX IF NOT EXISTS idx_device_events_device_id ON device_events(device_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_device_events_ts ON device_events(ts)').run();
    // Remove old index that references non-existent status column
    // db.prepare('CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status)').run();

  }catch{
    // ignore; routes will handle errors if schema still unavailable
  }finally{
    try{ db.close(); }catch{}
  }
}

function getLastSeenMap(): Record<string,string> {
  const db = openDb(DEVICEHUB_DB);
  if(!db) return {};
  try{
    const rows = db.prepare('SELECT device_id, MAX(ts) AS last_ts FROM device_events GROUP BY device_id').all();
    const map: Record<string,string> = {};
    for(const r of rows){ if(r.device_id && r.last_ts) map[r.device_id] = r.last_ts; }
    return map;
  }catch{ return {}; }
  finally{ try{ db.close(); }catch{} }
}

// GET /api/devices -> list known devices from provisioning DB
app.get('/api/devices', (req: Request, res: Response) => {
  const list = getDevicesListSync();
  // If unauthenticated (anonymous mode), strip UUIDs from payload
  const s = getSession(req);
  if (!s) {
    const scrubbed = {
      devices: (list.devices || []).map((d: any) => {
        const copy: any = { ...d };
        // Remove top-level uuid if present
        if ('uuid' in copy) delete copy.uuid;
        // Remove uuid keys recursively inside meta
        if (copy.meta && typeof copy.meta === 'object') {
          copy.meta = stripUuidsDeep(copy.meta);
        }
        return copy;
      })
    };
    return res.json(scrubbed);
  }
  res.json(list);
});

// GET /api/devices/:uuid -> single device
app.get('/api/devices/:uuid', (req: Request, res: Response) => {
  const { uuid } = req.params;
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(404).json({ error: 'not found' }); return; }
  try{
    const row = db.prepare('SELECT uuid, name, token, meta, created_at FROM devices WHERE uuid = ?').get(uuid);
    if(!row){ res.status(404).json({ error: 'not found' }); return; }
    const lastSeen = getLastSeenMap();
    const ls = lastSeen[uuid];
    const online = ls ? (Date.now() - Date.parse(ls)) / 1000 <= ONLINE_THRESHOLD_SECONDS : false;
    res.json({ uuid: row.uuid, name: row.name, token: row.token, meta: tryParseJson(row.meta), created_at: row.created_at, last_seen: ls || null, online });
  }catch(e){
    console.error(`[ensureDeviceHubSchema] Error creating schema:`, e);
    console.error(`[ensureDeviceHubSchema] Database path: ${DEVICEHUB_DB}`);
    console.error(`[ensureDeviceHubSchema] Error details:`, {
      name: (e as Error).name,
      message: (e as Error).message,
      code: (e as any).code
    });
  }finally{
    try{ db.close(); }catch{}
  }
});

// ===== API Token Management Endpoints =====

// GET /api/tokens -> list all API tokens
app.get('/api/tokens', authRequired, (req: Request, res: Response) => {
  const db = openDb(DEVICEHUB_DB);
  if (!db) { res.status(500).json({ error: 'db_unavailable' }); return; }
  try {
    // Initialize api_tokens table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        scopes TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used TEXT,
        active INTEGER DEFAULT 1
      )
    `);
    
    const tokens = db.prepare(`
      SELECT id, name, scopes, created_at, expires_at, last_used, active 
      FROM api_tokens 
      ORDER BY created_at DESC
    `).all();
    
    res.json({ tokens });
  } catch (e: any) {
    console.error('[core-service] Failed to list API tokens:', e);
    res.status(500).json({ error: 'failed_to_list_tokens' });
  } finally {
    try { db.close(); } catch {}
  }
});

// POST /api/tokens -> create new API token
app.post('/api/tokens', authRequired, (req: Request, res: Response) => {
  const { name, scopes, expiresIn } = req.body;
  
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name_required' }); 
    return;
  }
  
  const db = openDb(DEVICEHUB_DB);
  if (!db) { res.status(500).json({ error: 'db_unavailable' }); return; }
  
  try {
    // Initialize api_tokens table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        scopes TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used TEXT,
        active INTEGER DEFAULT 1
      )
    `);
    
    const tokenId = crypto.randomBytes(16).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    
    let expiresAt = null;
    if (expiresIn && typeof expiresIn === 'number' && expiresIn > 0) {
      const expDate = new Date();
      expDate.setSeconds(expDate.getSeconds() + expiresIn);
      expiresAt = expDate.toISOString();
    }
    
    const scopesStr = Array.isArray(scopes) ? scopes.join(',') : '';
    
    db.prepare(`
      INSERT INTO api_tokens (id, token, name, scopes, created_at, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(tokenId, token, name.trim(), scopesStr, createdAt, expiresAt);
    
    res.json({
      id: tokenId,
      token,
      name: name.trim(),
      scopes: scopesStr,
      created_at: createdAt,
      expires_at: expiresAt
    });
  } catch (e: any) {
    console.error('[core-service] Failed to create API token:', e);
    res.status(500).json({ error: 'failed_to_create_token' });
  } finally {
    try { db.close(); } catch {}
  }
});

// DELETE /api/tokens/:id -> revoke/delete API token
app.delete('/api/tokens/:id', authRequired, (req: Request, res: Response) => {
  const { id } = req.params;
  
  if (!id) { 
    res.status(400).json({ error: 'token_id_required' }); 
    return; 
  }
  
  const db = openDb(DEVICEHUB_DB);
  if (!db) { res.status(500).json({ error: 'db_unavailable' }); return; }
  
  try {
    const info = db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
    
    if (info.changes === 0) {
      res.status(404).json({ error: 'token_not_found' });
    } else {
      res.json({ ok: true, deleted: info.changes });
    }
  } catch (e: any) {
    console.error('[core-service] Failed to delete API token:', e);
    res.status(500).json({ error: 'failed_to_delete_token' });
  } finally {
    try { db.close(); } catch {}
  }
});

// PATCH /api/tokens/:id -> update API token (activate/deactivate)
app.patch('/api/tokens/:id', authRequired, (req: Request, res: Response) => {
  const { id } = req.params;
  const { active } = req.body;
  
  if (!id) { 
    res.status(400).json({ error: 'token_id_required' }); 
    return; 
  }
  
  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'active_field_required' });
    return;
  }
  
  const db = openDb(DEVICEHUB_DB);
  if (!db) { res.status(500).json({ error: 'db_unavailable' }); return; }
  
  try {
    const info = db.prepare('UPDATE api_tokens SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    
    if (info.changes === 0) {
      res.status(404).json({ error: 'token_not_found' });
    } else {
      res.json({ ok: true, updated: info.changes });
    }
  } catch (e: any) {
    console.error('[core-service] Failed to update API token:', e);
    res.status(500).json({ error: 'failed_to_update_token' });
  } finally {
    try { db.close(); } catch {}
  }
});

// DELETE /api/devices/:uuid -> decommission device
app.delete('/api/devices/:uuid', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  if (!uuid) { res.status(400).json({ error: 'invalid_device_uuid' }); return; }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try {
    const info = db.prepare('DELETE FROM devices WHERE uuid = ?').run(uuid);
    // Return also how many whitelist entries exist for this device so UI can prompt follow-up removal.
    const wlCount = db.prepare('SELECT COUNT(1) as c FROM uuid_whitelist WHERE device_id = ?').get(uuid)?.c || 0;
    // Remove device from twin-service database
    const twinDbPath = '/opt/Edgeberry/devicehub/twin-service/twin.db';
    const twinDb = openDb(twinDbPath);
    if (twinDb) {
      try {
        twinDb.prepare('DELETE FROM device_events WHERE device_id = ?').run(uuid);
      } catch (e) {
        console.error('[core-service] Failed to remove device from twin-service database:', e);
      } finally {
        try { twinDb.close(); } catch {}
      }
    }
    res.json({ ok: true, removed: info.changes || 0, whitelist_entries: Number(wlCount) });
  } catch (e:any) {
    res.status(500).json({ error: 'decommission_failed', message: e?.message || 'failed' });
  } finally {
    try{ db.close(); }catch{}
  }
});

// PUT /api/devices/:uuid -> update device (e.g., name)
app.put('/api/devices/:uuid', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { name } = req.body || {};
  if (!uuid) { res.status(400).json({ error: 'invalid_device_uuid' }); return; }
  if (!name || typeof name !== 'string' || !name.trim()) { 
    res.status(400).json({ error: 'name_required' }); return; 
  }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try {
    const info = db.prepare('UPDATE devices SET name = ? WHERE uuid = ?').run(name.trim(), uuid);
    if (info.changes === 0) {
      res.status(404).json({ error: 'device_not_found' });
    } else {
      res.json({ ok: true, updated: info.changes });
    }
  } catch (e:any) {
    res.status(500).json({ error: 'update_failed', message: e?.message || 'failed' });
  } finally {
    try{ db.close(); }catch{}
  }
});

// POST /api/devices/:uuid/replace -> replace device with another device
app.post('/api/devices/:uuid/replace', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { targetUuid } = req.body || {};
  if (!uuid) { res.status(400).json({ error: 'invalid_device_uuid' }); return; }
  if (!targetUuid || typeof targetUuid !== 'string') { 
    res.status(400).json({ error: 'target_uuid_required' }); return; 
  }
  if (uuid === targetUuid) {
    res.status(400).json({ error: 'cannot_replace_with_self' }); return;
  }
  
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try {
    // Check both devices exist
    const sourceDevice = db.prepare('SELECT uuid, name FROM devices WHERE uuid = ?').get(uuid);
    const targetDevice = db.prepare('SELECT uuid, name FROM devices WHERE uuid = ?').get(targetUuid);
    
    if (!sourceDevice) {
      res.status(404).json({ error: 'source_device_not_found' });
      return;
    }
    if (!targetDevice) {
      res.status(404).json({ error: 'target_device_not_found' });
      return;
    }
    
    // Begin transaction to swap device data
    const transaction = db.transaction(() => {
      // Store source device name (this stays with the record)
      const sourceName = sourceDevice.name;
      
      // Delete source device record
      db.prepare('DELETE FROM devices WHERE uuid = ?').run(uuid);
      
      // Update target device to use source UUID but keep target's name
      db.prepare('UPDATE devices SET uuid = ?, name = ? WHERE uuid = ?').run(uuid, sourceName, targetUuid);
      
      // Update any related records (events, etc.)
      db.prepare('UPDATE device_events SET device_id = ? WHERE device_id = ?').run(uuid, targetUuid);
    });
    
    transaction();
    res.json({ 
      ok: true, 
      message: `Device ${targetDevice.name} (${targetUuid}) replaced device ${sourceDevice.name} (${uuid})`,
      replacedDevice: { uuid, name: sourceDevice.name },
      withDevice: { uuid: targetUuid, name: targetDevice.name }
    });
  } catch (e:any) {
    res.status(500).json({ error: 'replace_failed', message: e?.message || 'failed' });
  } finally {
    try{ db.close(); }catch{}
  }
});

// GET /api/devices/:uuid/events -> recent events from registry DB
app.get('/api/devices/:uuid/events', (req: Request, res: Response) => {
  const { uuid } = req.params;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.json({ events: [] }); return; }
  try{
    const rows = db.prepare('SELECT id, device_id, topic, payload, ts FROM device_events WHERE device_id = ? ORDER BY ts DESC LIMIT ?').all(uuid, limit);
    const events = rows.map((r: any) => ({ id: r.id, device_id: r.device_id, topic: r.topic, payload: bufferToMaybeJson(r.payload), ts: r.ts }));
    res.json({ events });
  }catch{
    res.json({ events: [] });
  }finally{
    try{ db.close(); }catch{}
  }
});

function tryParseJson(txt: any){
  if (typeof txt !== 'string') return txt;
  try{ return JSON.parse(txt); }catch{ return txt; }
}
function bufferToMaybeJson(b: any){
  try{
    const s = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : String(b));
    try{ return JSON.parse(s); }catch{ return s; }
  }catch{ return b; }
}

// Remove any property named 'uuid' recursively from objects/arrays
function stripUuidsDeep(input: any): any {
  if (Array.isArray(input)) return input.map(stripUuidsDeep);
  if (input && typeof input === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(input)) {
      if (k === 'uuid') continue;
      out[k] = stripUuidsDeep(v as any);
    }
    return out;
  }
  return input;
}

// ===== Helpers reused by REST and WS =====
async function getServicesSnapshot(): Promise<{ services: Array<{ unit: string; status: string; version?: string }> }> {
  // Defensive guard: exclude any units that contain 'registry' regardless of source
  // This ensures stale builds/configs cannot surface a registry tile in the UI.
  const units = DEFAULT_LOG_UNITS.filter(u => !String(u || '').toLowerCase().includes('registry'));

  function unitToPkgPath(u: string): string | null {
    // Map systemd unit -> sibling service directory package.json
    // devicehub-core.service -> ../core-service/package.json
    // devicehub-provisioning.service -> ../provisioning-service/package.json
    // devicehub-twin.service -> ../twin-service/package.json
    const map: Record<string, string> = {
      'devicehub-core.service': path.resolve(process.cwd(), '..', 'core-service', 'package.json'),
      'devicehub-provisioning.service': path.resolve(process.cwd(), '..', 'provisioning-service', 'package.json'),
      'devicehub-twin.service': path.resolve(process.cwd(), '..', 'twin-service', 'package.json'),
    };
    return map[u] || null;
  }

  function readVersion(pkgPath: string | null): string | undefined {
    if (!pkgPath) return undefined;
    try {
      if (!fs.existsSync(pkgPath)) return undefined;
      const txt = fs.readFileSync(pkgPath, 'utf8');
      const json = JSON.parse(txt);
      const v = json && typeof json.version === 'string' ? json.version : undefined;
      return v;
    } catch { return undefined; }
  }

  const checks = await Promise.all(units.map(async (u) => {
    try {
      const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const p = spawn('systemctl', ['is-active', u], { stdio: ['ignore', 'pipe', 'pipe'] });
        const out: string[] = [];
        const err: string[] = [];
        p.stdout.on('data', (c: Buffer) => out.push(c.toString()));
        p.stderr.on('data', (c: Buffer) => err.push(c.toString()));
        p.on('close', (code: number | null) => resolve({ code, out: out.join('').trim(), err: err.join('') }));
      });
      const version = readVersion(unitToPkgPath(u));
      return { unit: u, status: result.out || 'unknown', ...(version ? { version } : {}) } as any;
    } catch (e) {
      const version = readVersion(unitToPkgPath(u));
      return { unit: u, status: 'error', ...(version ? { version } : {}) } as any;
    }
  }));
  return { services: checks };
}

function getDevicesListSync(): { devices: Array<{ uuid: string; name: string; token: string; meta: any; created_at: string; last_seen: string | null; online: boolean }> }{
  console.log(`[getDevicesListSync] Opening database: ${DEVICEHUB_DB}`);
  const db = openDb(DEVICEHUB_DB);
  if(!db){ 
    console.error(`[getDevicesListSync] Failed to open database: ${DEVICEHUB_DB}`);
    return { devices: [] }; 
  }
  try{
    // Validate database schema before querying
    const tableInfo = db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string; type: string; pk: number }>;
    console.log(`[getDevicesListSync] Database schema validation - devices table columns:`, tableInfo.map(col => col.name));
    
    const hasUuidColumn = tableInfo.some(col => col.name === 'uuid');
    if (!hasUuidColumn) {
      console.error(`[getDevicesListSync] SCHEMA ERROR: devices table missing uuid column. Available columns:`, tableInfo.map(col => col.name));
      return { devices: [] };
    }
    
    const rows = db.prepare('SELECT uuid, name, token, meta, created_at FROM devices ORDER BY created_at DESC').all();
    console.log(`[getDevicesListSync] Query returned ${rows.length} rows:`, rows);
    
    // Get device statuses from twin-service database
    const deviceStatuses = getTwinServiceDeviceStatuses();
    
    const devices = rows.map((r: any) => {
      const deviceStatus = deviceStatuses[r.uuid];
      const online = deviceStatus ? deviceStatus.online : false;
      const last_seen = deviceStatus ? deviceStatus.last_seen : null;
      
      return { 
        uuid: r.uuid, 
        name: r.name, 
        token: r.token, 
        meta: tryParseJson(r.meta), 
        created_at: r.created_at, 
        last_seen, 
        online 
      };
    });
    console.log(`[getDevicesListSync] Returning ${devices.length} devices:`, devices);
    return { devices };
  }catch(error){
    console.error(`[getDevicesListSync] Error querying devices:`, error);
    console.error(`[getDevicesListSync] Database path: ${DEVICEHUB_DB}`);
    console.error(`[getDevicesListSync] Error details:`, {
      name: (error as Error).name,
      message: (error as Error).message,
      code: (error as any).code
    });
    return { devices: [] };
  }finally{
    try{ db.close(); }catch{}
  }
}

function getTwinServiceDeviceStatuses(): Record<string, { online: boolean; last_seen: string | null }> {
  // Get device statuses from twin-service database directly
  // This is a temporary solution until proper async D-Bus calls are implemented
  try {
    const twinDbPath = process.env.TWIN_DB || '/var/lib/edgeberry/devicehub/twin.db';
    const db = openDb(twinDbPath);
    if (!db) {
      console.error('[core-service] Failed to open twin database:', twinDbPath);
      return {};
    }
    
    // Ensure device_events table exists
    db.prepare(`CREATE TABLE IF NOT EXISTS device_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload BLOB,
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();

    // Get latest status for each device
    const stmt = db.prepare(`
      SELECT device_id, payload, ts FROM device_events e1
      WHERE e1.topic LIKE '%clients/%' 
      AND e1.id = (
        SELECT MAX(e2.id) FROM device_events e2 
        WHERE e2.device_id = e1.device_id AND e2.topic LIKE '%clients/%'
      )
    `);
    
    const rows = stmt.all() as { device_id: string; payload: string; ts: string }[];
    const result: Record<string, { online: boolean; last_seen: string | null }> = {};
    
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload);
        const isOnline = payload.status === 'online';
        result[row.device_id] = {
          online: isOnline,
          last_seen: isOnline ? null : row.ts
        };
      } catch {
        result[row.device_id] = { online: false, last_seen: null };
      }
    }
    
    db.close();
    console.log(`[core-service] Retrieved device statuses:`, result);
    return result;
  } catch (error) {
    console.error('[core-service] Failed to get device statuses from twin-service database:', error);
    return {};
  }
}

async function getDevicesList(): Promise<{ devices: Array<{ uuid: string; name: string; token: string; meta: any; created_at: string; last_seen: string | null; online: boolean }> }> {
  return getDevicesListSync();
}

// ===== Device Actions (stub) =====
// In future, wire these to MQTT/cloud connector to invoke direct methods on devices.
// For now, return an ok message so the UI can integrate the flows.
app.post('/api/devices/:uuid/actions/identify', authRequired, async (req: Request, res: Response) => {
  const { uuid } = req.params;
  console.log(`[${SERVICE}] Identify button pressed for device: ${uuid}`);
  
  if (!uuid) { 
    res.status(400).json({ ok: false, message: 'invalid_device_uuid' }); 
    return; 
  }
  
  try {
    console.log(`[${SERVICE}] Sending identify direct method to device ${uuid}`);
    const success = await sendDirectMethod(uuid, 'identify');
    console.log(`[${SERVICE}] Direct method result: ${success}`);
    
    if (success) {
      res.json({ ok: true, message: `Identify command sent to device ${uuid}` });
    } else {
      res.status(500).json({ ok: false, message: 'Failed to send identify command to device' });
    }
  } catch (error) {
    console.error(`[${SERVICE}] Error sending identify command to device ${uuid}:`, error);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.post('/api/devices/:uuid/actions/reboot', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  if (!uuid) { res.status(400).json({ ok: false, message: 'invalid_device_uuid' }); return; }
  res.json({ ok: true, message: `Reboot requested for device ${uuid}` });
});

// Shutdown device (stub)
app.post('/api/devices/:uuid/actions/shutdown', (req: Request, res: Response) => {
  const { uuid } = req.params;
  if (!uuid) { res.status(400).json({ ok: false, message: 'invalid_device_uuid' }); return; }
  res.json({ ok: true, message: `Shutdown requested for device ${uuid}` });
});

// Application controls
app.post('/api/devices/:uuid/actions/application/restart', (req: Request, res: Response) => {
  const { uuid } = req.params; if (!uuid) { res.status(400).json({ ok:false, message:'invalid_device_uuid' }); return; }
  res.json({ ok:true, message:`Application restart requested for ${uuid}` });
});
app.post('/api/devices/:uuid/actions/application/stop', (req: Request, res: Response) => {
  const { uuid } = req.params; if (!uuid) { res.status(400).json({ ok:false, message:'invalid_device_uuid' }); return; }
  res.json({ ok:true, message:`Application stop requested for ${uuid}` });
});
app.post('/api/devices/:uuid/actions/application/start', (req: Request, res: Response) => {
  const { uuid } = req.params; if (!uuid) { res.status(400).json({ ok:false, message:'invalid_device_uuid' }); return; }
  res.json({ ok:true, message:`Application start requested for ${uuid}` });
});
app.post('/api/devices/:uuid/actions/application/update', (req: Request, res: Response) => {
  const { uuid } = req.params; if (!uuid) { res.status(400).json({ ok:false, message:'invalid_device_uuid' }); return; }
  res.json({ ok:true, message:`Application update requested for ${uuid}` });
});

// System info/network
app.post('/api/devices/:uuid/actions/system/info', (req: Request, res: Response) => {
  const { uuid } = req.params; if (!uuid) { res.status(400).json({ ok:false, message:'invalid_device_uuid' }); return; }
  res.json({ ok:true, payload:{ platform:'unknown', state:'unknown' } });
});
app.post('/api/devices/:id/actions/system/network', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, payload:{ interfaces:{} } });
});

// Connection parameters
app.post('/api/devices/:id/actions/connection/get-params', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, payload:{ broker:'', clientId:id } });
});
app.post('/api/devices/:id/actions/connection/update-params', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, message:`Connection parameters updated for ${id}` });
});
app.post('/api/devices/:id/actions/connection/reconnect', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, message:`Reconnect requested for ${id}` });
});

// Provisioning
app.post('/api/devices/:id/actions/provisioning/get-params', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, payload:{ endpoint:'', thingName:id } });
});
app.post('/api/devices/:id/actions/provisioning/update-params', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, message:`Provisioning parameters updated for ${id}` });
});
app.post('/api/devices/:id/actions/provisioning/reprovision', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, message:`Reprovision requested for ${id}` });
});

// ===== Admin: UUID Whitelist Management =====
// Table lives in provisioning.db as `uuid_whitelist` with columns
// (uuid PRIMARY KEY, device_id TEXT, name TEXT, note TEXT, created_at TEXT, used_at TEXT)

// Ensure schema exists before exposing routes
ensureDeviceHubSchema();

// GET /api/admin/uuid-whitelist -> list entries
app.get('/api/admin/uuid-whitelist', (_req: Request, res: Response) => {
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.json({ entries: [] }); return; }
  try{
    const rows = db.prepare('SELECT uuid, hardware_version, manufacturer, created_at, used_at FROM uuid_whitelist ORDER BY created_at DESC').all();
    res.json({ entries: rows });
  }catch{
    res.json({ entries: [] });
  }finally{ try{ db.close(); }catch{} }
});

// POST /api/admin/uuid-whitelist -> add entry
app.post('/api/admin/uuid-whitelist', authRequired, (req: Request, res: Response) => {
  let { uuid, hardware_version, manufacturer } = req.body;
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  if(!uuid){ res.status(400).json({ error: 'uuid_required' }); return; }
  if(!hardware_version){ res.status(400).json({ error: 'hardware_version_required' }); return; }
  if(!manufacturer){ res.status(400).json({ error: 'manufacturer_required' }); return; }
  uuid = String(uuid).trim();
  hardware_version = String(hardware_version).trim();
  manufacturer = String(manufacturer).trim();
  if(!uuid || !hardware_version || !manufacturer){ 
    res.status(400).json({ error: 'all_fields_required' }); return; 
  }
  try{
    const now = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO uuid_whitelist (uuid, hardware_version, manufacturer, created_at) VALUES (?, ?, ?, ?)');
    stmt.run(uuid, hardware_version, manufacturer, now);
    res.json({ ok: true });
  }catch(e:any){
    if(e?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'){ res.status(409).json({ error: 'uuid_exists' }); return; }
    res.status(500).json({ error: 'insert_failed', message: e?.message || 'failed' });
  }finally{ try{ db.close(); }catch{} }
});

// POST /api/admin/uuid-whitelist/batch -> batch add entries from file
app.post('/api/admin/uuid-whitelist/batch', authRequired, (req: Request, res: Response) => {
  let { uuids, hardware_version, manufacturer } = req.body;
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  if(!uuids || !Array.isArray(uuids)){ res.status(400).json({ error: 'uuids_array_required' }); return; }
  if(!hardware_version){ res.status(400).json({ error: 'hardware_version_required' }); return; }
  if(!manufacturer){ res.status(400).json({ error: 'manufacturer_required' }); return; }
  
  hardware_version = String(hardware_version).trim();
  manufacturer = String(manufacturer).trim();
  if(!hardware_version || !manufacturer){ 
    res.status(400).json({ error: 'hardware_version_and_manufacturer_required' }); return; 
  }
  
  const results = { added: 0, skipped: 0, errors: [] as string[] };
  const now = new Date().toISOString();
  
  try{
    const stmt = db.prepare('INSERT INTO uuid_whitelist (uuid, hardware_version, manufacturer, created_at) VALUES (?, ?, ?, ?)');
    
    for(const rawUuid of uuids) {
      const uuid = String(rawUuid).trim();
      if(!uuid) {
        results.errors.push(`Empty UUID skipped`);
        results.skipped++;
        continue;
      }
      
      try {
        stmt.run(uuid, hardware_version, manufacturer, now);
        results.added++;
      } catch(e: any) {
        if(e?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
          results.errors.push(`UUID ${uuid} already exists`);
          results.skipped++;
        } else {
          results.errors.push(`UUID ${uuid}: ${e?.message || 'insert failed'}`);
          results.skipped++;
        }
      }
    }
    
    res.json({ ok: true, results });
  }catch(e:any){
    res.status(500).json({ error: 'batch_insert_failed', message: e?.message || 'failed' });
  }finally{ try{ db.close(); }catch{} }
});

// DELETE /api/admin/uuid-whitelist/:uuid -> remove entry
app.delete('/api/admin/uuid-whitelist/:uuid', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  if(!uuid){ res.status(400).json({ error: 'invalid_uuid' }); return; }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try{
    const info = db.prepare('DELETE FROM uuid_whitelist WHERE uuid = ?').run(uuid);
    res.json({ deleted: info.changes > 0 });
  }catch{ res.status(500).json({ error: 'delete_failed' }); }
  finally{ try{ db.close(); }catch{} }
});

// DELETE /api/admin/uuid-whitelist/by-device/:deviceId -> remove all whitelist entries for a device
app.delete('/api/admin/uuid-whitelist/by-device/:deviceId', authRequired, (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if(!deviceId){ res.status(400).json({ error: 'invalid_device_id' }); return; }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try{
    const info = db.prepare('DELETE FROM uuid_whitelist WHERE device_id = ?').run(deviceId);
    res.json({ deleted: info.changes || 0 });
  }catch{ res.status(500).json({ error: 'delete_failed' }); }
  finally{ try{ db.close(); }catch{} }
});

// ===== Server Settings & Certificate Management =====
// Endpoints backing the admin modals (Certificates/Whitelist) on the Overview UI. Root CA must exist before issuing
// provisioning certificates. Files are written under CERTS_DIR.
// Filesystem layout (configurable via env):
//  ROOT: CERTS_DIR (default: ./data/certs relative to process cwd)
//   - root/ca.key, root/ca.crt
//   - provisioning/ (issued provisioning certs)
// Cert helpers moved to src/certs.ts

// GET /api/settings/server -> snapshot of server-level settings (used by UI)
app.get('/api/settings/server', async (_req: Request, res: Response) => {
  try {
    ensureDirs();
    const rootPresent = await caExists();
    const caMeta = await readCertMeta(CA_CRT);
    const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';
    res.json({
      certsDir: CERTS_DIR,
      root: { present: rootPresent, key: CA_KEY, cert: CA_CRT, meta: caMeta },
      provisioningDir: PROV_DIR,
      settings: { MQTT_URL: mqttUrl, UI_DIST }
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to read settings' });
  }
});

// GET /api/settings/certs/root -> PEM + meta (if present)
app.get('/api/settings/certs/root', async (_req: Request, res: Response) => {
  try {
    if (!(await caExists())) { res.status(404).json({ error: 'root CA not found' }); return; }
    const pem = fs.readFileSync(CA_CRT, 'utf8');
    const meta = await readCertMeta(CA_CRT);
    res.json({ pem, meta });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to read root cert' });
  }
});

// POST /api/settings/certs/root { cn?, days?, keyBits? } -> create Root CA if absent
app.post('/api/settings/certs/root', async (req: Request, res: Response) => {
  try {
    if (await caExists()) { res.status(409).json({ error: 'root CA already exists' }); return; }
    const { cn, days, keyBits } = req.body || {};
    await generateRootCA({ cn, days, keyBits });
    const meta = await readCertMeta(CA_CRT);
    res.json({ ok: true, key: CA_KEY, cert: CA_CRT, meta });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to generate root CA' });
  }
});

// GET /api/settings/certs/provisioning -> list issued provisioning certs (metadata)
app.get('/api/settings/certs/provisioning', async (_req: Request, res: Response) => {
  try {
    ensureDirs();
    if (!fs.existsSync(PROV_DIR)) { res.json({ certs: [] }); return; }
    const files = fs.readdirSync(PROV_DIR).filter(f => f.endsWith('.crt'));
    const certs = await Promise.all(files.map(async (f) => {
      const full = path.join(PROV_DIR, f);
      const name = path.basename(f, '.crt');
      const meta = await readCertMeta(full);
      return { name, cert: full, key: path.join(PROV_DIR, `${name}.key`), meta };
    }));
    res.json({ certs });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to list provisioning certs' });
  }
});

// POST /api/settings/certs/provisioning -> generate provisioning cert
app.post('/api/settings/certs/provisioning', async (req: Request, res: Response) => {
  try {
    await generateProvisioningCert();
    res.json({ ok: true, message: 'Provisioning certificate generated' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to generate provisioning cert' });
  }
});

// GET /api/settings/certs/provisioning/:name -> inspect a provisioning cert (PEM + meta)
app.get('/api/settings/certs/provisioning/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) { res.status(400).json({ error: 'invalid name' }); return; }
    const crtPath = path.join(PROV_DIR, `${name}.crt`);
    if (!fs.existsSync(crtPath)) { res.status(404).json({ error: 'not found' }); return; }
    const pem = fs.readFileSync(crtPath, 'utf8');
    const meta = await readCertMeta(crtPath);
    res.json({ name, pem, meta });
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'failed to read provisioning cert' });
  }
});

// DELETE /api/settings/certs/provisioning/:name -> remove cert and corresponding key
app.delete('/api/settings/certs/provisioning/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) { res.status(400).json({ error: 'invalid name' }); return; }
    const crtPath = path.join(PROV_DIR, `${name}.crt`);
    const keyPath = path.join(PROV_DIR, `${name}.key`);
    if (!fs.existsSync(crtPath) && !fs.existsSync(keyPath)) { res.status(404).json({ error: 'not found' }); return; }
    try { if (fs.existsSync(crtPath)) fs.rmSync(crtPath); } catch {}
    try { if (fs.existsSync(keyPath)) fs.rmSync(keyPath); } catch {}
    res.json({ ok: true, deleted: { cert: fs.existsSync(crtPath) ? false : true, key: fs.existsSync(keyPath) ? false : true } });
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'failed to delete provisioning cert' });
  }
});

// ===== Services & Logs =====
// GET /api/services -> systemd unit status snapshot consumed by ServiceStatusWidget
app.get('/api/services', async (_req: Request, res: Response) => {
  const data = await getServicesSnapshot();
  res.json(data);
});

// GET /api/metrics -> system metrics snapshot
type MetricsSnapshot = {
  cpu: { load1: number; load5: number; load15: number; cores: number; approxUsagePercent: number };
  memory: { total: number; free: number; used: number; usedPercent: number };
  disk: { mounts: Array<{ target: string; usedBytes: number; sizeBytes: number; usedPercent: number }> };
  network: { total: { rxBytes: number; txBytes: number }; interfaces: Record<string, { rxBytes: number; txBytes: number }> };
  uptimeSec: number;
  timestamp: number;
};

function readNetDev(){
  try{
    const txt = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = txt.split('\n').slice(2); // skip headers
    const ifaces: Record<string, { rxBytes: number; txBytes: number }> = {};
    for(const line of lines){
      const m = line.trim().match(/([^:]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      if(!m) continue;
      const name = m[1].trim();
      const rxBytes = Number(m[2]);
      const txBytes = Number(m[3]);
      if (name === 'lo') continue; // skip loopback
      ifaces[name] = { rxBytes, txBytes };
    }
    return ifaces;
  }catch{
    return {} as Record<string, { rxBytes: number; txBytes: number }>;
  }
}

async function readMetricsSnapshot(): Promise<MetricsSnapshot>{
  // CPU
  const load = os.loadavg();
  const cores = os.cpus()?.length || 1;
  const cpu = {
    load1: load[0],
    load5: load[1],
    load15: load[2],
    cores,
    approxUsagePercent: Math.min(100, Math.max(0, (load[0] / cores) * 100)),
  };

  // Memory
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const mem = { total, free, used, usedPercent: total > 0 ? (used / total) * 100 : 0 };

  // Disk via df
  const disk = await new Promise<{ mounts: Array<{ target: string; usedBytes: number; sizeBytes: number; usedPercent: number }> }>((resolve) => {
    const p = spawn('df', ['-k', '--output=target,size,used', '-x', 'tmpfs', '-x', 'devtmpfs']);
    const out: string[] = [];
    p.stdout.on('data', (c: Buffer) => out.push(c.toString()));
    p.on('close', () => {
      const lines = out.join('').trim().split('\n');
      const mounts: Array<{ target: string; usedBytes: number; sizeBytes: number; usedPercent: number }> = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length < 3) continue;
        const target = parts[0];
        const sizeKB = Number(parts[1]);
        const usedKB = Number(parts[2]);
        const sizeBytes = sizeKB * 1024;
        const usedBytes = usedKB * 1024;
        const usedPercent = sizeBytes > 0 ? (usedBytes / sizeBytes) * 100 : 0;
        mounts.push({ target, usedBytes, sizeBytes, usedPercent });
      }
      resolve({ mounts });
    });
  });

  const netIfaces = readNetDev();
  const netSummary = Object.values(netIfaces).reduce((acc, v) => { acc.rxBytes += v.rxBytes; acc.txBytes += v.txBytes; return acc; }, { rxBytes: 0, txBytes: 0 });

  return { cpu, memory: mem, disk, network: { total: netSummary, interfaces: netIfaces }, uptimeSec: os.uptime(), timestamp: Date.now() };
}

// In-memory metrics history sampler (10s interval, keep 24h)
const METRICS_INTERVAL_MS = 10_000;
const METRICS_HISTORY_HOURS = 24;
const METRICS_MAX_SAMPLES = Math.ceil((METRICS_HISTORY_HOURS * 3600 * 1000) / METRICS_INTERVAL_MS) + 60; // small buffer
const METRICS_HISTORY: MetricsSnapshot[] = [];

async function sampleMetrics(){
  try{
    const snap = await readMetricsSnapshot();
    METRICS_HISTORY.push(snap);
    // trim by size
    if(METRICS_HISTORY.length > METRICS_MAX_SAMPLES){ METRICS_HISTORY.splice(0, METRICS_HISTORY.length - METRICS_MAX_SAMPLES); }
    // trim by time
    const cutoff = Date.now() - METRICS_HISTORY_HOURS * 3600 * 1000;
    while(METRICS_HISTORY.length && METRICS_HISTORY[0].timestamp < cutoff){ METRICS_HISTORY.shift(); }
  }catch{}
}
// seed first sample soon after start; recurring interval is managed by WS wrapper below
setTimeout(sampleMetrics, 1000);

app.get('/api/metrics', async (_req: Request, res: Response) => {
  try{
    const snap = await readMetricsSnapshot();
    res.json(snap);
  }catch(e:any){
    res.status(500).json({ error: e?.message || 'failed to read metrics' });
  }
});

// GET /api/metrics/history?hours=24 -> array of snapshots (oldest -> newest)
app.get('/api/metrics/history', (req: Request, res: Response) => {
  const hours = Math.min(48, Math.max(1, Number(req.query.hours || 24)));
  const cutoff = Date.now() - hours * 3600 * 1000;
  const data = METRICS_HISTORY.filter(s => s.timestamp >= cutoff);
  res.json({ hours, samples: data });
});
// GET /api/logs -> recent logs snapshot
// Query: units=comma,separated (optional), lines=number (default 200), since=systemd-time (optional)
app.get('/api/logs', (req: Request, res: Response) => {
  // Support either `units` (comma-separated) or a single `unit` alias
  let units: string[] | undefined = undefined;
  if (typeof req.query.units === 'string' && req.query.units) {
    units = String(req.query.units).split(',').map(s => s.trim()).filter(Boolean);
  } else if (typeof req.query.unit === 'string' && req.query.unit) {
    units = [String(req.query.unit).trim()];
  }
  
  // Validate units for security
  if (units) {
    units = units.filter(unit => isSafeUnit(unit));
    if (units.length === 0) {
      res.status(400).json({ error: 'No valid units specified' });
      return;
    }
  }
  
  const lines = req.query.lines ? Number(req.query.lines) : 200;
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;

  console.log(`[LOGS] Requesting logs for units: ${units ? units.join(', ') : 'default'}, lines: ${lines}`);
  const args = buildJournalctlArgs({ units, lines, since, output: 'json' });
  console.log(`[LOGS] journalctl args: ${args.join(' ')}`);
  const proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const out: string[] = [];
  const err: string[] = [];
  proc.stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()));
  proc.stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
  proc.on('close', (code: number | null) => {
    if (code !== 0) {
      res.status(500).json({ error: 'journalctl failed', code, stderr: err.join('') });
      return;
    }
    // journalctl -o json outputs NDJSON (one JSON per line)
    const linesArr = out.join('').split('\n').filter(Boolean);
    const entries = linesArr.map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
    res.json({ entries });
  });
});

// POST /api/services/:unit/start|stop|restart -> systemctl control (best-effort; may require privileges)
async function systemctlAction(unit: string, action: 'start'|'stop'|'restart') {
  return await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const p = spawn('systemctl', [action, unit], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: string[] = [];
    const err: string[] = [];
    p.stdout.on('data', (c: Buffer) => out.push(c.toString()));
    p.stderr.on('data', (c: Buffer) => err.push(c.toString()));
    p.on('close', (code: number | null) => resolve({ code, out: out.join('').trim(), err: err.join('') }));
  });
}

function actionHandler(action: 'start'|'stop'|'restart') {
  return async (req: Request, res: Response) => {
    const unit = String(req.params.unit);
    try {
      const result = await systemctlAction(unit, action);
      if (result.code !== 0) {
        res.status(500).json({ ok: false, action, unit, error: result.err || `systemctl ${action} exited with ${result.code}` });
        return;
      }
      // Return new status snapshot for this unit
      const check = await new Promise<{ code: number | null; out: string }>((resolve) => {
        const p = spawn('systemctl', ['is-active', unit], { stdio: ['ignore', 'pipe', 'ignore'] });
        const out: string[] = [];
        p.stdout.on('data', (c: Buffer) => out.push(c.toString()));
        p.on('close', (code: number | null) => resolve({ code, out: out.join('').trim() }));
      });
      res.json({ ok: true, action, unit, status: check.out || 'unknown' });
    } catch (e: any) {
      res.status(500).json({ ok: false, action, unit, error: e?.message || 'unknown error' });
    }
  };
}

app.post('/api/services/:unit/start', actionHandler('start'));
app.post('/api/services/:unit/stop', actionHandler('stop'));
app.post('/api/services/:unit/restart', actionHandler('restart'));

// System power management endpoints (admin-only)
// POST /api/system/reboot -> reboot the server
app.post('/api/system/reboot', authRequired, async (req: Request, res: Response) => {
  try {
    console.log('[core-service] System reboot requested by admin');
    
    // Schedule reboot with a 1-minute delay to allow response to be sent
    const proc = spawn('shutdown', ['-r', '+1'], { 
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code: number | null) => {
      if (code === 0) {
        console.log('[core-service] System reboot scheduled successfully');
      } else {
        console.error('[core-service] Failed to schedule reboot:', stderr);
      }
    });
    
    // Respond immediately
    res.json({ 
      ok: true, 
      message: 'System reboot scheduled in 1 minute',
      action: 'reboot'
    });
    
  } catch (e: any) {
    console.error('[core-service] Error scheduling reboot:', e);
    res.status(500).json({ 
      ok: false, 
      error: e?.message || 'Failed to schedule reboot',
      action: 'reboot'
    });
  }
});

// POST /api/system/shutdown -> shutdown the server
app.post('/api/system/shutdown', authRequired, async (req: Request, res: Response) => {
  try {
    console.log('[core-service] System shutdown requested by admin');
    
    // Schedule shutdown with a 1-minute delay to allow response to be sent
    const proc = spawn('shutdown', ['-h', '+1'], { 
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code: number | null) => {
      if (code === 0) {
        console.log('[core-service] System shutdown scheduled successfully');
      } else {
        console.error('[core-service] Failed to schedule shutdown:', stderr);
      }
    });
    
    // Respond immediately
    res.json({ 
      ok: true, 
      message: 'System shutdown scheduled in 1 minute',
      action: 'shutdown'
    });
    
  } catch (e: any) {
    console.error('[core-service] Error scheduling shutdown:', e);
    res.status(500).json({ 
      ok: false, 
      error: e?.message || 'Failed to schedule shutdown',
      action: 'shutdown'
    });
  }
});

// POST /api/system/sanity-check -> comprehensive system sanity check
app.post('/api/system/sanity-check', authRequired, async (req: Request, res: Response) => {
  try {
    console.log('[core-service] System sanity check requested by admin');
    
    const results: any = {
      timestamp: new Date().toISOString(),
      checks: {},
      summary: { passed: 0, failed: 0, warnings: 0 }
    };

    // Check system services
    try {
      const servicesRes = await getServicesSnapshot();
      const services = Array.isArray(servicesRes?.services) ? servicesRes.services : [];
      const activeServices = services.filter(s => s.status === 'active').length;
      const failedServices = services.filter(s => s.status === 'failed').length;
      
      results.checks.services = {
        status: failedServices === 0 ? 'pass' : 'fail',
        message: `${activeServices} active, ${failedServices} failed services`,
        details: { active: activeServices, failed: failedServices, total: services.length }
      };
      
      if (failedServices === 0) results.summary.passed++;
      else results.summary.failed++;
    } catch (e: any) {
      results.checks.services = {
        status: 'fail',
        message: 'Failed to check services',
        error: e?.message
      };
      results.summary.failed++;
    }

    // Check system metrics
    try {
      const metricsRes = await fetch('http://localhost:3001/api/metrics');
      const metrics = await metricsRes.json();
      const cpuUsage = metrics?.cpu?.approxUsagePercent || 0;
      const memUsage = metrics?.memory?.usedPercent || 0;
      const diskUsage = metrics?.disk?.mounts?.[0]?.usedPercent || 0;
      
      let status = 'pass';
      let warnings = [];
      
      if (cpuUsage > 90) { status = 'fail'; warnings.push('CPU usage critical'); }
      else if (cpuUsage > 80) { status = 'warning'; warnings.push('CPU usage high'); }
      
      if (memUsage > 95) { status = 'fail'; warnings.push('Memory usage critical'); }
      else if (memUsage > 85) { status = 'warning'; warnings.push('Memory usage high'); }
      
      if (diskUsage > 95) { status = 'fail'; warnings.push('Disk usage critical'); }
      else if (diskUsage > 85) { status = 'warning'; warnings.push('Disk usage high'); }
      
      results.checks.metrics = {
        status,
        message: warnings.length ? warnings.join(', ') : 'System metrics healthy',
        details: { cpu: cpuUsage, memory: memUsage, disk: diskUsage }
      };
      
      if (status === 'pass') results.summary.passed++;
      else if (status === 'warning') results.summary.warnings++;
      else results.summary.failed++;
    } catch (e: any) {
      results.checks.metrics = {
        status: 'fail',
        message: 'Failed to check system metrics',
        error: e?.message
      };
      results.summary.failed++;
    }

    // Check database connectivity
    try {
      const testDb = openDb(DEVICEHUB_DB);
      if (!testDb) throw new Error('Database connection failed');
      
      const stmt = testDb.prepare('SELECT 1 as test');
      const result = stmt.get();
      testDb.close();
      
      results.checks.database = {
        status: result?.test === 1 ? 'pass' : 'fail',
        message: result?.test === 1 ? 'Database connectivity OK' : 'Database query failed'
      };
      
      if (result?.test === 1) results.summary.passed++;
      else results.summary.failed++;
    } catch (e: any) {
      results.checks.database = {
        status: 'fail',
        message: 'Database connectivity failed',
        error: e?.message
      };
      results.summary.failed++;
    }

    // Check MQTT configuration (basic check)
    try {
      const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';
      results.checks.mqtt = {
        status: 'pass',
        message: `MQTT configured: ${mqttUrl}`,
        details: { url: mqttUrl }
      };
      results.summary.passed++;
    } catch (e: any) {
      results.checks.mqtt = {
        status: 'fail',
        message: 'MQTT check failed',
        error: e?.message
      };
      results.summary.failed++;
    }

    // Overall health determination
    results.overall = results.summary.failed > 0 ? 'unhealthy' : 
                     results.summary.warnings > 0 ? 'degraded' : 'healthy';

    console.log(`[core-service] Sanity check completed: ${results.overall}`);
    res.json(results);
    
  } catch (e: any) {
    console.error('[core-service] Error during sanity check:', e);
    res.status(500).json({ 
      ok: false, 
      error: e?.message || 'Sanity check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/logs/stream -> SSE stream of logs
// Query: units=comma,separated (optional), since=systemd-time (optional)
app.get('/api/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const units = typeof req.query.units === 'string' && req.query.units
    ? String(req.query.units).split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;

  const args = buildJournalctlArgs({ units, since, follow: true, output: 'json' });
  const proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  proc.stdout.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        send('log', obj);
      } catch {
        send('log', { raw: line });
      }
    }
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    send('stderr', { message: chunk.toString() });
  });
  proc.on('close', (code: number | null) => {
    send('end', { code });
    res.end();
  });

  req.on('close', () => {
    proc.kill('SIGTERM');
  });
});

// Where to serve UI from (imported UI_DIST).
const UI_EXISTS = fs.existsSync(UI_DIST);
const UI_INDEX = path.join(UI_DIST, 'index.html');
const UI_READY = UI_EXISTS && fs.existsSync(UI_INDEX);

// If UI build (with index.html) is missing, provide a minimal dashboard at '/'
if (!UI_READY) {
  app.get('/', (_req: Request, res: Response) => {
    res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Edgeberry Device Hub — Hello World</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;line-height:1.4;margin:2rem;color:#111}
      h1{margin:0 0 0.5rem}
      .muted{color:#666}
      table{border-collapse:collapse;width:100%;margin-top:1rem}
      th,td{border:1px solid #ddd;padding:8px}
      th{background:#f5f5f5;text-align:left}
      .ok{color:#0a7a0a;font-weight:600}
      .bad{color:#b00020;font-weight:600}
      pre{background:#0b1020;color:#e6edf3;padding:12px;border-radius:8px;overflow:auto;max-height:300px}
      .actions{margin:12px 0}
      button{padding:6px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}
      button:hover{background:#f5f5f5}
    </style>
  </head>
  <body>
    <header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <h1 style="margin:0">Edgeberry Device Hub</h1>
        <div class="muted">Hello World demo — core-service serves UI and API</div>
      </div>
      <div id="nav-user" class="muted">Loading user…</div>
    </header>
    <div class="actions">
      <button id="emit">Emit demo hello logs</button>
    </div>
    <h2>Services</h2>
    <table id="svc">
      <thead><tr><th>Unit</th><th>Status</th></tr></thead>
      <tbody></tbody>
    </table>
    <h2>Recent logs</h2>
    <pre id="logs">loading…</pre>
    <h2>Server settings</h2>
    <div id="settings">
      <button id="load-settings">Load settings</button>
      <button id="gen-root">Generate Root CA</button>
      <div><pre id="set-json">(click Load settings)</pre></div>
      <div>
        <input id="prov-name" placeholder="provisioning cert name" />
        <button id="issue-prov">Issue provisioning cert</button>
      </div>
    </div>
    <script>
      async function refreshServices(){
        const res = await fetch('/api/services');
        const data = await res.json();
        const tbody = document.querySelector('#svc tbody');
        tbody.innerHTML = '';
        for (const s of data.services){
          const tr = document.createElement('tr');
          const stOk = s.status === 'active';
          tr.innerHTML = '<td>' + s.unit + '</td><td class="' + (stOk ? 'ok' : 'bad') + '">' + s.status + '</td>';
          tbody.appendChild(tr);
        }
      }
      async function loadLogs(){
        const res = await fetch('/api/logs?lines=100');
        const data = await res.json();
        const el = document.getElementById('logs');
        const lines = data.entries.map(e => {
          const t = e.__REALTIME_TIMESTAMP || e._SOURCE_REALTIME_TIMESTAMP || '';
          const unit = e.SYSLOG_IDENTIFIER || e._SYSTEMD_UNIT || '';
          const msg = e.MESSAGE || JSON.stringify(e);
          return '[' + unit + '] ' + msg;
        });
        el.textContent = lines.join('\n');
      }
      async function emitHello(){
        await fetch('/api/logs/hello', { method: 'POST' });
        setTimeout(loadLogs, 500);
      }
      async function whoAmI(){
        try{
          const r = await fetch('/api/auth/me');
          if(!r.ok) throw new Error('unauth');
          const d = await r.json();
          const el = document.getElementById('nav-user');
          el.innerHTML = 'Signed in as <b>' + (d.user || 'admin') + '</b> · <a href="#" id="logout">Logout</a>';
          document.getElementById('logout').addEventListener('click', async (e)=>{ e.preventDefault(); await fetch('/api/auth/logout',{method:'POST'}); location.reload(); });
        }catch{
          const el = document.getElementById('nav-user');
          el.textContent = 'Not signed in';
        }
      }
      async function loadSettings(){
        const res = await fetch('/api/settings/server');
        const data = await res.json();
        document.getElementById('set-json').textContent = JSON.stringify(data, null, 2);
      }
      async function genRoot(){
        const res = await fetch('/api/settings/certs/root', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const data = await res.json();
        alert('Root CA: ' + (data.error || data.cert));
        loadSettings();
      }
      async function issueProv(){
        const name = document.getElementById('prov-name').value || 'provisioning';
        const res = await fetch('/api/settings/certs/provisioning', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        const data = await res.json();
        alert('Issued: ' + (data.error || data.cert));
        loadSettings();
      }
      document.getElementById('emit').addEventListener('click', emitHello);
      document.getElementById('load-settings').addEventListener('click', loadSettings);
      document.getElementById('gen-root').addEventListener('click', genRoot);
      document.getElementById('issue-prov').addEventListener('click', issueProv);
      refreshServices();
      loadLogs();
      whoAmI();
      setInterval(refreshServices, 5000);
    </script>
  </body>
</html>`);
  });
}

// Serve built UI and SPA fallback only when UI is ready
if (UI_READY) {
  // Serve static assets but do NOT auto-serve index.html here; we inject headers and markup ourselves
  app.use(express.static(UI_DIST, { index: false }));
  // Lightweight admin page available even when UI exists
  app.get('/admin/settings', (_req: Request, res: Response) => {
    res.redirect('/'); // In a future commit, this can serve a dedicated admin page within SPA
  });

  // Inject an auth navbar and hide registration affordances when serving index.html
  function renderInjectedIndex(_req: Request, res: Response) {
    try {
      // Ensure fresh index.html so clients don't cache stale SPA entry
      res.setHeader('Cache-Control', 'no-store');
      let html = fs.readFileSync(UI_INDEX, 'utf8');
      const injectHead = ``;
      const injectBodyEnd = `\n<script>\n(async function(){\n  try{\n    const r = await fetch('/api/auth/me');\n    if(!r.ok) throw new Error();\n    const d = await r.json();\n     // Hide registration affordances (best-effort)\n     const hideSelectors = [\n       'a[href*="register"]', 'a[href*="signup"]', 'a[href*="sign-up"]',\n       '#register', '#signup', '.register', '.signup'\n     ];\n     for (const sel of hideSelectors){ document.querySelectorAll(sel).forEach(el => { (el).style.display = 'none'; }); }\n     // Hide by text content (case-insensitive contains)\n     const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);\n     while (walker.nextNode()){\n       const el = walker.currentNode;\n       if (el && el.textContent && /register|sign\\s*up/i.test(el.textContent)){ try{ el.style.display='none'; }catch{} }\n     }\n   }catch(e){ /* not logged in: let auth middleware show login */ }\n})();\n</script>\n`;
      html = html.replace('</head>', injectHead + '</head>');
      html = html.replace('</body>', injectBodyEnd + '</body>');
      res.type('html').send(html);
    } catch (e) {
      // Fallback
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(UI_INDEX);
    }
  }

  // Root and SPA fallback
  app.get('/', renderInjectedIndex);
  app.get('*', (_req: Request, res: Response, next: NextFunction) => {
    // Serve the SPA index with injection for client-side routes
    renderInjectedIndex(_req, res);
  });
}

// --- WebSocket setup ---
type ClientCtx = { ws: any; topics: Set<string>; logs?: Map<string, any>; authed: boolean };
const clients = new Set<ClientCtx>();

function send(ws: any, msg: any){
  try{ ws.send(JSON.stringify(msg)); }catch{}
}

// Create HTTP server with Express first
const server = http.createServer(app);

// Add upgrade event logging to debug WebSocket handshake
server.on('upgrade', (request, socket, head) => {
  console.log(`[HTTP] Upgrade request: ${request.method} ${request.url}`);
  console.log(`[HTTP] Upgrade headers:`, request.headers);
});

// Create WebSocket server attached to the HTTP server
const wss = new WebSocketServer({ 
  server,
  path: '/api/ws',
  clientTracking: false,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024
});

wss.on('connection', (ws: any, req: any) => {
  console.log(`[WS] Connection event fired, processing...`);
  
  // Check authentication via cookies (same as HTTP requests)
  let authed = false;
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET) as { sub?: string; user?: string; iat?: number; exp?: number };
      const user = payload.user || payload.sub;
      if (user) {
        authed = true;
        console.log(`[WS] Authenticated connection for user: ${user}`);
      }
    }
  } catch (error: any) {
    console.log(`[WS] Authentication failed:`, error?.message || 'unknown error');
  }
  
  if (!authed) {
    console.log(`[WS] Anonymous connection established`);
  }
  
  // Add error handler to catch any connection issues
  ws.on('error', (error: any) => {
    console.error(`[WS] Connection error:`, error);
  });
  
  // Send immediate welcome message to confirm connection works
  try {
    ws.send(JSON.stringify({ 
      type: 'welcome', 
      message: 'WebSocket connected successfully',
      authenticated: authed
    }));
    console.log(`[WS] Sent welcome message (authed=${authed})`);
  } catch (error) {
    console.error(`[WS] Failed to send welcome message:`, error);
  }
  
  const ctx: ClientCtx = { ws, topics: new Set(), logs: new Map(), authed };
  clients.add(ctx);

  ws.on('message', (data: any) => {
    try{
      const msg = JSON.parse(String(data || ''));
      if(msg?.type === 'subscribe' && Array.isArray(msg.topics)){
        for(const raw of msg.topics){ 
          const t = String(raw);
          if(typeof t !== 'string') continue;
          // Anonymous clients: allow only public metrics topics
          if(!ctx.authed){
            if(t === 'metrics.history' || t === 'metrics.snapshots' || t === 'services.status' || t === 'devices.list.public' || t === 'device.status.public'){
              ctx.topics.add(t);
              console.log(`[WS] Anonymous client subscribed to: ${t}`);
            } else {
              console.log(`[WS] Anonymous client denied subscription to: ${t}`);
            }
            continue;
          }  
          // Authenticated: allow full set
          ctx.topics.add(t);
          // Handle logs.stream:<unit>
          if(t.startsWith('logs.stream:')){
            const unit = t.slice('logs.stream:'.length);
            if(isSafeUnit(unit)) startLogStream(ctx, unit, t);
          }
        }
        // Send current history snapshot immediately (default 24h) for anyone subscribed
        if (ctx.topics.has('metrics.history')){
          const hours = 24;
          const cutoff = Date.now() - hours * 3600 * 1000;
          const samples = METRICS_HISTORY.filter(s => s.timestamp >= cutoff);
          send(ws, { type: 'metrics.history', data: { hours, samples } });
        }
        // Send immediate snapshots for services when subscribed (public allowed)
        if (ctx.topics.has('services.status')){
          getServicesSnapshot().then(svcs => send(ws, { type: 'services.status', data: svcs })).catch(()=>{});
        }
        // Send devices list snapshot depending on topic
        if (ctx.authed && ctx.topics.has('devices.list')){
          getDevicesList().then(list => send(ws, { type: 'devices.list', data: list })).catch(()=>{});
        } else if (!ctx.authed && ctx.topics.has('devices.list.public')){
          getDevicesList().then(list => {
            const scrubbed = stripUuidsDeep(list);
            send(ws, { type: 'devices.list.public', data: scrubbed });
          }).catch(()=>{});
        }
      }else if(msg?.type === 'unsubscribe' && Array.isArray(msg.topics)){
        for(const raw of msg.topics){ 
          const t = String(raw);
          ctx.topics.delete(t);
          if(t.startsWith('logs.stream:')){ stopLogStream(ctx, t); }
        }
      }
    }catch{}
  });
  ws.on('close', () => { try{ for(const key of ctx.logs?.keys()||[]) stopLogStream(ctx, key); }catch{} clients.delete(ctx); });
});

function broadcast(topic: string, payload: any){
  for(const c of clients){ if(c.ws.readyState === c.ws.OPEN && c.topics.has(topic)) send(c.ws, payload); }
}

function isSafeUnit(unit: string){
  // allow typical systemd unit charset to prevent shell injection
  return /^[A-Za-z0-9@_.\-]+\.service$/.test(unit) || /^[A-Za-z0-9@_.\-]+$/.test(unit);
}

function startLogStream(ctx: ClientCtx, unit: string, topicKey: string){
  try{
    if(!ctx.logs) ctx.logs = new Map();
    if(ctx.logs.has(topicKey)) return; // already streaming
    if((ctx.logs.size||0) >= 3) return; // simple per-conn cap
    const args = buildJournalctlArgs({ units: [unit], lines: 200, follow: true, output: 'json' });
    const proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (buf: Buffer) => {
      const str = buf.toString('utf8');
      const lines = str.split(/\r?\n/).filter(Boolean);
      for(const ln of lines){
        try{
          const entry = JSON.parse(ln);
          send(ctx.ws, { type: 'logs.line', data: { unit, entry } });
        }catch{
          send(ctx.ws, { type: 'logs.line', data: { unit, entry: { MESSAGE: ln } } });
        }
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', ()=>{});
    proc.on('close', (code: number|null) => { 
      try{ 
        ctx.logs?.delete(topicKey);
        send(ctx.ws, { type: 'logs.stream.end', data: { unit, code } });
      }catch{}
    });
    ctx.logs.set(topicKey, proc);
  }catch{}
}

function stopLogStream(ctx: ClientCtx, topicKey: string){
  try{
    const p = ctx.logs?.get(topicKey);
    if(p){ try{ p.kill('SIGTERM'); }catch{} ctx.logs?.delete(topicKey); }
  }catch{}
}

// Hook to metrics sampler to push updates
const _origSample = sampleMetrics;
// Wrap existing sampler to also broadcast
async function sampleAndBroadcast(){
  await _origSample();
  const latest = METRICS_HISTORY[METRICS_HISTORY.length - 1];
  if(latest){
    broadcast('metrics.snapshots', { type: 'metrics.snapshots', data: latest });
    broadcast('metrics.history', { type: 'metrics.history.append', data: latest });
  }
}
// Replace interval to use our wrapper
// Clear existing interval if any (cannot access id safely); start another interval alongside, harmless since sampleMetrics itself is idempotent per tick.
setInterval(sampleAndBroadcast, METRICS_INTERVAL_MS);

// Periodic services.status broadcast (on change)
let _lastServicesJson = '';
setInterval(async () => {
  try{
    const data = await getServicesSnapshot();
    const js = JSON.stringify(data);
    if(js !== _lastServicesJson){
      _lastServicesJson = js;
      broadcast('services.status', { type: 'services.status', data });
    }
  }catch{}
}, 5000);

// Periodic devices.list broadcast (on change)
let _lastDevicesJson = '';
setInterval(() => {
  try{
    const data = getDevicesListSync();
    const js = JSON.stringify(data);
    if(js !== _lastDevicesJson){
      _lastDevicesJson = js;
      // Authenticated topic
      broadcast('devices.list', { type: 'devices.list', data });
      // Public topic with UUIDs scrubbed
      const publicData = stripUuidsDeep(data);
      broadcast('devices.list.public', { type: 'devices.list.public', data: publicData });
    }
  }catch{}
}, 10000);

// Graceful shutdown
function setupShutdown(){
  const onSig = (sig: string) => () => {
    try{ console.log(`[core-service] received ${sig}, shutting down`); }catch{}
    try{ 
      if (mqttClient) {
        mqttClient.end();
      }
    }catch{}
    try{ server.close(() => { process.exit(0); }); }catch{ try{ process.exit(0); }catch{} }
    // Fallback exit if close hangs
    setTimeout(() => { try{ process.exit(0); }catch{} }, 3000);
  };
  process.on('SIGINT', onSig('SIGINT'));
  process.on('SIGTERM', onSig('SIGTERM'));
}
setupShutdown();

// Start D-Bus services and ensure provisioning certificates exist
async function startDbusServices() {
  try {
    console.log(`[core-service] Starting D-Bus services...`);
    
    // Create system bus connection and register the Core bus name
    const dbus = await import('dbus-native');
    const bus = dbus.systemBus();
    
    // Register the main bus name
    bus.requestName('io.edgeberry.devicehub.Core', 0, (err: any, res: any) => {
      if (err) {
        console.error('D-Bus Core service name acquisition failed:', err);
      } else {
        console.log('D-Bus Core service name "io.edgeberry.devicehub.Core" successfully acquired');
      }
    });
    
    // Start individual services using the shared bus connection
    console.log(`[core-service] Starting WhitelistService...`);
    await startWhitelistDbusServer(bus);
    console.log(`[core-service] Starting CertificateService...`);
    await startCertificateDbusServer(bus);
    console.log(`[core-service] Starting TwinService...`);
    await startCoreTwinDbusServer(bus);
    console.log(`[core-service] Starting DevicesService...`);
    await startDevicesDbusServer(bus);
    console.log(`[core-service] D-Bus services started successfully`);
    
    // Ensure provisioning certificates exist for device bootstrap
    try {
      await generateProvisioningCert();
      console.log(`[core-service] Provisioning certificates ensured`);
    } catch (error) {
      console.warn(`[core-service] Failed to generate provisioning certificates:`, error);
    }
  } catch (error) {
    console.error(`[core-service] Failed to start D-Bus services:`, error);
    console.error(`[core-service] D-Bus error details:`, (error as Error).stack || error);
  }
}  
// Initialize D-Bus services before starting HTTP server
startDbusServices().then(() => {
  // Set up the broadcast function for device status updates
  setBroadcastFunction(broadcast);
  
  // Initialize MQTT client for direct method forwarding
  initMqttClient();
  
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[core-service] listening on :${PORT}, UI_DIST=${UI_DIST}`);
  });
}).catch((error) => {
  console.error(`[core-service] Startup failed:`, error);
  process.exit(1);
});
