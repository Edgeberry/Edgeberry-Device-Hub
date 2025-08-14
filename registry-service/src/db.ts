import Database from 'better-sqlite3';

/** Initialize SQLite and ensure `device_events` table exists. */
export function initDb(path: string){
  const db: any = new (Database as any)(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload BLOB,
      ts TEXT NOT NULL
    );
  `);
  return db as any;
}

/** Prepare and return an insert statement for device events. */
export function prepareInsert(db: any){
  return db.prepare('INSERT INTO device_events (device_id, topic, payload, ts) VALUES (@device_id, @topic, @payload, @ts)');
}
