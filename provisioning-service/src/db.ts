import Database from 'better-sqlite3';
import { Json } from './types.js';

/** Initialize SQLite and ensure device table exists. */
export function initDb(path: string) {
  const db: any = new (Database as any)(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      token TEXT,
      meta TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db as any;
}

/** Insert or update a device record by id. */
export function upsertDevice(db: any, deviceId: string, name?: string, token?: string, meta?: Json) {
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO devices (id, name, token, meta, created_at) VALUES (@id, @name, @token, @meta, @created_at)
     ON CONFLICT(id) DO UPDATE SET name=coalesce(excluded.name, devices.name), token=coalesce(excluded.token, devices.token), meta=coalesce(excluded.meta, devices.meta)`
  );
  ins.run({ id: deviceId, name: name || null, token: token || null, meta: meta ? JSON.stringify(meta) : null, created_at: now });
}

export type DB = any;
