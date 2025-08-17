#!/usr/bin/env node
// Seed 3 sample devices into core-service provisioning DB for development
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const repoRoot = path.resolve(process.cwd());
const dbDir = path.resolve(repoRoot, 'core-service', 'data');
const dbPath = path.join(dbDir, 'provisioning.db');
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
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

const now = new Date().toISOString();
const devices = [
  { id: 'dev-001', name: 'Boiler Room Sensor', uuid: '11111111-1111-1111-1111-111111111111' },
  { id: 'dev-002', name: 'Packaging Line PLC', uuid: '22222222-2222-2222-2222-222222222222' },
  { id: 'dev-003', name: 'Cold Storage Probe', uuid: '33333333-3333-3333-3333-333333333333' },
];

const stmt = db.prepare(`INSERT INTO devices (id, name, token, meta, created_at)
  VALUES (@id, @name, NULL, @meta, @created_at)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, meta=excluded.meta`);

for (const d of devices){
  stmt.run({ id: d.id, name: d.name, meta: JSON.stringify({ uuid: d.uuid }), created_at: now });
}

db.close();
console.log(`Seeded ${devices.length} devices into ${dbPath}`);
