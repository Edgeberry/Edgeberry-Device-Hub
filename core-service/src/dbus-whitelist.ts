import * as dbus from 'dbus-native';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { PROVISIONING_DB } from './config.js';

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
    
    const db = openDb(PROVISIONING_DB);
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
      const row = db.prepare('SELECT uuid, note, used_at FROM uuid_whitelist WHERE uuid = ?').get(uuid) as any;
      
      if (!row) {
        return JSON.stringify({
          success: false,
          uuid: uuid,
          note: null,
          used_at: null,
          error: 'UUID not found in whitelist'
        });
      }

      return JSON.stringify({
        success: true,
        uuid: row.uuid,
        note: row.note || null,
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
    
    const db = openDb(PROVISIONING_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        uuids: [],
        error: 'Database unavailable'
      });
    }

    try {
      const rows = db.prepare('SELECT uuid, note, created_at, used_at FROM uuid_whitelist ORDER BY created_at DESC').all() as any[];
      
      const entries = rows.map(row => ({
        uuid: row.uuid,
        note: row.note || null,
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
    
    const db = openDb(PROVISIONING_DB);
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

      // Insert new UUID
      db.prepare('INSERT INTO uuid_whitelist (uuid, note, created_at) VALUES (?, ?, ?)').run(uuid, note || null, now);
      
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

  async MarkUsed(uuid: string): Promise<string> {
    console.log(`[WhitelistInterface] MarkUsed called for: ${uuid}`);
    
    const db = openDb(PROVISIONING_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        error: 'Database unavailable'
      });
    }

    try {
      const now = new Date().toISOString();
      
      // Check if UUID exists in whitelist
      const existing = db.prepare('SELECT uuid, used_at FROM uuid_whitelist WHERE uuid = ?').get(uuid) as any;
      if (!existing) {
        return JSON.stringify({
          success: false,
          error: 'UUID not found in whitelist'
        });
      }

      if (existing.used_at) {
        return JSON.stringify({
          success: false,
          error: 'UUID already marked as used'
        });
      }

      // Mark as used
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
