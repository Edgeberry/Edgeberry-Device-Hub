import Database from 'better-sqlite3';
import { Json } from './types.js';

/** Initialize SQLite and ensure tables exist. */
export function initDb(path: string){
  const db: any = new (Database as any)(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS twin_desired (
      device_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0,
      doc TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS twin_reported (
      device_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0,
      doc TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db as any;
}

/** Load desired and reported docs for a device (defaults to empty). */
export function getTwin(db: any, deviceId: string){
  const getDesired = db.prepare('SELECT version, doc FROM twin_desired WHERE device_id = ?');
  const getReported = db.prepare('SELECT version, doc FROM twin_reported WHERE device_id = ?');
  const d = getDesired.get(deviceId) as { version: number; doc: string } | undefined;
  const r = getReported.get(deviceId) as { version: number; doc: string } | undefined;
  return {
    desired: d ? { version: d.version, doc: JSON.parse(d.doc) as Json } : { version: 0, doc: {} },
    reported: r ? { version: r.version, doc: JSON.parse(r.doc) as Json } : { version: 0, doc: {} },
  };
}

/** Merge a partial patch into either desired or reported doc, bump version, upsert. */
export function setDoc(db: any, table: 'twin_desired' | 'twin_reported', deviceId: string, patch: Json){
  const now = new Date().toISOString();
  const getStmt = db.prepare(`SELECT version, doc FROM ${table} WHERE device_id = ?`);
  const row = getStmt.get(deviceId) as { version: number; doc: string } | undefined;
  const current: Json = row ? (JSON.parse(row.doc) as Json) : {};
  const next: Json = { ...current, ...patch };
  const nextVersion = (row?.version || 0) + 1;
  const upsert = db.prepare(
    `INSERT INTO ${table} (device_id, version, doc, updated_at) VALUES (@device_id, @version, @doc, @updated_at)
     ON CONFLICT(device_id) DO UPDATE SET version=excluded.version, doc=excluded.doc, updated_at=excluded.updated_at`
  );
  upsert.run({ device_id: deviceId, version: nextVersion, doc: JSON.stringify(next), updated_at: now });
  return { version: nextVersion, doc: next };
}

/** Get the latest connection status for a device from device_events table. */
export function getDeviceStatus(db: any, deviceId: string): { online: boolean; last_seen: string | null } {
  // Ensure device_events table exists
  db.prepare(`CREATE TABLE IF NOT EXISTS device_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload BLOB,
    ts TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  const stmt = db.prepare(`
    SELECT payload, ts FROM device_events 
    WHERE device_id = ? AND topic LIKE '%clients/%'
    ORDER BY id DESC LIMIT 1
  `);
  
  const row = stmt.get(deviceId) as { payload: string; ts: string } | undefined;
  
  if (!row) {
    return { online: false, last_seen: null };
  }
  
  try {
    const payload = JSON.parse(row.payload);
    const isOnline = payload.status === 'online';
    return {
      online: isOnline,
      last_seen: isOnline ? null : row.ts
    };
  } catch {
    return { online: false, last_seen: null };
  }
}

/** Get status for all devices that have connection events. */
export function getAllDeviceStatuses(db: any): Record<string, { online: boolean; last_seen: string | null }> {
  // Ensure device_events table exists
  db.prepare(`CREATE TABLE IF NOT EXISTS device_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload BLOB,
    ts TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

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
  
  return result;
}
