/**
 * EventsService - generic device event/telemetry storage for
 * application-service, backed by devicehub.db's `device_events` table
 * (event_type/payload/ts, FK'd to devices.uuid - see ensureDeviceHubSchema
 * in index.ts). That table was already defined for exactly this purpose
 * but nothing ever wrote to it: application-service's own telemetry/events
 * REST routes queried a table shape (columns `timestamp`/`data`) that
 * doesn't exist anywhere, so they very likely already errored on every
 * call. This is the first real implementation.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DEVICEHUB_DB } from './config.js';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/EventsService';
const IFACE_NAME = 'io.edgeberry.devicehub.EventsService';

function openDb(file: string): any {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch { /* ignore */ }
  try {
    return new Database(file);
  } catch (error) {
    console.error(`Failed to open database ${file}:`, error);
    return null;
  }
}

class EventsInterface {
  async RecordEvent(deviceUuid: string, eventType: string, payloadJson: string): Promise<string> {
    const db = openDb(DEVICEHUB_DB);
    if (!db) return JSON.stringify({ success: false, error: 'Database unavailable' });
    try {
      const ts = new Date().toISOString();
      db.prepare('INSERT INTO device_events (device_id, event_type, payload, ts) VALUES (?, ?, ?, ?)')
        .run(deviceUuid, eventType, payloadJson || '{}', ts);
      return JSON.stringify({ success: true, ts, error: null });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  }

  async QueryEvents(requestJson: string): Promise<string> {
    const db = openDb(DEVICEHUB_DB);
    if (!db) return JSON.stringify({ success: false, events: [], error: 'Database unavailable' });
    try {
      const { deviceUuid, eventType, startTime, endTime, limit, offset } = JSON.parse(requestJson);
      let query = 'SELECT device_id, event_type, payload, ts FROM device_events WHERE 1=1';
      const params: any[] = [];
      if (deviceUuid) { query += ' AND device_id = ?'; params.push(deviceUuid); }
      if (eventType) { query += ' AND event_type = ?'; params.push(eventType); }
      if (startTime) { query += ' AND ts >= ?'; params.push(startTime); }
      if (endTime) { query += ' AND ts <= ?'; params.push(endTime); }
      query += ' ORDER BY ts DESC LIMIT ? OFFSET ?';
      params.push(Number(limit) || 100, Number(offset) || 0);

      const rows = db.prepare(query).all(...params) as Array<{ device_id: string; event_type: string; payload: string; ts: string }>;
      const events = rows.map(r => ({
        deviceUuid: r.device_id,
        eventType: r.event_type,
        ts: r.ts,
        data: (() => { try { return JSON.parse(r.payload || '{}'); } catch { return {}; } })()
      }));
      return JSON.stringify({ success: true, events, error: null });
    } catch (error) {
      return JSON.stringify({ success: false, events: [], error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

export async function startEventsDbusServer(bus: any): Promise<any> {
  const eventsService = new EventsInterface();

  const serviceObject = {
    RecordEvent: async (requestJson: string) => {
      try {
        const { deviceUuid, eventType, payloadJson } = JSON.parse(requestJson);
        return await eventsService.RecordEvent(deviceUuid, eventType, payloadJson);
      } catch (error) {
        return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    },
    QueryEvents: async (requestJson: string) => {
      try {
        return await eventsService.QueryEvents(requestJson);
      } catch (error) {
        return JSON.stringify({ success: false, events: [], error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  };

  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      RecordEvent: ['s', 's'],
      QueryEvents: ['s', 's']
    },
    signals: {}
  });

  console.log(`Events D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
