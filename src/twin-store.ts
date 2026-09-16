/**
 * Device twin storage - the one place `TWIN_DB` is ever opened. Owns
 * desired/reported twin docs and device connection-status events. Called
 * from the twin sub-service (services/twin/), the application sub-service,
 * and the admin/decommission paths in index.ts.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { TWIN_DB, ONLINE_THRESHOLD_SECONDS } from './config.js';
import { isDeviceClientId } from './device-names.js';

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
    -- getAllDeviceStatuses() wants the newest row per device; without this the
    -- lookup falls back to scanning the whole table. Declared alongside the
    -- tables rather than as a migration so existing databases pick it up on
    -- the next open.
    CREATE INDEX IF NOT EXISTS idx_device_events_device_id_id
      ON device_events(device_id, id);
  `);
  return db;
}

/** twin.db stamps rows with SQLite's datetime('now'): UTC, but written with a
 *  space separator and no zone marker, which Date.parse() reads as *local*
 *  time. Normalised here so presence does not silently depend on the host's
 *  timezone. An unparseable stamp yields NaN, which fails the freshness test
 *  below and reads as offline - the safe direction. */
function parseUtcTimestamp(ts: string): number {
  return Date.parse(/[TZ]/.test(ts) ? ts : `${ts.replace(' ', 'T')}Z`);
}

/** Turn a device's newest connection row into its status.
 *
 *  A row saying "online" is believed only while it is recent. Devices heartbeat
 *  every 30s and each heartbeat rewrites this row, so a genuinely live device is
 *  never more than one beat stale. Without the age check, a device that vanished
 *  while this sub-service was down - so its disconnect was never observed -
 *  reads as online forever. That is the freshness half of what the heartbeat was
 *  introduced for: the recording was implemented, the checking never was. */
function rowToStatus(payload: string, ts: string): DeviceStatus {
  let reportedOnline = false;
  try { reportedOnline = (JSON.parse(payload) as any)?.status === 'online'; } catch { /* unreadable: offline */ }
  const fresh = (Date.now() - parseUtcTimestamp(ts)) / 1000 <= ONLINE_THRESHOLD_SECONDS;
  const online = reportedOnline && fresh;
  return { online, last_seen: online ? null : ts };
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
    // One pass: the inner query picks the newest connection-status row per
    // device, the outer fetches just those rows. The previous form correlated
    // the subquery to each outer row, re-scanning the table once per row -
    // O(n^2) over a table that is only ever appended to, which was enough to
    // block the event loop outright once the history got long enough.
    const rows = db.prepare(`
      SELECT device_id, payload, ts FROM device_events
      WHERE id IN (
        SELECT MAX(id) FROM device_events
        WHERE topic LIKE '%clients/%'
        GROUP BY device_id
      )
    `).all() as { device_id: string; payload: string; ts: string }[];
    const result: Record<string, DeviceStatus> = {};
    for (const row of rows) result[row.device_id] = rowToStatus(row.payload, row.ts);
    return result;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** The one device's current status, same shape as one entry of
 *  getAllDeviceStatuses(). Presence belongs to connection state, which is what
 *  this table records - deriving it from telemetry arrival instead (as the
 *  admin API used to) reports any device that simply doesn't publish telemetry
 *  as permanently offline. With idx_device_events_device_id_id this is a single
 *  index seek, so callers needing one device should not build the whole map. */
export function getDeviceStatus(deviceId: string): DeviceStatus | null {
  const db = openDb();
  try {
    const row = db.prepare(
      `SELECT payload, ts FROM device_events
       WHERE device_id = ? AND topic LIKE '%clients/%'
       ORDER BY id DESC LIMIT 1`
    ).get(deviceId) as { payload: string; ts: string } | undefined;
    if (!row) return null;
    return rowToStatus(row.payload, row.ts);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/**
 * Delete up to `batch` connection events older than the retention window,
 * returning how many went. Bounded per call for the same reason as
 * pruneTelemetry(): this runs on the thread that serves everything else.
 *
 * Never deletes a device's newest row, whatever its age. getAllDeviceStatuses()
 * reports the latest row per device, so pruning purely by age would erase the
 * status of any device quiet for longer than the window - it would drop out of
 * the device list rather than showing its last known state.
 *
 * The cutoff is computed by SQLite rather than in JS so it is written in the
 * same format datetime('now') stored, which is not the ISO string the other
 * device_events table uses.
 */
export function pruneConnectionEvents(retentionDays: number, batch: number): number {
  if (!(retentionDays > 0)) return 0;
  const db = openDb();
  try {
    const info = db.prepare(
      `DELETE FROM device_events
       WHERE id IN (
         SELECT id FROM device_events
         WHERE ts < datetime('now', ?)
           AND id NOT IN (SELECT MAX(id) FROM device_events GROUP BY device_id)
         LIMIT ?
       )`
    ).run(`-${retentionDays} days`, batch);
    return info?.changes ?? 0;
  } catch (error) {
    console.error('[twin-store] pruneConnectionEvents failed:', error instanceof Error ? error.message : error);
    return 0;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/**
 * Delete up to `batch` rows whose device_id is not a device identity at all -
 * the Hub's own MQTT connections, and bare provisioning UUIDs, recorded before
 * isDeviceClientId() excluded them at the point of writing.
 *
 * Unlike pruneConnectionEvents() this does *not* preserve a newest row: these
 * ids have no device whose status could be lost, so keeping one would just make
 * the junk immortal. The predicate is the same one the twin sub-service now
 * filters on, so the two cannot disagree about what counts as a device.
 */
export function pruneNonDeviceEvents(batch: number): number {
  const db = openDb();
  try {
    const ids = db.prepare('SELECT DISTINCT device_id FROM device_events').all() as { device_id: string }[];
    const junk = ids.map(r => r.device_id).filter(id => !isDeviceClientId(id));
    if (junk.length === 0) return 0;
    const placeholders = junk.map(() => '?').join(',');
    const info = db.prepare(
      `DELETE FROM device_events WHERE id IN (
         SELECT id FROM device_events WHERE device_id IN (${placeholders}) LIMIT ?
       )`
    ).run(...junk, batch);
    return info?.changes ?? 0;
  } catch (error) {
    console.error('[twin-store] pruneNonDeviceEvents failed:', error instanceof Error ? error.message : error);
    return 0;
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
