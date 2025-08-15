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
import { WebSocketServer } from 'ws';
import path from 'path';
import morgan from 'morgan';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import {
  PORT,
  ADMIN_USER,
  ADMIN_PASSWORD,
  SESSION_COOKIE,
  JWT_SECRET,
  JWT_TTL_SECONDS,
  CERTS_DIR,
  ROOT_DIR,
  PROV_DIR,
  CA_KEY,
  CA_CRT,
  UI_DIST,
  MQTT_URL,
  PROVISIONING_DB,
  REGISTRY_DB,
  ONLINE_THRESHOLD_SECONDS,
} from './config.js';
import { ensureDirs, caExists, generateRootCA, readCertMeta, issueProvisioningCert } from './certs.js';
import { buildJournalctlArgs, DEFAULT_LOG_UNITS } from './logs.js';
import { authRequired, clearSessionCookie, getSession, parseCookies, setSessionCookie } from './auth.js';

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

app.use(morgan('dev'));
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

// GET /api/settings/certs/root/download -> download Root CA certificate (PEM)
app.get('/api/settings/certs/root/download', async (_req: Request, res: Response) => {
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
app.get('/api/settings/certs/provisioning/:name/download', async (req: Request, res: Response) => {
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

    const mqttUrl = MQTT_URL;
    const cfg = { mqttUrl, caCert: 'ca.crt', cert: `${name}.crt`, key: `${name}.key` };
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
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.get('/healthz', (_req: Request, res: Response) => res.json({ status: 'ok' }));

// Core-service owns the public HTTP(S) surface: define API routes here.
// GET /api/health
app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

// Log a startup hello from core-service
console.log('[core-service] hello from Device Hub core-service');

// Unified logs: snapshot and streaming from systemd journal (journalctl)
// Services are expected to be systemd units like devicehub-*.service
// DEFAULT_LOG_UNITS now imported from src/logs.ts

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

app.use(authRequired);

// ===== Devices & Events (read-only MVP) =====
// Data sources:
//  - provisioning.db (table `devices`)
//  - registry.db (table `device_events`)
// For MVP we access SQLite files directly. In future, route via shared repos or D-Bus.

function openDb(file: string){
  try{
    const db: any = new (Database as any)(file);
    db.pragma('journal_mode = WAL');
    return db as any;
  }catch(e){
    return null;
  }
}

function getLastSeenMap(): Record<string,string> {
  const db = openDb(REGISTRY_DB);
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
app.get('/api/devices', (_req: Request, res: Response) => {
  const list = getDevicesListSync();
  res.json(list);
});

// GET /api/devices/:id -> single device
app.get('/api/devices/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = openDb(PROVISIONING_DB);
  if(!db){ res.status(404).json({ error: 'not found' }); return; }
  try{
    const row = db.prepare('SELECT id, name, token, meta, created_at FROM devices WHERE id = ?').get(id);
    if(!row){ res.status(404).json({ error: 'not found' }); return; }
    const lastSeen = getLastSeenMap();
    const ls = lastSeen[id];
    const online = ls ? (Date.now() - Date.parse(ls)) / 1000 <= ONLINE_THRESHOLD_SECONDS : false;
    res.json({ id: row.id, name: row.name, token: row.token, meta: tryParseJson(row.meta), created_at: row.created_at, last_seen: ls || null, online });
  }catch{
    res.status(500).json({ error: 'failed to read device' });
  }finally{
    try{ db.close(); }catch{}
  }
});

// GET /api/devices/:id/events -> recent events from registry DB
app.get('/api/devices/:id/events', (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  const db = openDb(REGISTRY_DB);
  if(!db){ res.json({ events: [] }); return; }
  try{
    const rows = db.prepare('SELECT id, device_id, topic, payload, ts FROM device_events WHERE device_id = ? ORDER BY ts DESC LIMIT ?').all(id, limit);
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

// ===== Helpers reused by REST and WS =====
async function getServicesSnapshot(): Promise<{ services: Array<{ unit: string; status: string }> }> {
  const units = DEFAULT_LOG_UNITS;
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
      return { unit: u, status: result.out || 'unknown' };
    } catch (e) {
      return { unit: u, status: 'error' };
    }
  }));
  return { services: checks };
}

function getDevicesListSync(): { devices: Array<{ id: string; name: string; token: string; meta: any; created_at: string; last_seen: string | null; online: boolean }> }{
  const db = openDb(PROVISIONING_DB);
  if(!db){ return { devices: [] }; }
  try{
    const rows = db.prepare('SELECT id, name, token, meta, created_at FROM devices ORDER BY created_at DESC').all();
    const lastSeen = getLastSeenMap();
    const now = Date.now();
    const devices = rows.map((r: any) => {
      const ls = lastSeen[r.id];
      const last_seen = ls || null;
      const online = ls ? (now - Date.parse(ls)) / 1000 <= ONLINE_THRESHOLD_SECONDS : false;
      return { id: r.id, name: r.name, token: r.token, meta: tryParseJson(r.meta), created_at: r.created_at, last_seen, online };
    });
    return { devices };
  }catch{
    return { devices: [] };
  }finally{
    try{ db.close(); }catch{}
  }
}

async function getDevicesList(): Promise<{ devices: Array<{ id: string; name: string; token: string; meta: any; created_at: string; last_seen: string | null; online: boolean }> }> {
  return getDevicesListSync();
}

// ===== Device Actions (stub) =====
// In future, wire these to MQTT/cloud connector to invoke direct methods on devices.
// For now, return an ok message so the UI can integrate the flows.
app.post('/api/devices/:id/actions/identify', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) { res.status(400).json({ ok: false, message: 'invalid_device_id' }); return; }
  res.json({ ok: true, message: `Identifying device ${id}` });
});

app.post('/api/devices/:id/actions/reboot', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) { res.status(400).json({ ok: false, message: 'invalid_device_id' }); return; }
  res.json({ ok: true, message: `Reboot requested for device ${id}` });
});

