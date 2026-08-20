/**
 * Edgeberry Device Hub — main entrypoint
 * ---------------------------------------------
 * Purpose
 * - Single process running the whole Device Hub. Serves the SPA and the
 *   admin HTTP(S) API + WebSocket on PORT (3000), and starts three internal
 *   sub-services, each a self-contained module under src/services/:
 *     - provisioning/  device claim-certificate handshake over MQTT
 *     - twin/          device twins + connection status over MQTT
 *     - application/   REST/WS interface for external apps, on its own
 *                      APPLICATION_PORT (8090)
 *   They share state through the plain store modules (devices-store,
 *   twin-store, whitelist-store, token-store, event-store, app-settings) -
 *   direct function calls, no IPC. Each sub-service opens its own MQTT
 *   connection, matching what the previously-separate processes did.
 *
 * Responsibilities (this file)
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
import { hashPassword, verifyPassword, validatePasswordStrength } from './password.js';
import {
  SERVICE,
  NODE_ENV,
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
  MQTT_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TLS_CA,
  MQTT_TLS_CERT,
  MQTT_TLS_KEY,
  MQTT_TLS_REJECT_UNAUTHORIZED,
} from './config.js';
import { ensureDirs, caExists, generateRootCA, readCertMeta, generateProvisioningCert, ensureCRLExists, revokeCertificatesForUuid, regenerateCRL } from './certs.js';
import { buildJournalctlArgs } from './logs.js';
import { authRequired, clearSessionCookie, getSession, parseCookies, setSessionCookie } from './auth.js';
import { createTerminalService } from './terminal.js';
import { validateDeviceName } from './device-names.js';
import { getTwin as getDeviceTwin, deleteDeviceEvents as deleteTwinDeviceEvents } from './twin-store.js';
import { getDevicesListSync, tryParseJson, normalizeGroups, setGroupsForRole, getGroupsForRole, listGroups } from './devices-store.js';
import { getAppSetting, setAppSetting, isAuthDisabled, isWebTerminalEnabled } from './app-settings.js';
import { startProvisioning } from './services/provisioning/mqtt.js';
import { startTwin } from './services/twin/mqtt.js';
import { startApplication, getConnectionStatus as getApplicationConnectionStatus, notifyIdentityTransfer } from './services/application/index.js';

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

async function sendDirectMethod(deviceId: string, methodName: string, payload: any = {}): Promise<any> {
  if (!mqttClient || !mqttClient.connected) {
    console.error(`[${SERVICE}] MQTT client not connected, cannot send direct method`);
    return { success: false, error: 'MQTT client not connected' };
  }

  // Generate unique request ID
  const requestId = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  
  // Topic patterns
  const requestTopic = `$devicehub/devices/${deviceId}/methods/${methodName}/request`;
  const responseTopic = `$devicehub/devices/${deviceId}/methods/${methodName}/response`;
  
  const message = {
    requestId: requestId,
    payload: payload
  };

  console.log(`[${SERVICE}] Sending direct method '${methodName}' to device ${deviceId}`);
  console.log(`[${SERVICE}] Request ID: ${requestId}`);
  console.log(`[${SERVICE}] Request Topic: ${requestTopic}`);
  console.log(`[${SERVICE}] Response Topic: ${responseTopic}`);
  console.log(`[${SERVICE}] Message:`, JSON.stringify(message, null, 2));

  return new Promise((resolve) => {
    // Set up timeout for response
    const timeout = setTimeout(() => {
      console.log(`[${SERVICE}] Direct method '${methodName}' timeout for device ${deviceId}`);
      mqttClient!.unsubscribe(responseTopic);
      resolve({ success: false, error: 'Method call timeout', requestId: requestId });
    }, 30000); // 30 second timeout

    // Subscribe to response topic first
    mqttClient!.subscribe(responseTopic, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[${SERVICE}] Failed to subscribe to response topic:`, err);
        clearTimeout(timeout);
        resolve({ success: false, error: 'Failed to subscribe to response topic' });
        return;
      }

      // Set up one-time response handler
      const responseHandler = (topic: string, message: Buffer) => {
        if (topic === responseTopic) {
          try {
            const response = JSON.parse(message.toString());
            console.log(`[${SERVICE}] Received direct method response for '${methodName}' from device ${deviceId}:`, response);
            
            // Check if this response matches our request
            if (response.requestId === requestId) {
              clearTimeout(timeout);
              mqttClient!.unsubscribe(responseTopic);
              mqttClient!.removeListener('message', responseHandler);
              
              // Return the response from the device
              resolve({
                success: true,
                status: response.status || 200,
                payload: response.payload,
                message: response.message,
                requestId: requestId
              });
            }
          } catch (error) {
            console.error(`[${SERVICE}] Error parsing direct method response:`, error);
          }
        }
      };

      mqttClient!.on('message', responseHandler);

      // Now send the request
      mqttClient!.publish(requestTopic, JSON.stringify(message), { qos: 0 }, (error) => {
        if (error) {
          console.error(`[${SERVICE}] Failed to send direct method '${methodName}' to device ${deviceId}:`, error);
          clearTimeout(timeout);
          mqttClient!.unsubscribe(responseTopic);
          mqttClient!.removeListener('message', responseHandler);
          resolve({ success: false, error: 'Failed to publish method request' });
        } else {
          console.log(`[${SERVICE}] Direct method '${methodName}' sent to device ${deviceId}, waiting for response...`);
        }
      });
    });
  });
}

const app = express();
// Disable ETag so API responses (e.g., /api/auth/me) aren't served as 304 Not Modified
app.set('etag', false);
// Trust proxy when behind reverse proxy (Nginx) - allows correct client IP, protocol detection
if (NODE_ENV === 'production') {
  app.set('trust proxy', true);
}
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
    console.log('[devicehub] HIT /api/provisioning/certs/ca.crt');
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

// GET /api/provisioning/certs/provisioning.crt -> serve provisioning (claim) client cert.
// Gated by the provisioning_cert_fetch_enabled app setting - see
// isProvisioningCertFetchEnabled(). Off by admin choice, not by default: this
// stays public until an operator opts into installing the claim cert on
// devices some other way and closes this endpoint.
app.get('/api/provisioning/certs/provisioning.crt', async (_req: Request, res: Response) => {
  try {
    if (!isProvisioningCertFetchEnabled()) {
      res.status(403).json({ error: 'cert_fetch_disabled', message: 'Fetching the claim certificate over HTTP is disabled. Provision this device out-of-band.' });
      return;
    }
    console.log('[devicehub] HIT /api/provisioning/certs/provisioning.crt');
    const provisioningCertPath = path.join(PROV_DIR, 'provisioning.crt');
    if (!fs.existsSync(provisioningCertPath)) { res.status(404).end('not found'); return; }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="provisioning.crt"');
    const certContent = fs.readFileSync(provisioningCertPath, 'utf8');
    res.send(certContent);
  } catch (err) {
    console.error('[devicehub] Error serving provisioning cert:', err);
    res.status(500).end('server error');
  }
});

// NOTE: Public alias without /api removed (policy: all API under /api)

// GET /api/provisioning/certs/provisioning.key -> serve provisioning (claim) client key.
// Same gate as provisioning.crt above - the two are one credential and are
// switched together.
app.get('/api/provisioning/certs/provisioning.key', async (_req: Request, res: Response) => {
  try {
    if (!isProvisioningCertFetchEnabled()) {
      res.status(403).json({ error: 'cert_fetch_disabled', message: 'Fetching the claim certificate over HTTP is disabled. Provision this device out-of-band.' });
      return;
    }
    console.log('[devicehub] HIT /api/provisioning/certs/provisioning.key');
    const provisioningKeyPath = path.join(PROV_DIR, 'provisioning.key');
    if (!fs.existsSync(provisioningKeyPath)) { res.status(404).end('not found'); return; }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="provisioning.key"');
    const keyContent = fs.readFileSync(provisioningKeyPath, 'utf8');
    res.send(keyContent);
  } catch (err) {
    console.error('[devicehub] Error serving provisioning key:', err);
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
      console.log('[devicehub] UI_DIST:', UI_DIST);
      const uiIndexPath = path.join(UI_DIST, 'index.html');
      const st = fs.statSync(uiIndexPath);
      console.log('[devicehub] UI index.html:', uiIndexPath, 'mtime=', st.mtime.toISOString(), 'size=', st.size);
    } catch {
      console.log('[devicehub] UI index.html not found under UI_DIST:', path.join(UI_DIST, 'index.html'));
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

// GET /api/devices/:uuid/twin -> fetch twin state (desired/reported)
app.get('/api/devices/:uuid/twin', authRequired, async (req: Request, res: Response) => {
  try {
    const deviceUuid = String(req.params.uuid || '').trim();
    if (!deviceUuid) { res.status(400).json({ error: 'invalid device uuid' }); return; }
    // Twin docs are keyed by the device's assigned MQTT name, not its uuid -
    // same resolution as the identify direct-method handler above.
    const db = openDb(DEVICEHUB_DB);
    let deviceId = deviceUuid;
    if (db) {
      try {
        const row = db.prepare('SELECT name FROM devices WHERE uuid = ?').get(deviceUuid) as any;
        if (row?.name) deviceId = row.name;
      } finally { try { db.close(); } catch {} }
    }
    const { desired, reported } = getDeviceTwin(deviceId);
    res.json({ deviceUuid, desired, reported });
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
app.get('/api/status', authRequired, (_req: Request, res: Response) => {
  try {
    const status = {
      uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
      uptimeSeconds: Math.floor(os.uptime()),
      processUptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
      processUptimeSeconds: Math.floor(process.uptime()),
      loadAverage: os.loadavg(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      // Lets the UI show the Terminal button as switched off rather than
      // broken. Reported on this authenticated route rather than
      // /api/config/public: whether a host offers a shell is not something to
      // tell anonymous callers.
      webTerminalEnabled: isWebTerminalEnabled()
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
    const mosquittoVersion = await getMosquittoVersion();

    const versionInfo = {
      service: name,
      version,
      name,
      git: version, // alias for compatibility
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      components: {
        mosquitto: mosquittoVersion
      }
    };
    res.json(versionInfo);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to get version' });
  }
});

// Log a startup hello from core-service
console.log('[devicehub] hello from Device Hub core-service');
// Ensure provisioning DB schema exists (uuid_whitelist etc.) before exposing D-Bus API
try { 
  ensureDeviceHubSchema(); 
} catch (error) {
  console.error('[devicehub] Failed to initialize database schema:', error);
}
// Device connection tracking is handled by the twin sub-service via MQTT
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
// Checks database first for hashed password, falls back to env var for backward compatibility
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  
  if (!username || !password) {
    res.status(401).json({ ok: false, error: 'invalid credentials' });
    return;
  }

  let authenticated = false;
  let userExistsInDb = false;
  
  // Try database first (with hashed password)
  const db = openDb(DEVICEHUB_DB);
  if (db) {
    try {
      const user = db.prepare('SELECT username, password_hash FROM users WHERE username = ?').get(username) as { username: string; password_hash: string } | undefined;
      if (user) {
        // User exists in DB, verify hashed password
        userExistsInDb = true;
        authenticated = await verifyPassword(password, user.password_hash);
      }
    } catch (e) {
      console.error('[devicehub] Error checking database for user:', e);
    } finally {
      try { db.close(); } catch {}
    }
  }
  
  // Only fallback to environment variable if user doesn't exist in DB
  // This prevents old env password from working after password change
  if (!authenticated && !userExistsInDb && username === ADMIN_USER && password === ADMIN_PASSWORD) {
    authenticated = true;
  }
  
  if (authenticated) {
    const token = jwt.sign({ user: username }, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_TTL_SECONDS, subject: username });
    const decoded = jwt.decode(token) as { exp?: number };
    setSessionCookie(res, token);
    res.json({ ok: true, user: username, exp: decoded?.exp });
  } else {
    res.status(401).json({ ok: false, error: 'invalid credentials' });
  }
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  // With JWT, we clear the cookie; server does not need to track state
  clearSessionCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/refresh -> renew JWT token with fresh expiration
app.post('/api/auth/refresh', (req: Request, res: Response) => {
  const s = getSession(req);
  if (!s) { 
    res.status(401).json({ ok: false, error: 'unauthorized' }); 
    return; 
  }
  // Issue a new token with fresh expiration
  const token = jwt.sign({ user: s.user }, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_TTL_SECONDS, subject: s.user });
  const decoded = jwt.decode(token) as { exp?: number };
  setSessionCookie(res, token);
  res.json({ ok: true, user: s.user, exp: decoded?.exp });
});

// GET /api/auth/me -> verify cookie and report authentication status
app.get('/api/auth/me', (req: Request, res: Response) => {
  if (isAuthDisabled()) {
    res.json({ authenticated: true, user: ADMIN_USER, authDisabled: true });
    return;
  }
  const s = getSession(req);
  if (!s) { res.status(401).json({ authenticated: false }); return; }
  res.json({ authenticated: true, user: s.user, exp: s.exp });
});

// POST /api/auth/change-password -> change admin password (requires authentication)
app.post('/api/auth/change-password', authRequired, async (req: Request, res: Response) => {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    res.status(400).json({ ok: false, error: 'currentPassword and newPassword are required' });
    return;
  }

  // Validate new password strength
  const validationError = validatePasswordStrength(newPassword);
  if (validationError) {
    res.status(400).json({ ok: false, error: validationError });
    return;
  }

  const db = openDb(DEVICEHUB_DB);
  if (!db) {
    res.status(500).json({ ok: false, error: 'database unavailable' });
    return;
  }

  try {
    // Verify current password first
    let currentPasswordValid = false;
    const user = db.prepare('SELECT username, password_hash FROM users WHERE username = ?').get(s.user) as { username: string; password_hash: string } | undefined;
    
    if (user) {
      // User exists in DB, verify hashed password
      currentPasswordValid = await verifyPassword(currentPassword, user.password_hash);
    } else {
      // User not in DB yet, verify against env var
      if (s.user === ADMIN_USER && currentPassword === ADMIN_PASSWORD) {
        currentPasswordValid = true;
      }
    }

    if (!currentPasswordValid) {
      res.status(401).json({ ok: false, error: 'current password is incorrect' });
      return;
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update or insert user with new password
    if (user) {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?').run(newPasswordHash, s.user);
    } else {
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(s.user, newPasswordHash);
    }

    console.log(`[devicehub] Password updated for user: ${s.user}`);
    res.json({ ok: true, message: 'password updated successfully' });
  } catch (e: any) {
    console.error('[devicehub] Error changing password:', e);
    res.status(500).json({ ok: false, error: e?.message || 'failed to change password' });
  } finally {
    try { db.close(); } catch {}
  }
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

// Default true: preserves today's behaviour (any device can fetch the claim
// cert over HTTP to bootstrap itself) for existing deployments. Turning it
// off is an opt-in hardening step for operators who provision the claim
// cert into devices out-of-band instead (at manufacture time, over a
// physical connection, etc.) and want to close the open HTTP endpoint that
// would otherwise let anyone who can reach the Hub download it too.
const PROVISIONING_CERT_FETCH_KEY = 'provisioning_cert_fetch_enabled';
function isProvisioningCertFetchEnabled(): boolean {
  return getAppSetting(PROVISIONING_CERT_FETCH_KEY, '1') !== '0';
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
      // `note` is deliberately NOT a legacy marker any more, even though the
      // legacy schema had a column by that name. It is a current column again
      // (see the additive migration below), and this branch DROPS THE TABLE -
      // leaving it here would delete every note on the next boot after it was
      // added. The legacy schema carried device_id and name too, so either of
      // those still identifies it unambiguously.
      const hasLegacyColumns = whitelistInfo.some((col: any) => col.name === 'device_id' || col.name === 'name');
      const hasHardwareVersion = whitelistInfo.some((col: any) => col.name === 'hardware_version');
      const hasManufacturer = whitelistInfo.some((col: any) => col.name === 'manufacturer');
      const hasNewColumns = hasHardwareVersion && hasManufacturer;
      
      if (hasLegacyColumns || !hasNewColumns) {
        console.log('[ensureDeviceHubSchema] Migrating uuid_whitelist table to new schema');
        // The legacy schema had a `note` column meaning exactly what the current
        // one means, so carry it across rather than dropping it on the floor -
        // it is the one legacy field a human actually wrote by hand.
        const hasLegacyNote = whitelistInfo.some((col: any) => col.name === 'note');
        // Backup data, drop table, recreate with correct schema
        const existingData = db.prepare(
          `SELECT uuid, created_at, used_at, ${hasLegacyNote ? 'note' : 'NULL AS note'} FROM uuid_whitelist`
        ).all();
        db.prepare('DROP TABLE uuid_whitelist').run();

        db.prepare(
          'CREATE TABLE uuid_whitelist ('+
          ' uuid TEXT PRIMARY KEY,'+
          ' hardware_version TEXT NOT NULL,'+
          ' manufacturer TEXT NOT NULL,'+
          ' created_at TEXT NOT NULL,'+
          ' used_at TEXT,'+
          ' note TEXT)'
        ).run();

        // Restore data with new schema (set default values for new fields)
        const insertStmt = db.prepare('INSERT INTO uuid_whitelist (uuid, hardware_version, manufacturer, created_at, used_at, note) VALUES (?, ?, ?, ?, ?, ?)');
        for (const row of existingData) {
          insertStmt.run(row.uuid, 'Unknown', 'Unknown', row.created_at, row.used_at, row.note ?? null);
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

    // Additive migration: a disabled entry is rejected by CheckUUID same as
    // a used one, but reversibly - re-enabling clears it. A plain ADD COLUMN
    // (nullable, no default) rather than the drop-and-recreate migration
    // above, since existing rows are all "not disabled" by omission.
    try {
      const whitelistInfo = db.prepare('PRAGMA table_info(uuid_whitelist)').all();
      const hasDisabledAt = whitelistInfo.some((col: any) => col.name === 'disabled_at');
      if (!hasDisabledAt) {
        db.prepare('ALTER TABLE uuid_whitelist ADD COLUMN disabled_at TEXT').run();
        console.log('[ensureDeviceHubSchema] Added disabled_at column to uuid_whitelist');
      }
    } catch (e) {
      console.error('[ensureDeviceHubSchema] Failed to add disabled_at column:', e);
    }

    // Additive migration: a free-text note against a whitelist entry, so a UUID
    // can be identified by something a human recognises ("Freya's vivarium",
    // "batch 3, DOA") before it has ever provisioned and earned a device name.
    // Nullable with no default - existing rows simply have no note.
    try {
      const whitelistInfo = db.prepare('PRAGMA table_info(uuid_whitelist)').all();
      const hasNote = whitelistInfo.some((col: any) => col.name === 'note');
      if (!hasNote) {
        db.prepare('ALTER TABLE uuid_whitelist ADD COLUMN note TEXT').run();
        console.log('[ensureDeviceHubSchema] Added note column to uuid_whitelist');
      }
    } catch (e) {
      console.error('[ensureDeviceHubSchema] Failed to add note column:', e);
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

    // device_roles: a persistent, admin-chosen label pointing at a device's
    // uuid - kept in its own table (not a column on devices) because
    // claimDeviceName (devices-store.ts) resets the devices row's mutable
    // columns on every reprovision; anything that must survive that lives
    // elsewhere. UNIQUE(uuid) keeps the role->device mapping 1:1 so
    // uuid->role translation (the application sub-service) never has to pick
    // between candidates.
    db.prepare(
      'CREATE TABLE IF NOT EXISTS device_roles ('+
      ' role TEXT PRIMARY KEY,'+
      ' uuid TEXT NOT NULL UNIQUE,'+
      ' created_at TEXT DEFAULT CURRENT_TIMESTAMP,'+
      ' updated_at TEXT DEFAULT CURRENT_TIMESTAMP)'
    ).run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_device_roles_uuid ON device_roles(uuid)').run();

    // device_groups: free-form operator tags, many-to-many, so applications
    // can address a fleet by what devices *are* ("all freezers", or a
    // `user-<id>` tag marking which customer owns them) instead of having to
    // enumerate identifiers.
    //
    // Keyed on the *role* - the application-facing id - not on the hardware
    // uuid. The chain is group -> application id -> hardware uuid, and only
    // the last link moves: a hardware swap repoints a role at a replacement
    // unit. Tagging the hardware would mean a swapped-in unit silently
    // dropped out of every group the old one was in, which for an ownership
    // tag means a customer losing sight of their own device. Tagging the
    // application id makes the grouping survive the swap for free, because
    // the thing the tag is attached to is exactly the thing that moved.
    //
    // No FOREIGN KEY onto device_roles: device_events shows what that costs
    // (every membership row becomes something that blocks deleting or
    // re-claiming). Rows are dropped explicitly when a role is cleared or its
    // device decommissioned.
    db.prepare(
      'CREATE TABLE IF NOT EXISTS device_groups ('+
      ' role TEXT NOT NULL,'+
      ' group_name TEXT NOT NULL,'+
      ' created_at TEXT DEFAULT CURRENT_TIMESTAMP,'+
      ' PRIMARY KEY (role, group_name))'
    ).run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_device_groups_group ON device_groups(group_name)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_device_groups_role ON device_groups(role)').run();

    // app_settings: small generic key/value store for admin-toggleable
    // settings that need to persist and be flippable at runtime from the UI
    // (as opposed to env vars, which are deploy-time only). First user: the
    // claim-certificate HTTP fetch switch (see PROVISIONING_CERT_FETCH_KEY).
    db.prepare(
      'CREATE TABLE IF NOT EXISTS app_settings ('+
      ' key TEXT PRIMARY KEY,'+
      ' value TEXT NOT NULL)'
    ).run();

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

    // users: admin user table for password management
    // Stores hashed passwords. Falls back to ADMIN_PASSWORD env var if no users in DB.
    db.prepare(
      'CREATE TABLE IF NOT EXISTS users ('+
      ' username TEXT PRIMARY KEY,'+
      ' password_hash TEXT NOT NULL,'+
      ' created_at TEXT DEFAULT CURRENT_TIMESTAMP,'+
      ' updated_at TEXT DEFAULT CURRENT_TIMESTAMP)'
    ).run();
    console.log('[ensureDeviceHubSchema] Users table ready');

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
app.get('/api/devices', authRequired, (req: Request, res: Response) => {
  const list = getDevicesListSync();
  res.json(list);
});

// GET /api/devices/:uuid -> single device
app.get('/api/devices/:uuid', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(404).json({ error: 'not found' }); return; }
  try{
    const row = db.prepare('SELECT uuid, name, token, meta, created_at FROM devices WHERE uuid = ?').get(uuid);
    if(!row){ res.status(404).json({ error: 'not found' }); return; }
    const roleRow = db.prepare('SELECT role FROM device_roles WHERE uuid = ?').get(uuid) as any;
    const lastSeen = getLastSeenMap();
    const ls = lastSeen[uuid];
    const online = ls ? (Date.now() - Date.parse(ls)) / 1000 <= ONLINE_THRESHOLD_SECONDS : false;
    res.json({ uuid: row.uuid, name: row.name, role: roleRow?.role ?? null, token: row.token, meta: tryParseJson(row.meta), created_at: row.created_at, last_seen: ls || null, online });
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
    console.error('[devicehub] Failed to list API tokens:', e);
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
    console.error('[devicehub] Failed to create API token:', e);
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
    console.error('[devicehub] Failed to delete API token:', e);
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
    console.error('[devicehub] Failed to update API token:', e);
    res.status(500).json({ error: 'failed_to_update_token' });
  } finally {
    try { db.close(); } catch {}
  }
});

// GET /api/tokens/:id/reveal -> reveal the actual token value (admin only)
app.get('/api/tokens/:id/reveal', authRequired, (req: Request, res: Response) => {
  const { id } = req.params;
  
  if (!id) { 
    res.status(400).json({ error: 'token_id_required' }); 
    return; 
  }
  
  const db = openDb(DEVICEHUB_DB);
  if (!db) { res.status(500).json({ error: 'db_unavailable' }); return; }
  
  try {
    const tokenData = db.prepare('SELECT token FROM api_tokens WHERE id = ?').get(id) as any;
    
    if (!tokenData) {
      res.status(404).json({ error: 'token_not_found' });
    } else {
      res.json({ token: tokenData.token });
    }
  } catch (e: any) {
    console.error('[devicehub] Failed to reveal API token:', e);
    res.status(500).json({ error: 'failed_to_reveal_token' });
  } finally {
    try { db.close(); } catch {}
  }
});

// GET /api/applications/connections -> active WebSocket connections held by
// the application sub-service (direct in-process call)
app.get('/api/applications/connections', authRequired, (req: Request, res: Response) => {
  try {
    res.json(getApplicationConnectionStatus());
  } catch (e: any) {
    console.error('[devicehub] Failed to get active connections:', e.message);
    // Return empty connections instead of error to keep UI functional
    res.json({ totalConnections: 0, activeApplications: 0, connections: [] });
  }
});

// DELETE /api/devices/:uuid -> decommission device
app.delete('/api/devices/:uuid', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  if (!uuid) { res.status(400).json({ error: 'invalid_device_uuid' }); return; }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try {
    // Twin connection-status events are keyed by the device's assigned MQTT
    // name (see twin-store.ts), not its uuid - resolve before deleting the
    // devices row out from under that lookup.
    const deviceRow = db.prepare('SELECT name FROM devices WHERE uuid = ?').get(uuid) as any;
    // devicehub.db's own device_events table has a foreign key onto
    // devices(uuid), so its rows must go first - otherwise deleting the
    // device fails outright with SQLITE_CONSTRAINT_FOREIGNKEY for any device
    // that ever reported telemetry or an event (i.e. every device that has
    // actually been in service). This is separate from the twin database's
    // connection-status events cleaned up below, which are keyed by name.
    db.prepare('DELETE FROM device_events WHERE device_id = ?').run(uuid);
    // Release the device's role, and with it that application id's groups.
    // device_roles has no foreign key, so a leftover row doesn't error - it
    // just keeps the role name permanently reserved and still resolving (via
    // resolveIdentifierToUuid) to a device that no longer exists. Decommission
    // retires the application identity outright, unlike a swap where the role
    // survives on new hardware and must keep its tags.
    const retiredRole = db.prepare('SELECT role FROM device_roles WHERE uuid = ?').get(uuid) as any;
    db.prepare('DELETE FROM device_roles WHERE uuid = ?').run(uuid);
    if (retiredRole?.role) {
      db.prepare('DELETE FROM device_groups WHERE role = ?').run(retiredRole.role);
    }
    const info = db.prepare('DELETE FROM devices WHERE uuid = ?').run(uuid);
    // Return also how many whitelist entries exist for this device so UI can
    // prompt follow-up removal. Keyed by `uuid` - uuid_whitelist has no
    // device_id column, so the old query threw "no such column" *after* the
    // DELETE above had already committed: the device really was decommissioned
    // but the caller got a 500 and the UI reported failure.
    const wlCount = db.prepare('SELECT COUNT(1) as c FROM uuid_whitelist WHERE uuid = ?').get(uuid)?.c || 0;
    if (deviceRow?.name) {
      try {
        deleteTwinDeviceEvents(deviceRow.name);
      } catch (e) {
        console.error('[devicehub] Failed to remove device connection-status history:', e);
      }
    }
    res.json({ ok: true, removed: info.changes || 0, whitelist_entries: Number(wlCount) });
  } catch (e:any) {
    res.status(500).json({ error: 'decommission_failed', message: e?.message || 'failed' });
  } finally {
    try{ db.close(); }catch{}
  }
});

// Roles: a persistent, admin-chosen label pointing at a device's uuid (see
// device_roles in ensureDeviceHubSchema). This replaces both the old raw
// rename endpoint (PUT /api/devices/:uuid, which mutated the live MQTT/TLS
// identity via a bare SQL UPDATE with no cert/ACL sync) and "Replace Device"
// (POST /api/devices/:uuid/replace, which grafted one device's uuid onto
// another row, discarding the target's own identity, and never touched
// twin.db or uuid_whitelist). A hardware swap is now: repoint the role's
// uuid at the new device - neither device row is ever mutated or deleted.

// GET /api/roles -> list roles with their current device's name/online status
app.get('/api/roles', authRequired, (req: Request, res: Response) => {
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try {
    const rows = db.prepare(
      'SELECT r.role, r.uuid, r.created_at, r.updated_at, d.name AS device_name '+
      'FROM device_roles r LEFT JOIN devices d ON d.uuid = r.uuid '+
      'ORDER BY r.role'
    ).all() as any[];
    const lastSeen = getLastSeenMap();
    const roles = rows.map(r => {
      const ls = lastSeen[r.uuid];
      const online = ls ? (Date.now() - Date.parse(ls)) / 1000 <= ONLINE_THRESHOLD_SECONDS : false;
      return { role: r.role, uuid: r.uuid, device_name: r.device_name ?? null, online, last_seen: ls || null, created_at: r.created_at, updated_at: r.updated_at };
    });
    res.json({ roles });
  } catch (e:any) {
    res.status(500).json({ error: 'list_failed', message: e?.message || 'failed' });
  } finally {
    try{ db.close(); }catch{}
  }
});

// PUT /api/devices/:uuid/role -> set (or clear) this device's role
//
// A device holds at most one role at a time (device_roles.uuid is UNIQUE),
// so from the device's side this is really just one action: "this jack is
// now labeled X" - like plugging a phone line into a labeled jack on a
// switchboard. Whatever label this device wore before is unplugged first;
// if the new label was already plugged into a different device, that
// device silently loses it (the hardware-swap case - the label follows
// wherever it's plugged in, it can't be in two places at once). No
// create/rename/reassign split, no conflict responses to branch on - one
// endpoint, one outcome.
app.put('/api/devices/:uuid/role', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
  if (!uuid) { res.status(400).json({ error: 'invalid_device_uuid' }); return; }
  if (role) {
    const validation = validateDeviceName(role);
    if (!validation.valid) { res.status(400).json({ error: 'invalid_role_name', message: validation.error }); return; }
  }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try {
    // A role can be assigned before the hardware has ever connected, as long as
    // the uuid is whitelisted. That is the useful order of operations for a
    // replacement: whitelist the new board, hand it the identity it is going to
    // take over, then let it provision - it comes up already being the thing it
    // was sent out to be, with no window where it is online but anonymous and
    // no second trip to the UI once it appears. Roles live in their own table
    // keyed by uuid, so provisioning later simply finds the role already there.
    // Still gated on the whitelist: without that, a typo'd uuid would silently
    // create a role pointing at hardware that can never exist.
    const device = db.prepare('SELECT uuid FROM devices WHERE uuid = ?').get(uuid);
    if (!device) {
      const whitelisted = db.prepare('SELECT uuid FROM uuid_whitelist WHERE uuid = ?').get(uuid);
      if (!whitelisted) { res.status(404).json({ error: 'device_not_found' }); return; }
    }

    // If this role currently belongs to a *different* hardware uuid, this call
    // is a hardware swap: that device loses the role the moment this commits.
    // That transfer is the intended mechanic (the label follows wherever it is
    // plugged in), but it used to happen invisibly. Report who lost it - and
    // which groups it carried - so the caller and the UI's confirmation step
    // can state plainly what was taken over.
    let takenFrom: { uuid: string; name: string | null } | null = null;
    if (role) {
      const current = db.prepare(
        'SELECT r.uuid AS uuid, d.name AS name FROM device_roles r '+
        'LEFT JOIN devices d ON d.uuid = r.uuid WHERE r.role = ?'
      ).get(role) as any;
      if (current && current.uuid !== uuid) {
        takenFrom = { uuid: current.uuid, name: current.name ?? null };
      }
    }

    // Whatever role this device is giving up. If no other device picks it up,
    // that application identity is retired and its groups go with it - a
    // swap, by contrast, never reaches here for the surviving role.
    const previousRole = db.prepare('SELECT role FROM device_roles WHERE uuid = ?').get(uuid) as any;

    const setRole = db.transaction(() => {
      db.prepare('DELETE FROM device_roles WHERE uuid = ?').run(uuid);
      if (role) {
        db.prepare(
          'INSERT INTO device_roles (role, uuid) VALUES (?, ?) '+
          'ON CONFLICT(role) DO UPDATE SET uuid = excluded.uuid, updated_at = CURRENT_TIMESTAMP'
        ).run(role, uuid);
      }
      // Groups hang off the role, so a transfer carries them across on its
      // own - nothing to copy here. Only a role being genuinely retired (this
      // device dropped it and no other device holds it) releases its tags, so
      // a future, unrelated device given the same role name doesn't silently
      // inherit a previous owner's `user-<id>`.
      if (previousRole?.role && previousRole.role !== role) {
        const stillHeld = db.prepare('SELECT 1 FROM device_roles WHERE role = ?').get(previousRole.role);
        if (!stillHeld) db.prepare('DELETE FROM device_groups WHERE role = ?').run(previousRole.role);
      }
    });
    setRole();
    const currentGroups = role ? getGroupsForRole(role) : [];
    if (takenFrom && role) {
      console.log(`[devicehub] role "${role}" transferred from ${takenFrom.name || takenFrom.uuid} to ${uuid} (groups follow the role)`);
      // Applications address this device by an id that just changed hardware
      // underneath it. Nothing they hold becomes invalid, but the substitution
      // is worth telling them about rather than making them infer it.
      try {
        const newDevice = db.prepare('SELECT name FROM devices WHERE uuid = ?').get(uuid) as any;
        notifyIdentityTransfer({
          deviceId: role,
          previousUuid: takenFrom.uuid,
          previousName: takenFrom.name,
          newUuid: uuid,
          newName: newDevice?.name || uuid,
          groups: currentGroups
        });
      } catch (e) {
        console.warn('[devicehub] failed to notify applications of identity transfer:', (e as Error).message);
      }
    }
    res.json({
      ok: true,
      uuid,
      role: role || null,
      taken_from: takenFrom,
      groups: currentGroups
    });
  } catch (e:any) {
    res.status(500).json({ error: 'set_role_failed', message: e?.message || 'failed' });
  } finally {
    try{ db.close(); }catch{}
  }
});

// Groups: free-form operator tags on a device's *application id* (its role -
// see device_groups in ensureDeviceHubSchema). Unlike the role itself, which
// is a single exclusive identity, an application id can carry any number of
// groups and many share the same one. They exist so an application can say
// "everything in `cold-storage`", or "everything owned by `user-<id>`",
// instead of tracking identifiers itself. Because they hang off the
// application id rather than the hardware, they follow a device swap.

// GET /api/groups -> every group in use, with device counts
app.get('/api/groups', authRequired, (_req: Request, res: Response) => {
  try {
    res.json({ groups: listGroups() });
  } catch (e: any) {
    res.status(500).json({ error: 'list_failed', message: e?.message || 'failed' });
  }
});

// PUT /api/devices/:uuid/groups -> replace the group membership of whatever
// application id this device currently holds. Accepts either a bare string
// ("freezers") or an array; an empty array or null clears membership. Replace
// rather than merge, so the body is the full desired state and repeated calls
// are idempotent.
//
// Addressed by hardware uuid for convenience (that's what the UI has in hand),
// but stored against the role, so the tags stay with the application identity
// if the hardware is later swapped out. A device with no role has no
// application identity to tag yet, and is rejected rather than silently
// accepting tags that would evaporate.
app.put('/api/devices/:uuid/groups', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  if (!uuid) { res.status(400).json({ error: 'invalid_device_uuid' }); return; }
  // Tolerate both spellings: `groups` is the documented field, `group` is the
  // natural thing to write when assigning exactly one.
  const raw = req.body?.groups !== undefined ? req.body.groups : req.body?.group;
  const normalized = normalizeGroups(raw);
  if (!normalized.ok) { res.status(400).json({ error: 'invalid_groups', message: normalized.error }); return; }

  const device = getDevicesListSync().devices.find(d => d.uuid === uuid);
  if (!device) { res.status(404).json({ error: 'device_not_found' }); return; }
  if (!device.role) {
    res.status(409).json({
      error: 'no_application_id',
      message: 'Groups attach to a device\'s application id (role). Assign a role first.'
    });
    return;
  }

  const result = setGroupsForRole(device.role, normalized.groups || []);
  if (!result.ok) { res.status(500).json({ error: result.error || 'set_groups_failed' }); return; }
  res.json({ ok: true, uuid, role: device.role, groups: result.groups });
});

// GET /api/devices/:uuid/groups -> groups of this device's application id
app.get('/api/devices/:uuid/groups', authRequired, (req: Request, res: Response) => {
  const { uuid } = req.params;
  if (!uuid) { res.status(400).json({ error: 'invalid_device_uuid' }); return; }
  const device = getDevicesListSync().devices.find(d => d.uuid === uuid);
  if (!device) { res.status(404).json({ error: 'device_not_found' }); return; }
  res.json({ uuid, role: device.role, groups: device.role ? getGroupsForRole(device.role) : [] });
});

// PUT /api/roles/:role/groups -> same, addressed directly by application id.
// This is the form that makes sense for automation: the caller knows which
// application identity it is provisioning for, not which box is behind it.
app.put('/api/roles/:role/groups', authRequired, (req: Request, res: Response) => {
  const { role } = req.params;
  if (!role) { res.status(400).json({ error: 'invalid_role' }); return; }
  const raw = req.body?.groups !== undefined ? req.body.groups : req.body?.group;
  const normalized = normalizeGroups(raw);
  if (!normalized.ok) { res.status(400).json({ error: 'invalid_groups', message: normalized.error }); return; }
  const result = setGroupsForRole(role, normalized.groups || []);
  if (!result.ok) { res.status(500).json({ error: result.error || 'set_groups_failed' }); return; }
  res.json({ ok: true, role, groups: result.groups });
});

// GET /api/roles/:role/groups
app.get('/api/roles/:role/groups', authRequired, (req: Request, res: Response) => {
  const { role } = req.params;
  if (!role) { res.status(400).json({ error: 'invalid_role' }); return; }
  res.json({ role, groups: getGroupsForRole(role) });
});

// GET /api/devices/:uuid/events -> recent events from registry DB
app.get('/api/devices/:uuid/events', authRequired, (req: Request, res: Response) => {
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

function bufferToMaybeJson(b: any){
  try{
    const s = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : String(b));
    try{ return JSON.parse(s); }catch{ return s; }
  }catch{ return b; }
}

// ===== Helpers reused by REST and WS =====
async function getServicesSnapshot(): Promise<{ services: Array<{ unit: string; status: string; version?: string }> }> {
  // Defensive guard: exclude any units that contain 'registry' regardless of source
  // This ensures stale builds/configs cannot surface a registry tile in the UI.
  const units = DEFAULT_LOG_UNITS.filter(u => !String(u || '').toLowerCase().includes('registry'));

  function unitToPkgPath(u: string): string | null {
    const map: Record<string, string> = {
      'devicehub.service': path.resolve(process.cwd(), 'package.json'),
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

async function getDevicesList(): Promise<{ devices: Array<{ uuid: string; name: string; role: string | null; token: string; meta: any; created_at: string; last_seen: string | null; online: boolean; disabled: boolean }> }> {
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
    // sendDirectMethod builds the MQTT topic directly from whatever identifier
    // it's given, but a device subscribes to its methods/+/request topic
    // under its own assigned name (masked identity - see ClaimDeviceName in
    // devices-store.ts), never its uuid. Publishing straight to the uuid here
    // would build a topic nothing is subscribed to.
    const db = openDb(DEVICEHUB_DB);
    let deviceId = uuid;
    if (db) {
      try {
        const row = db.prepare('SELECT name FROM devices WHERE uuid = ?').get(uuid) as any;
        if (row?.name) deviceId = row.name;
      } finally { try{ db.close(); }catch{} }
    }
    console.log(`[${SERVICE}] Sending identify direct method to device ${deviceId} (uuid=${uuid})`);
    const result = await sendDirectMethod(deviceId, 'identify');
    console.log(`[${SERVICE}] Direct method result:`, result);
    
    if (result.success) {
      res.json({ 
        ok: true, 
        message: result.message || `Identify command executed on device ${uuid}`,
        payload: result.payload,
        status: result.status 
      });
    } else {
      res.status(500).json({ 
        ok: false, 
        message: result.error || 'Failed to execute identify command on device',
        requestId: result.requestId
      });
    }
  } catch (error) {
    console.error(`[${SERVICE}] Error sending identify command to device ${uuid}:`, error);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

// ===== Admin: UUID Whitelist Management =====
// Table lives in provisioning.db as `uuid_whitelist` with columns
// (uuid PRIMARY KEY, device_id TEXT, name TEXT, note TEXT, created_at TEXT, used_at TEXT)

// Ensure schema exists before exposing routes
ensureDeviceHubSchema();

/**
 * The whitelist file format: one entry per line, `<uuid><space><note>`.
 *
 * Export writes it and batch upload reads it, so a list can be pulled out of
 * one hub, edited in any text editor, and pushed into another - which only
 * holds if exactly one definition of the format exists. These two functions
 * are it.
 *
 * The note is everything after the first run of whitespace, kept verbatim:
 * notes have spaces in them, so splitting on every space would shred them.
 * A line with no note is just a UUID, which is what every file written before
 * notes existed looks like - those still load unchanged.
 */
