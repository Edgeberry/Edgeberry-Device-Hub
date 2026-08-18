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
    return new Database(DEVICEHUB_DB);
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
