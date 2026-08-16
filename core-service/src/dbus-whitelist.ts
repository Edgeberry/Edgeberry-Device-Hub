import * as dbus from 'dbus-native';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DEVICEHUB_DB } from './config.js';

// D-Bus constants
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService';

// Database helper function
function openDb(file: string): any {
  try {
    // Ensure parent directory exists so sqlite can create the DB file
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch {}
    return new Database(file);
  } catch (error) {
    console.error(`Failed to open database ${file}:`, error);
    return null;
  }
}

export class WhitelistInterface {
  async CheckUUID(uuid: string): Promise<string> {
    console.log(`[WhitelistInterface] CheckUUID called for: ${uuid}`);
    
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        uuid: null,
        note: null,
        used_at: null,
        error: 'Database unavailable'
      });
    }

    try {
      const row = db.prepare('SELECT uuid, hardware_version, manufacturer, used_at, disabled_at FROM uuid_whitelist WHERE uuid = ?').get(uuid) as any;

      if (!row) {
        return JSON.stringify({
          success: false,
          uuid: uuid,
          note: null,
          used_at: null,
          error: 'UUID not found in whitelist'
        });
      }

      // An admin-disabled entry is rejected the same way a used one is -
      // just reversible, where used_at never clears.
      if (row.disabled_at) {
        return JSON.stringify({
          success: false,
          uuid: row.uuid,
          note: `${row.manufacturer} ${row.hardware_version}` || null,
          used_at: row.used_at || null,
          error: 'UUID disabled'
        });
      }

      // used_at is informational now ("last claimed"), not a gate - a
      // whitelisted UUID is the device's durable hardware identity, not a
      // one-time secret, and it must be able to reprovision itself (a fresh
      // start: a new random name, a new certificate) for as long as it stays
      // whitelisted and not disabled. disabled_at above is the only thing an
      // admin needs to revoke a specific device's ability to (re)provision.
      return JSON.stringify({
        success: true,
        uuid: row.uuid,
        note: `${row.manufacturer} ${row.hardware_version}` || null,
        used_at: row.used_at || null,
        error: null
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        uuid: null,
        note: null,
        used_at: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      try { db.close(); } catch {}
    }
  }

  async List(): Promise<string> {
    console.log('[WhitelistInterface] List called');
    
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        uuids: [],
        error: 'Database unavailable'
      });
    }

    try {
      const rows = db.prepare('SELECT uuid, hardware_version, manufacturer, created_at, used_at FROM uuid_whitelist ORDER BY created_at DESC').all() as any[];
      
      const entries = rows.map(row => ({
        uuid: row.uuid,
        note: `${row.manufacturer} ${row.hardware_version}` || null,
        created_at: row.created_at,
        used_at: row.used_at || null
      }));

      return JSON.stringify({
        success: true,
        entries: entries,
        error: null
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        entries: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      try { db.close(); } catch {}
    }
  }

  async Add(uuid: string, note: string): Promise<string> {
    console.log(`[WhitelistInterface] Add called for: ${uuid} with note: ${note}`);
    
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        error: 'Database unavailable'
      });
    }

    try {
      const now = new Date().toISOString();
      
      // Check if UUID already exists
      const existing = db.prepare('SELECT uuid FROM uuid_whitelist WHERE uuid = ?').get(uuid);
      if (existing) {
        return JSON.stringify({
          success: false,
          error: 'UUID already exists in whitelist'
        });
      }

      // Parse note to extract manufacturer and hardware_version, or use defaults
      const parts = (note || '').split(' ');
      const manufacturer = parts[0] || 'Unknown';
      const hardware_version = parts[1] || 'Unknown';

      // Insert new UUID with new schema
      db.prepare('INSERT INTO uuid_whitelist (uuid, hardware_version, manufacturer, created_at) VALUES (?, ?, ?, ?)').run(uuid, hardware_version, manufacturer, now);
      
      return JSON.stringify({
        success: true,
        error: null
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      try { db.close(); } catch {}
    }
  }

  // Records the most recent successful claim. No longer a one-shot gate -
  // reprovisioning is meant to work every time, so this always succeeds for
  // a UUID that exists (whether or not it was claimed before). The actual
  // "only one claim in flight at a time" guarantee comes from Mosquitto
  // itself: the provisioning connection's client ID is the UUID, and the
  // broker only tolerates one live connection per client ID, so two
  // concurrent claim attempts for the same UUID can't both be mid-handshake
  // at once (see provisioning-service/src/mqtt.ts).
  async MarkUsed(uuid: string): Promise<string> {
    console.log(`[WhitelistInterface] MarkUsed called for: ${uuid}`);

    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        error: 'Database unavailable'
      });
    }

    try {
      const now = new Date().toISOString();

      const existing = db.prepare('SELECT uuid FROM uuid_whitelist WHERE uuid = ?').get(uuid) as any;
      if (!existing) {
        return JSON.stringify({
          success: false,
          error: 'UUID not found in whitelist'
        });
      }

      const info = db.prepare('UPDATE uuid_whitelist SET used_at = ? WHERE uuid = ?').run(now, uuid);
      
      if (info.changes === 0) {
        return JSON.stringify({
          success: false,
          error: 'Failed to mark UUID as used'
        });
      }

      return JSON.stringify({
        success: true,
        error: null
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      try { db.close(); } catch {}
    }
  }
}

export async function startWhitelistDbusServer(bus: any): Promise<any> {
  const whitelistService = new WhitelistInterface();

  console.log('Starting Whitelist D-Bus server with dbus-native');

  // Create the service object with actual method implementations
  const serviceObject = {
    CheckUUID: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid } = request;
        const result = await whitelistService.CheckUUID(uuid);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          uuid: null,
          note: null,
          used_at: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    List: async (requestJson: string) => {
      try {
        const result = await whitelistService.List();
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          uuids: [],
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    Add: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid, note } = request;
        const result = await whitelistService.Add(uuid, note);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    MarkUsed: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid } = request;
        const result = await whitelistService.MarkUsed(uuid);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      CheckUUID: ['s', 's'],
      List: ['s', 's'],
      Add: ['s', 's'],
      MarkUsed: ['s', 's']
    },
    signals: {}
  });

  console.log(`Whitelist D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