function formatWhitelistLine(uuid: string, note?: string | null): string {
  const trimmed = (note ?? '').trim();
  return trimmed ? `${uuid} ${trimmed}` : uuid;
}

function parseWhitelistLine(line: string): { uuid: string; note: string } | null {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return null;
  const split = trimmed.search(/\s/);
  if (split === -1) return { uuid: trimmed, note: '' };
  return { uuid: trimmed.slice(0, split), note: trimmed.slice(split).trim() };
}

// GET /api/admin/uuid-whitelist -> list entries
app.get('/api/admin/uuid-whitelist', authRequired, (_req: Request, res: Response) => {
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.json({ entries: [] }); return; }
  try{
    // `registered` distinguishes the two states a claimed UUID can be in:
    // still in the registry, or claimed once and since decommissioned. Without
    // it a decommissioned device is indistinguishable from a live one here -
    // both just carry a used_at - which reads as though the device is still
    // out there. LEFT JOIN so an entry that never provisioned stays listed.
    const rows = db.prepare(
      'SELECT w.uuid, w.note, w.hardware_version, w.manufacturer, w.created_at, w.used_at, w.disabled_at, '+
      '  CASE WHEN d.uuid IS NULL THEN 0 ELSE 1 END AS registered '+
      'FROM uuid_whitelist w LEFT JOIN devices d ON d.uuid = w.uuid '+
      'ORDER BY w.created_at DESC'
    ).all();
    res.json({ entries: rows });
  }catch{
    res.json({ entries: [] });
  }finally{ try{ db.close(); }catch{} }
});