// Application controls
app.post('/api/devices/:id/actions/application/restart', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, message:`Application restart requested for ${id}` });
});
app.post('/api/devices/:id/actions/application/stop', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, message:`Application stop requested for ${id}` });
});
app.post('/api/devices/:id/actions/application/info', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, payload:{ version:'n/a', state:'unknown' } });
});
app.post('/api/devices/:id/actions/application/update', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
  res.json({ ok:true, message:`Application update requested for ${id}` });
});

// System info/network
app.post('/api/devices/:id/actions/system/info', (req: Request, res: Response) => {
  const { id } = req.params; if (!id) { res.status(400).json({ ok:false, message:'invalid_device_id' }); return; }
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

// GET /api/admin/uuid-whitelist -> list entries
app.get('/api/admin/uuid-whitelist', (_req: Request, res: Response) => {
  const db = openDb(PROVISIONING_DB);
  if(!db){ res.json({ entries: [] }); return; }
  try{
    const rows = db.prepare('SELECT uuid, device_id, name, note, created_at, used_at FROM uuid_whitelist ORDER BY created_at DESC').all();
    res.json({ entries: rows });
  }catch{
    res.json({ entries: [] });
  }finally{ try{ db.close(); }catch{} }
});

// POST /api/admin/uuid-whitelist { device_id, name?, note?, uuid? }
app.post('/api/admin/uuid-whitelist', (req: Request, res: Response) => {
  const { device_id, name, note } = req.body || {};
  let { uuid } = req.body || {};
  if(!device_id || typeof device_id !== 'string') { res.status(400).json({ error: 'invalid_device_id' }); return; }
  if(uuid && typeof uuid !== 'string'){ res.status(400).json({ error: 'invalid_uuid' }); return; }
  if(!uuid){ uuid = crypto.randomUUID(); }
  const db = openDb(PROVISIONING_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try{
    const now = new Date().toISOString();
    db.prepare('INSERT INTO uuid_whitelist (uuid, device_id, name, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(uuid, device_id, (typeof name === 'string' ? name : null), (typeof note === 'string' ? note : null), now);
    const row = db.prepare('SELECT uuid, device_id, name, note, created_at, used_at FROM uuid_whitelist WHERE uuid = ?').get(uuid);
    res.status(201).json(row);
  }catch(e:any){
    const msg = (e && e.message) || 'insert_failed';
    if(String(msg).includes('UNIQUE')){ res.status(409).json({ error: 'uuid_exists' }); }
    else { res.status(500).json({ error: 'insert_failed', message: msg }); }
  }finally{ try{ db.close(); }catch{} }
});

// DELETE /api/admin/uuid-whitelist/:uuid
app.delete('/api/admin/uuid-whitelist/:uuid', (req: Request, res: Response) => {
  const { uuid } = req.params;
  if(!uuid){ res.status(400).json({ error: 'invalid_uuid' }); return; }
  const db = openDb(PROVISIONING_DB);
  if(!db){ res.status(500).json({ error: 'db_unavailable' }); return; }
  try{
    const info = db.prepare('DELETE FROM uuid_whitelist WHERE uuid = ?').run(uuid);
    res.json({ deleted: info.changes > 0 });
  }catch{ res.status(500).json({ error: 'delete_failed' }); }
  finally{ try{ db.close(); }catch{} }
});

// ===== Server Settings & Certificate Management =====
// Endpoints backing the Settings page in the UI. Root CA must exist before issuing
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

// POST /api/settings/certs/provisioning { name, days? } -> issue a new provisioning cert
app.post('/api/settings/certs/provisioning', async (req: Request, res: Response) => {
  try {
    const { name, days } = req.body || {};
    if (!name || typeof name !== 'string') { res.status(400).json({ error: 'name is required' }); return; }
    const result = await issueProvisioningCert(name, typeof days === 'number' ? days : undefined);
    const meta = await readCertMeta(result.certPath);
    res.json({ ok: true, cert: result.certPath, key: result.keyPath, meta });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to issue provisioning cert' });
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
  const lines = req.query.lines ? Number(req.query.lines) : 200;
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;

  const args = buildJournalctlArgs({ units, lines, since, output: 'json' });
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
  app.use(express.static(UI_DIST));
  // Lightweight admin page available even when UI exists
  app.get('/admin/settings', (_req: Request, res: Response) => {
    res.redirect('/'); // In a future commit, this can serve a dedicated admin page within SPA
  });

  // Inject an auth navbar and hide registration affordances when serving index.html
  function renderInjectedIndex(_req: Request, res: Response) {
    try {
      let html = fs.readFileSync(UI_INDEX, 'utf8');
      const injectHead = ``;
      const injectBodyEnd = `\n<script>\n(async function(){\n  try{\n    const r = await fetch('/api/auth/me');\n    if(!r.ok) throw new Error();\n    const d = await r.json();\n     // Hide registration affordances (best-effort)\n     const hideSelectors = [\n       'a[href*="register"]', 'a[href*="signup"]', 'a[href*="sign-up"]',\n       '#register', '#signup', '.register', '.signup'\n     ];\n     for (const sel of hideSelectors){ document.querySelectorAll(sel).forEach(el => { (el).style.display = 'none'; }); }\n     // Hide by text content (case-insensitive contains)\n     const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);\n     while (walker.nextNode()){\n       const el = walker.currentNode;\n       if (el && el.textContent && /register|sign\\s*up/i.test(el.textContent)){ try{ el.style.display='none'; }catch{} }\n     }\n   }catch(e){ /* not logged in: let auth middleware show login */ }\n})();\n</script>\n`;
      html = html.replace('</head>', injectHead + '</head>');
      html = html.replace('</body>', injectBodyEnd + '</body>');
      res.type('html').send(html);
    } catch (e) {
      // Fallback
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
type ClientCtx = { ws: any; topics: Set<string>; logs?: Map<string, any> };
const clients = new Set<ClientCtx>();

function send(ws: any, msg: any){
  try{ ws.send(JSON.stringify(msg)); }catch{}
}

// Create HTTP server and attach both Express and WS
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/ws' });

wss.on('connection', (ws: any, req: any) => {
  // Auth via cookie
  try{
    const cookies = parseCookies(req.headers?.cookie || '');
    const token = cookies[SESSION_COOKIE];
    if(!token){ ws.close(1008, 'unauthorized'); return; }
    try{ jwt.verify(token, JWT_SECRET); }catch{ ws.close(1008, 'unauthorized'); return; }
  }catch{ ws.close(1011, 'error'); return; }

  const ctx: ClientCtx = { ws, topics: new Set(), logs: new Map() };
  clients.add(ctx);

  ws.on('message', (data: any) => {
    try{
      const msg = JSON.parse(String(data || ''));
      if(msg?.type === 'subscribe' && Array.isArray(msg.topics)){
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
        // Special case: metrics.history -> send current history snapshot immediately (default 24h)
        if (ctx.topics.has('metrics.history')){
          const hours = 24;
          const cutoff = Date.now() - hours * 3600 * 1000;
          const samples = METRICS_HISTORY.filter(s => s.timestamp >= cutoff);
          send(ws, { type: 'metrics.history', data: { hours, samples } });
        }
        // Send immediate snapshots for services and devices when subscribed
        if (ctx.topics.has('services.status')){
          getServicesSnapshot().then(svcs => send(ws, { type: 'services.status', data: svcs })).catch(()=>{});
        }
        if (ctx.topics.has('devices.list')){
          getDevicesList().then(list => send(ws, { type: 'devices.list', data: list })).catch(()=>{});
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

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[core-service] listening on :${PORT}, UI_DIST=${UI_DIST}`);
});
