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
    CREATE TABLE IF NOT EXISTS uuid_whitelist (
      uuid TEXT PRIMARY KEY,
      device_id TEXT,
      name TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      used_at TEXT
    );
  `);
  // Migrate from older schema where device_id was NOT NULL
  try{
    const cols: Array<{ name: string; notnull: number }>|undefined = db.prepare('PRAGMA table_info(uuid_whitelist)').all();
    const devCol = Array.isArray(cols) ? cols.find((c:any)=>c.name==='device_id') : undefined;
    if (devCol && Number(devCol.notnull) === 1) {
      db.exec('BEGIN');
      db.prepare(
        'CREATE TABLE IF NOT EXISTS uuid_whitelist_new ('+
        ' uuid TEXT PRIMARY KEY,'+
        ' device_id TEXT,'+
        ' name TEXT,'+
        ' note TEXT,'+
        ' created_at TEXT NOT NULL,'+
        ' used_at TEXT)'
      ).run();
      db.prepare('INSERT OR IGNORE INTO uuid_whitelist_new (uuid, device_id, name, note, created_at, used_at) SELECT uuid, device_id, name, note, created_at, used_at FROM uuid_whitelist').run();
      db.prepare('DROP TABLE uuid_whitelist').run();
      db.prepare('ALTER TABLE uuid_whitelist_new RENAME TO uuid_whitelist').run();
      db.exec('COMMIT');
    }
  }catch(e){ try{ db.exec('ROLLBACK'); }catch{} }
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

export function getWhitelistByUuid(db: any, uuid: string){
  const row = db.prepare('SELECT uuid, note, created_at, used_at FROM uuid_whitelist WHERE uuid = ?').get(uuid);
  return row || null;
}

export function markWhitelistUsed(db: any, uuid: string){
  const now = new Date().toISOString();
  db.prepare('UPDATE uuid_whitelist SET used_at = ? WHERE uuid = ? AND used_at IS NULL').run(now, uuid);
}

export function insertWhitelist(db: any, uuid: string, note?: string){
  const now = new Date().toISOString();
  db.prepare('INSERT INTO uuid_whitelist (uuid, note, created_at) VALUES (?, ?, ?)')
    .run(uuid, (typeof note === 'string' && note.trim() ? String(note).trim() : null), now);
}

export function deleteWhitelist(db: any, uuid: string){
  db.prepare('DELETE FROM uuid_whitelist WHERE uuid = ?').run(uuid);
}

export function listWhitelist(db: any){
  return db.prepare('SELECT uuid, note, created_at, used_at FROM uuid_whitelist ORDER BY created_at DESC').all();
}

export type DB = any;
