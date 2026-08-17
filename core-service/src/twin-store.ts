/**
 * Device twin storage - the one place `TWIN_DB` is ever opened. Owns
 * desired/reported twin docs and device connection-status events. Called
 * from dbus-twin.ts (the TwinService D-Bus interface twin-service talks to)
 * and directly from index.ts for admin/decommission paths that run in this
 * same process and don't need a D-Bus round trip.
 *
 * Moved here from twin-service/src/db.ts, which used to open this file
 * directly - twin-service now only ever reaches this data via D-Bus.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { TWIN_DB } from './config.js';

export type Json = Record<string, unknown>;
export type TwinDoc = { version: number; doc: Json };
export type DeviceStatus = { online: boolean; last_seen: string | null };

function openDb(): any {
  try {
    fs.mkdirSync(path.dirname(TWIN_DB), { recursive: true });
  } catch { /* ignore */ }
  const db: any = new (Database as any)(TWIN_DB);
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
    CREATE TABLE IF NOT EXISTS device_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload BLOB,
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

/** Load desired and reported docs for a device (defaults to empty). Keyed
 * by the device's assigned MQTT name, same as everything else in this file
 * - never its uuid. */
export function getTwin(deviceId: string): { desired: TwinDoc; reported: TwinDoc } {
  const db = openDb();
  try {
    const d = db.prepare('SELECT version, doc FROM twin_desired WHERE device_id = ?').get(deviceId) as { version: number; doc: string } | undefined;
    const r = db.prepare('SELECT version, doc FROM twin_reported WHERE device_id = ?').get(deviceId) as { version: number; doc: string } | undefined;
    return {
      desired: d ? { version: d.version, doc: JSON.parse(d.doc) as Json } : { version: 0, doc: {} },
      reported: r ? { version: r.version, doc: JSON.parse(r.doc) as Json } : { version: 0, doc: {} },
    };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Merge a partial patch into either desired or reported doc, bump version, upsert. */
export function setTwinDoc(table: 'twin_desired' | 'twin_reported', deviceId: string, patch: Json): TwinDoc {
  const db = openDb();
  try {
    const now = new Date().toISOString();
    const row = db.prepare(`SELECT version, doc FROM ${table} WHERE device_id = ?`).get(deviceId) as { version: number; doc: string } | undefined;
    const current: Json = row ? (JSON.parse(row.doc) as Json) : {};
    const next: Json = { ...current, ...patch };
    const nextVersion = (row?.version || 0) + 1;
    db.prepare(
      `INSERT INTO ${table} (device_id, version, doc, updated_at) VALUES (@device_id, @version, @doc, @updated_at)
       ON CONFLICT(device_id) DO UPDATE SET version=excluded.version, doc=excluded.doc, updated_at=excluded.updated_at`
    ).run({ device_id: deviceId, version: nextVersion, doc: JSON.stringify(next), updated_at: now });
    return { version: nextVersion, doc: next };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Record a device connection/heartbeat event (online or offline). */
export function recordDeviceConnectionStatus(deviceId: string, isOnline: boolean, timestampIso: string): void {
  const db = openDb();
  try {
    const payload = JSON.stringify({ status: isOnline ? 'online' : 'offline', ts: Date.parse(timestampIso) });
    db.prepare(`INSERT INTO device_events (device_id, topic, payload, ts) VALUES (?, ?, ?, datetime('now'))`)
      .run(deviceId, `$SYS/broker/clients/${deviceId}`, payload);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Latest online/offline status for every device with a recorded connection event. */
export function getAllDeviceStatuses(): Record<string, DeviceStatus> {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT device_id, payload, ts FROM device_events e1
      WHERE e1.topic LIKE '%clients/%'
      AND e1.id = (
        SELECT MAX(e2.id) FROM device_events e2
        WHERE e2.device_id = e1.device_id AND e2.topic LIKE '%clients/%'
      )
    `).all() as { device_id: string; payload: string; ts: string }[];
    const result: Record<string, DeviceStatus> = {};
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload);
        const isOnline = payload.status === 'online';
        result[row.device_id] = { online: isOnline, last_seen: isOnline ? null : row.ts };
      } catch {
        result[row.device_id] = { online: false, last_seen: null };
      }
    }
    return result;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Remove all connection-status events for a device (decommission cleanup). */
export function deleteDeviceEvents(deviceId: string): void {
  const db = openDb();
  try {
    db.prepare('DELETE FROM device_events WHERE device_id = ?').run(deviceId);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
