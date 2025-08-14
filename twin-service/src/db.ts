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
