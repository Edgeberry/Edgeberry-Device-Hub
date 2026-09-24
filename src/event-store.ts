/**
 * Generic device event/telemetry storage, backed by devicehub.db's
 * `device_events` table (event_type/payload/ts, FK'd to devices.uuid - see
 * ensureDeviceHubSchema in index.ts). Used by the application sub-service's
 * telemetry/events REST endpoints.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DEVICEHUB_DB } from './config.js';

function openDb(): any {
  try {
    fs.mkdirSync(path.dirname(DEVICEHUB_DB), { recursive: true });
  } catch { /* ignore */ }
  try {
    const db: any = new Database(DEVICEHUB_DB);
    // Same rationale as twin-store's: only takes effect on a database
    // created from scratch, so a fresh install never grows the freelist
    // that incrementalVacuum() drains on existing ones.
    db.pragma('auto_vacuum = INCREMENTAL');
    return db;
  } catch (error) {
    console.error(`Failed to open database ${DEVICEHUB_DB}:`, error);
    return null;
  }
}

export type EventRecord = { deviceUuid: string; eventType: string; ts: string; data: any };
export type EventFilter = {
  deviceUuid?: string;
  /** Restrict to a set of devices - used to serve group queries, where the
   *  caller resolved the group to its member uuids. An empty array means "no
   *  devices match" and yields no rows, rather than being ignored. */
  deviceUuids?: string[];
  eventType?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
};

export function recordEvent(deviceUuid: string, eventType: string, data: any): { ok: boolean; ts?: string; error?: string } {
  const db = openDb();
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    const ts = new Date().toISOString();
    db.prepare('INSERT INTO device_events (device_id, event_type, payload, ts) VALUES (?, ?, ?, ?)')
      .run(deviceUuid, eventType, JSON.stringify(data ?? {}), ts);
    return { ok: true, ts };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/**
 * Delete up to `batch` telemetry rows older than `cutoffIso`, returning how
 * many went. Bounded on purpose: better-sqlite3 runs on the one thread that
 * also serves HTTP and MQTT, so a single unbounded DELETE over millions of
 * rows would stall the whole hub. The caller sweeps repeatedly instead.
 *
 * Deleting by id from a subquery rather than `DELETE ... LIMIT`, which needs a
 * SQLite compiled with SQLITE_ENABLE_UPDATE_DELETE_LIMIT and so is not
 * portable across better-sqlite3 builds.
 */
/**
 * Return up to `pages` freed pages to the filesystem.
 *
 * Deleting rows does not shrink a SQLite file - the pages go on a freelist and
 * are reused, but never handed back. Pruning alone therefore leaves a database
 * that is mostly empty and still enormous: before this existed, devicehub.db
 * had reached 531 MB of which 530.6 MB was free, and twin.db 35 MB at 83% free.
 *
 * Bounded per call, for the same reason the prunes above are batched:
 * better-sqlite3 is synchronous, so an unbounded reclaim would block HTTP and
 * MQTT for its whole duration - the very stall retention exists to avoid.
 *
 * Silently does nothing unless the database was created with, or has since been
 * converted to, `auto_vacuum = INCREMENTAL`. Converting an existing file needs a
 * one-off `PRAGMA auto_vacuum = INCREMENTAL; VACUUM;` with the service stopped;
 * the pragma in openDb() only takes effect on a database created from scratch.
 */
export function incrementalVacuum(pages: number): number {
  const db = openDb();
  try {
    const before = db.pragma('freelist_count', { simple: true }) as number;
    if (!(before > 0)) return 0;
    db.pragma(`incremental_vacuum(${Math.max(1, Math.floor(pages))})`);
    const after = db.pragma('freelist_count', { simple: true }) as number;
    return Math.max(0, before - after);
  } catch (error) {
    console.error('[event-store] incrementalVacuum failed:', error instanceof Error ? error.message : error);
    return 0;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

export function pruneTelemetry(retentionDays: number, batch: number): number {
  if (!(retentionDays > 0)) return 0;
  const db = openDb();
  if (!db) return 0;
  try {
    // Cutoff built in JS, because recordEvent() stamps ts with
    // `new Date().toISOString()`. twin.db's same-named table stamps its rows
    // with SQLite's datetime('now') instead, which is a different string shape
    // ("... 06:58:39" vs "...T06:58:39.123Z") - so each table has to build its
    // own cutoff, and a shared one would compare wrongly.
    const cutoffIso = new Date(Date.now() - retentionDays * 86400_000).toISOString();
    const info = db.prepare(
      'DELETE FROM device_events WHERE id IN (SELECT id FROM device_events WHERE ts < ? LIMIT ?)'
    ).run(cutoffIso, batch);
    return info?.changes ?? 0;
  } catch (error) {
    console.error('[event-store] pruneTelemetry failed:', error instanceof Error ? error.message : error);
    return 0;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

export function queryEvents(filter: EventFilter): EventRecord[] {
  const db = openDb();
  if (!db) return [];
  try {
    let query = 'SELECT device_id, event_type, payload, ts FROM device_events WHERE 1=1';
    const params: any[] = [];
    if (filter.deviceUuid) { query += ' AND device_id = ?'; params.push(filter.deviceUuid); }
    if (filter.deviceUuids) {
      if (filter.deviceUuids.length === 0) return [];
      query += ` AND device_id IN (${filter.deviceUuids.map(() => '?').join(',')})`;
      params.push(...filter.deviceUuids);
    }
    if (filter.eventType) { query += ' AND event_type = ?'; params.push(filter.eventType); }
    if (filter.startTime) { query += ' AND ts >= ?'; params.push(filter.startTime); }
    if (filter.endTime) { query += ' AND ts <= ?'; params.push(filter.endTime); }
    query += ' ORDER BY ts DESC LIMIT ? OFFSET ?';
    params.push(Number(filter.limit) || 100, Number(filter.offset) || 0);

    const rows = db.prepare(query).all(...params) as Array<{ device_id: string; event_type: string; payload: string; ts: string }>;
    return rows.map(r => ({
      deviceUuid: r.device_id,
      eventType: r.event_type,
      ts: r.ts,
      data: (() => { try { return JSON.parse(r.payload || '{}'); } catch { return {}; } })()
    }));
  } catch (error) {
    console.error('[event-store] queryEvents failed:', error);
    return [];
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