// GET /api/admin/uuid-whitelist/export -> the whole whitelist as a text file
// in the same `<uuid> <note>` format batch upload accepts, so exporting from
// one hub and importing into another is a round trip rather than a conversion.
// Ordered by creation, oldest first - the reverse of the list route, because a
// file is read top to bottom and a diff between two exports should be stable.
app.get('/api/admin/uuid-whitelist/export', authRequired, (_req: Request, res: Response) => {
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try{
    const rows = db.prepare('SELECT uuid, note FROM uuid_whitelist ORDER BY created_at ASC').all() as Array<{ uuid: string; note: string | null }>;
    const body = rows.map(r => formatWhitelistLine(r.uuid, r.note)).join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="whitelist.txt"');
    // Trailing newline: POSIX text files end with one, and without it the last
    // entry concatenates with whatever gets appended to the file later.
    res.send(body ? body + '\n' : '');
  }catch(e:any){
    res.status(500).json({ error: 'export_failed', message: e?.message || 'failed' });
  }finally{ try{ db.close(); }catch{} }
});

// POST /api/admin/uuid-whitelist -> add entry
// UUID is the only thing Device Hub needs to authorize a device; hardware
// version / manufacturer are manufacturing-side concerns, not tracked here.
// Still accepted (and stored) if a caller supplies them, for anyone with an
// existing integration, but neither is required.
app.post('/api/admin/uuid-whitelist', authRequired, (req: Request, res: Response) => {
  let { uuid, note, hardware_version, manufacturer } = req.body;
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  if(!uuid){ res.status(400).json({ error: 'uuid_required' }); return; }
  uuid = String(uuid).trim();
  note = note != null ? String(note).trim() : '';
  hardware_version = hardware_version != null ? String(hardware_version).trim() : '';
  manufacturer = manufacturer != null ? String(manufacturer).trim() : '';
  if(!uuid){
    res.status(400).json({ error: 'uuid_required' }); return;
  }
  try{
    const now = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO uuid_whitelist (uuid, note, hardware_version, manufacturer, created_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run(uuid, note, hardware_version, manufacturer, now);
    res.json({ ok: true });
  }catch(e:any){
    if(e?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'){ res.status(409).json({ error: 'uuid_exists' }); return; }
    res.status(500).json({ error: 'insert_failed', message: e?.message || 'failed' });
  }finally{ try{ db.close(); }catch{} }
});

// POST /api/admin/uuid-whitelist/batch -> batch add entries from file
//
// Each element of `uuids` is one line of the whitelist file format:
// `<uuid><space><note>`, the same thing GET .../export writes. A bare UUID
// with no note is a valid line, so files written before notes existed - and
// hand-written lists that are nothing but UUIDs - keep working untouched.
app.post('/api/admin/uuid-whitelist/batch', authRequired, (req: Request, res: Response) => {
  let { uuids, hardware_version, manufacturer } = req.body;
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  if(!uuids || !Array.isArray(uuids)){ res.status(400).json({ error: 'uuids_array_required' }); return; }

  hardware_version = hardware_version != null ? String(hardware_version).trim() : '';
  manufacturer = manufacturer != null ? String(manufacturer).trim() : '';

  const results = { added: 0, skipped: 0, errors: [] as string[] };
  const now = new Date().toISOString();
  
  try{
    const stmt = db.prepare('INSERT INTO uuid_whitelist (uuid, note, hardware_version, manufacturer, created_at) VALUES (?, ?, ?, ?, ?)');

    for(const rawLine of uuids) {
      const parsed = parseWhitelistLine(rawLine);
      if(!parsed) {
        results.errors.push(`Empty UUID skipped`);
        results.skipped++;
        continue;
      }
      const { uuid, note } = parsed;

      try {
        stmt.run(uuid, note, hardware_version, manufacturer, now);
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

// Revokes every certificate ever issued for this UUID and republishes the CRL
// - the actual kill switch: unlike disabled_at (which only blocks *future*
// provisioning), this reaches a device that already holds a valid cert and is
// live on the broker right now. Best-effort: a failure here is logged and
// surfaced to the admin as a warning, but never rolls back the whitelist
// change itself, since blocking future provisioning is still real protection
// even if publishing the CRL update hiccups.
async function revokeAndPublishCRL(uuid: string): Promise<string | undefined> {
  try {
    await revokeCertificatesForUuid(uuid);
    await regenerateCRL();
    return undefined;
  } catch (e: any) {
    const message = e?.message || 'revocation failed';
    console.error(`[devicehub] Failed to revoke certificates / republish CRL for ${uuid}:`, message);
    return message;
  }
}

// PATCH /api/admin/uuid-whitelist/:uuid -> enable/disable entry
// A disabled entry is rejected by provisioning the same way a used one is
// (see WhitelistInterface.CheckUUID), but reversibly - re-enabling clears it.
// Disabling also revokes every certificate ever issued for this UUID (see
// revokeAndPublishCRL) - re-enabling does NOT undo that: a revoked cert stays
// revoked, matching "the board is the passport" - getting access back means
// reprovisioning for a fresh identity, not un-revoking the old one.
// Also edits the note. Both fields are optional and independent, so a note can
// be corrected without touching the entry's enabled state - and, importantly,
// without tripping the certificate revocation below, which must only ever fire
// on an actual disable.
app.patch('/api/admin/uuid-whitelist/:uuid', authRequired, async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { disabled, note } = req.body;
  if(!uuid){ res.status(400).json({ error: 'invalid_uuid' }); return; }
  if(disabled !== undefined && typeof disabled !== 'boolean'){ res.status(400).json({ error: 'disabled_boolean_required' }); return; }
  const setsDisabled = disabled !== undefined;
  const setsNote = note !== undefined;
  if(!setsDisabled && !setsNote){ res.status(400).json({ error: 'disabled_boolean_or_note_required' }); return; }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  let changed = false;
  try{
    const assignments: string[] = [];
    const values: any[] = [];
    if(setsDisabled){
      assignments.push('disabled_at = ?');
      values.push(disabled ? new Date().toISOString() : null);
    }
    if(setsNote){
      assignments.push('note = ?');
      values.push(note != null ? String(note).trim() : '');
    }
    const info = db.prepare(`UPDATE uuid_whitelist SET ${assignments.join(', ')} WHERE uuid = ?`).run(...values, uuid);
    changed = info.changes > 0;
  }catch(e:any){ res.status(500).json({ error: 'update_failed', message: e?.message || 'failed' }); return; }
  finally{ try{ db.close(); }catch{} }
  if(!changed){ res.status(404).json({ error: 'not_found' }); return; }
  const crlWarning = disabled === true ? await revokeAndPublishCRL(uuid) : undefined;
  res.json({ ok: true, ...(crlWarning ? { warning: crlWarning } : {}) });
});

// DELETE /api/admin/uuid-whitelist/:uuid -> remove entry
// Removing the entry entirely is at least as strong a signal as disabling it,
// so this revokes certificates the same way (see revokeAndPublishCRL above).
app.delete('/api/admin/uuid-whitelist/:uuid', authRequired, async (req: Request, res: Response) => {
  const { uuid } = req.params;
  if(!uuid){ res.status(400).json({ error: 'invalid_uuid' }); return; }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  let deleted = false;
  try{
    const info = db.prepare('DELETE FROM uuid_whitelist WHERE uuid = ?').run(uuid);
    deleted = info.changes > 0;
  }catch{ res.status(500).json({ error: 'delete_failed' }); return; }
  finally{ try{ db.close(); }catch{} }
  const crlWarning = deleted ? await revokeAndPublishCRL(uuid) : undefined;
  res.json({ deleted, ...(crlWarning ? { warning: crlWarning } : {}) });
});

// DELETE /api/admin/uuid-whitelist/by-device/:deviceId -> remove all whitelist entries for a device
app.delete('/api/admin/uuid-whitelist/by-device/:deviceId', authRequired, (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if(!deviceId){ res.status(400).json({ error: 'invalid_device_id' }); return; }
  const db = openDb(DEVICEHUB_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try{
    // uuid_whitelist has no device_id column; the caller actually passes the uuid (see ui/src/api/devicehub.ts's deleteWhitelistByDevice)
    const info = db.prepare('DELETE FROM uuid_whitelist WHERE uuid = ?').run(deviceId);
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
app.get('/api/settings/server', authRequired, async (_req: Request, res: Response) => {
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
app.get('/api/settings/certs/root', authRequired, async (_req: Request, res: Response) => {
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
app.post('/api/settings/certs/root', authRequired, async (req: Request, res: Response) => {
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
app.get('/api/settings/certs/provisioning', authRequired, async (_req: Request, res: Response) => {
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
app.post('/api/settings/certs/provisioning', authRequired, async (req: Request, res: Response) => {
  try {
    await generateProvisioningCert();
    res.json({ ok: true, message: 'Provisioning certificate generated' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to generate provisioning cert' });
  }
});

// POST /api/settings/certs/provisioning/renew -> force-regenerate the claim
// certificate, replacing whatever was there. A provisioning cert has no
// fixed expiry that matters day to day - it's valid until this is called.
// Any device that hasn't completed its first claim yet and is still holding
// the *old* claim cert will no longer be trusted by the broker once this
// runs, since Mosquitto only trusts the current root-CA-signed chain for
// whichever provisioning cert is live - so this is destructive to an
// unprovisioned fleet, by design (matches "renew" semantics: the old one
// stops being valid the moment the new one exists).
app.post('/api/settings/certs/provisioning/renew', authRequired, async (_req: Request, res: Response) => {
  try {
    await generateProvisioningCert({ force: true });
    const meta = await readCertMeta(path.join(PROV_DIR, 'provisioning.crt'));
    res.json({ ok: true, meta });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to renew provisioning cert' });
  }
});

// GET /api/settings/certs/provisioning/:name -> inspect a provisioning cert (PEM + meta)
app.get('/api/settings/certs/provisioning/:name', authRequired, async (req: Request, res: Response) => {
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
app.delete('/api/settings/certs/provisioning/:name', authRequired, async (req: Request, res: Response) => {
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

// GET/PUT /api/settings/provisioning/cert-fetch -> whether devices can fetch
// the claim certificate (provisioning.crt/.key) over the public HTTP
// endpoints above. See isProvisioningCertFetchEnabled() for the reasoning.
app.get('/api/settings/provisioning/cert-fetch', authRequired, (_req: Request, res: Response) => {
  res.json({ enabled: isProvisioningCertFetchEnabled() });
});

app.put('/api/settings/provisioning/cert-fetch', authRequired, (req: Request, res: Response) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled_boolean_required' }); return; }
  try {
    setAppSetting(PROVISIONING_CERT_FETCH_KEY, enabled ? '1' : '0');
    res.json({ ok: true, enabled });
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'failed to update setting' });
  }
});

// ===== Services & Logs =====
// GET /api/services -> systemd unit status snapshot consumed by ServiceStatusWidget
app.get('/api/services', authRequired, async (_req: Request, res: Response) => {
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

app.get('/api/metrics', authRequired, async (_req: Request, res: Response) => {
  try{
    const snap = await readMetricsSnapshot();
    res.json(snap);
  }catch(e:any){
    res.status(500).json({ error: e?.message || 'failed to read metrics' });
  }
});

// GET /api/metrics/history?hours=24 -> array of snapshots (oldest -> newest)
app.get('/api/metrics/history', authRequired, (req: Request, res: Response) => {
  const hours = Math.min(48, Math.max(1, Number(req.query.hours || 24)));
  const cutoff = Date.now() - hours * 3600 * 1000;
  const data = METRICS_HISTORY.filter(s => s.timestamp >= cutoff);
  res.json({ hours, samples: data });
});
// GET /api/logs -> recent logs snapshot
// Query: units=comma,separated (optional), lines=number (default 200), since=systemd-time (optional)
app.get('/api/logs', authRequired, (req: Request, res: Response) => {
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

app.post('/api/services/:unit/start', authRequired, actionHandler('start'));
app.post('/api/services/:unit/stop', authRequired, actionHandler('stop'));
app.post('/api/services/:unit/restart', authRequired, actionHandler('restart'));

// System power management endpoints (admin-only)
// POST /api/system/reboot -> reboot the server
app.post('/api/system/reboot', authRequired, async (req: Request, res: Response) => {
  try {
    console.log('[devicehub] System reboot requested by admin');
    
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
        console.log('[devicehub] System reboot scheduled successfully');
      } else {
        console.error('[devicehub] Failed to schedule reboot:', stderr);
      }
    });
    
    // Respond immediately
    res.json({ 
      ok: true, 
      message: 'System reboot scheduled in 1 minute',
      action: 'reboot'
    });
    
  } catch (e: any) {
    console.error('[devicehub] Error scheduling reboot:', e);
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
    console.log('[devicehub] System shutdown requested by admin');
    
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
        console.log('[devicehub] System shutdown scheduled successfully');
      } else {
        console.error('[devicehub] Failed to schedule shutdown:', stderr);
      }
    });
    
    // Respond immediately
    res.json({ 
      ok: true, 
      message: 'System shutdown scheduled in 1 minute',
      action: 'shutdown'
    });
    
  } catch (e: any) {
    console.error('[devicehub] Error scheduling shutdown:', e);
    res.status(500).json({ 
      ok: false, 
      error: e?.message || 'Failed to schedule shutdown',
      action: 'shutdown'
    });
  }
});

// GET /api/logs/stream -> SSE stream of logs
// Query: units=comma,separated (optional), since=systemd-time (optional)
app.get('/api/logs/stream', authRequired, (req: Request, res: Response) => {
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

// Create WebSocket server. `noServer` rather than { server, path } because
// this process now serves two WebSocket endpoints: the admin feed here and the
// terminal's PTY. A `ws` server constructed with { server, path } installs its
// own upgrade listener that aborts every path it does not own with a 400, and
// upgrade listeners are additive - so two of them on one HTTP server cannot
// coexist, whichever runs first killing the other's handshake. Both are
// noServer, and the router below dispatches by path.
const wss = new WebSocketServer({
  noServer: true,
  clientTracking: false,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024
});

const terminalService = createTerminalService();

server.on('upgrade', (request, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(request.url || '', 'http://localhost').pathname;
  } catch { /* malformed target; falls through to the reject below */ }

  if (pathname === '/api/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    return;
  }
  if (pathname === terminalService.path) {
    terminalService.handleUpgrade(request, socket, head);
    return;
  }
  console.warn(`[HTTP] Rejected WebSocket upgrade for unknown path: ${request.url}`);
  socket.destroy();
});

wss.on('connection', (ws: any, req: any) => {
  console.log(`[WS] Connection event fired, processing...`);
  
  // Check authentication via cookies (same as HTTP requests), unless the
  // operator has delegated auth to a reverse proxy - see auth.ts's
  // authRequired for the same check on the HTTP side.
  let authed = isAuthDisabled();
  if (!authed) {
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
        // Login is required for every topic - no anonymous subset. The
        // connection itself is still accepted (see `authed` above) so an
        // unauthenticated client gets a clear `{authenticated:false}` welcome
        // message rather than a bare refused connection, but it is never
        // handed any subscription.
        if(!ctx.authed){
          console.log(`[WS] Anonymous client denied subscription (login required)`);
        } else {
          for(const raw of msg.topics){
            const t = String(raw);
            if(typeof t !== 'string') continue;
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
          if (ctx.topics.has('services.status')){
            getServicesSnapshot().then(svcs => send(ws, { type: 'services.status', data: svcs })).catch(()=>{});
          }
          if (ctx.topics.has('devices.list')){
            getDevicesList().then(list => send(ws, { type: 'devices.list', data: list })).catch(()=>{});
          }
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
      broadcast('devices.list', { type: 'devices.list', data });
    }
  }catch{}
}, 10000);

// Graceful shutdown
function setupShutdown(){
  const onSig = (sig: string) => () => {
    try{ console.log(`[devicehub] received ${sig}, shutting down`); }catch{}
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

// PKI bootstrap: everything a fresh install needs before any device can talk
async function ensurePki() {
  // Ensure the root CA exists. This is internal PKI plumbing, not an admin
  // decision that needs a form - nothing about a fresh install benefits
  // from a human picking the CN/validity period before anything else can
  // work, so it's generated with sane defaults the same way the
  // provisioning cert already is, rather than blocking on a UI action.
  try {
    if (!(await caExists())) {
      await generateRootCA();
      console.log(`[devicehub] Root CA generated`);
    }
  } catch (error) {
    console.warn(`[devicehub] Failed to generate root CA:`, error);
  }

  // Ensure provisioning certificates exist for device bootstrap
  try {
    await generateProvisioningCert();
    console.log(`[devicehub] Provisioning certificates ensured`);
  } catch (error) {
    console.warn(`[devicehub] Failed to generate provisioning certificates:`, error);
  }

  // Mosquitto's crlfile must point at something loadable from the moment it
  // starts - an empty CRL (nothing revoked yet) satisfies that on first boot.
  try {
    await ensureCRLExists();
    console.log(`[devicehub] Certificate revocation list ensured`);
  } catch (error) {
    console.warn(`[devicehub] Failed to ensure CRL exists:`, error);
  }
}

ensurePki().then(() => {
  // Internal sub-services - all in-process, each with its own MQTT connection
  startProvisioning();
  startTwin(broadcast);
  startApplication();

  // Initialize MQTT client for direct method forwarding
  initMqttClient();

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[devicehub] listening on :${PORT}, UI_DIST=${UI_DIST}`);
  });
}).catch((error) => {
  console.error(`[devicehub] Startup failed:`, error);
  process.exit(1);
});
