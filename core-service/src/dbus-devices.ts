import * as dbus from 'dbus-native';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { DEVICEHUB_DB } from './config.js';
import { generateDefaultDeviceName, validateDeviceName, sanitizeDeviceName } from './device-names.js';
import { getDevicesListSync, getDeviceByUuid, resolveIdentifierToUuid, resolvePublicIdFromUuid } from './devices-store.js';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/DevicesService';
const IFACE_NAME = 'io.edgeberry.devicehub.DevicesService';

// Typed `Database.Database` here, but this project's own src/types/better-sqlite3.d.ts
// shim + src/types/database-types.ts augmentation shadow the real @types/better-sqlite3
// declarations with an incomplete Database interface (missing .transaction), so - matching
// the `any`-typed openDb() already used in dbus-whitelist.ts and database-types.ts - fall
// back to `any` rather than fighting that shim.
function openDb(path: string): any {
  try {
    return new Database(path);
  } catch (e) {
    console.error(`Failed to open database ${path}:`, e);
    return null;
  }
}

// crypto.randomBytes rather than Math.random(): this name is a security
// boundary now (the whole point is that it must not be predictable), so it
// gets the same randomness source secrets/tokens elsewhere in this codebase
// use. No "EDGB-" prefix (or any other fixed marker) - a device name should
// not read as if it were still tied to a scheme or a brand, which is exactly
// the kind of thing that invites false assumptions about what it encodes.
function generateRandomDeviceName(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

class DevicesInterface {
  async RegisterDevice(uuid: string, name: string, token: string, metaJson: string): Promise<string> {
    console.log(`[DevicesService] RegisterDevice called with uuid=${uuid}, name=${name}, token=${token}, metaJson=${metaJson}`);
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      console.error(`[DevicesService] Failed to open database: ${DEVICEHUB_DB}`);
      return JSON.stringify({ success: false, error: 'Database unavailable' });
    }
    
    try {
      // Ensure devices table exists with correct schema
      console.log(`[DevicesService] Creating devices table if not exists`);
      db.prepare(`CREATE TABLE IF NOT EXISTS devices (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT,
        meta TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      
      // Determine device name: use provided name, validate it, or generate default
      let deviceName = name;
      
      if (!deviceName) {
        // Generate default name if none provided
        deviceName = generateDefaultDeviceName(uuid);
        console.log(`[DevicesService] Generated default device name: ${deviceName}`);
      } else {
        // Validate provided name
        const validation = validateDeviceName(deviceName);
        if (!validation.valid) {
          console.warn(`[DevicesService] Invalid device name "${deviceName}": ${validation.error}`);
          if (validation.sanitized) {
            deviceName = validation.sanitized;
            console.log(`[DevicesService] Using sanitized device name: ${deviceName}`);
          } else {
            deviceName = generateDefaultDeviceName(uuid);
            console.log(`[DevicesService] Using default device name instead: ${deviceName}`);
          }
        }
      }
      
      console.log(`[DevicesService] Inserting device: uuid=${uuid}, name=${deviceName}`);
      const stmt = db.prepare(`INSERT OR REPLACE INTO devices (uuid, name, token, meta, created_at) 
                               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`);
      stmt.run(uuid, deviceName, token || '', metaJson || '{}');
      
      console.log(`[DevicesService] Device registered successfully: ${uuid} -> ${deviceName}`);
      return JSON.stringify({ 
        success: true, 
        message: 'Device registered successfully',
        uuid: uuid,
        name: deviceName
      });
    } catch (error) {
      console.error(`[DevicesService] Registration failed for ${uuid}:`, error);
      return JSON.stringify({ 
        success: false, 
        error: `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    } finally {
      try {
        db.close();
      } catch (e) {
        console.warn(`[DevicesService] Error closing database:`, e);
      }
    }
  }

  // The name a device is assigned during provisioning, so its UUID (a
  // long-lived hardware identity, not a one-time secret) never becomes its
  // ongoing MQTT/TLS identity.
  //
  // Every successful claim gets a *fresh* random name, replacing whatever was
  // reserved before - reprovisioning is meant to be a genuine fresh start,
  // not a renewal of the old identity. The old row for this uuid (if any) is
  // deleted and a new one inserted in the same transaction, so a crash
  // between those two steps can't leave the uuid with no row at all.
  //
  // Random on purpose: a name derived from the UUID would let anyone who
  // learns the UUID predict the device's public identity ahead of time,
  // which defeats the point of masking it. Uniqueness is a real database
  // constraint (see the index below), not just a check-then-insert race -
  // a collision retries with a new candidate rather than silently
  // colliding with (or replacing) a different device's row.
  async ClaimDeviceName(uuid: string): Promise<string> {
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return JSON.stringify({ success: false, deviceId: null, error: 'Database unavailable' });
    }
    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS devices (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT,
        meta TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_name ON devices(name)').run();

      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = generateRandomDeviceName();
        try {
          const claim = db.transaction((deviceUuid: string, deviceName: string) => {
            db.prepare('DELETE FROM devices WHERE uuid = ?').run(deviceUuid);
            db.prepare(`INSERT INTO devices (uuid, name, token, meta, created_at) VALUES (?, ?, '', '{}', CURRENT_TIMESTAMP)`).run(deviceUuid, deviceName);
          });
          claim(uuid, candidate);
          console.log(`[DevicesService] Claimed uuid=${uuid} -> deviceId=${candidate}`);
          return JSON.stringify({ success: true, deviceId: candidate, error: null });
        } catch (e: any) {
          if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || e?.code === 'SQLITE_CONSTRAINT') {
            continue; // name collision - try another candidate
          }
          throw e;
        }
      }
      return JSON.stringify({ success: false, deviceId: null, error: 'name_space_exhausted' });
    } catch (error) {
      return JSON.stringify({
        success: false,
        deviceId: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      try { db.close(); } catch {}
    }
  }

  async ResolveDeviceIdByUuid(uuid: string): Promise<string> {
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        deviceId: null,
        error: 'Database unavailable'
      });
    }
    
    try {
      // Look up device by UUID in the devices table
      // UUID is now the primary key
      const row = db.prepare('SELECT uuid, name FROM devices WHERE uuid = ?').get(uuid) as any;
      
      if (!row) {
        return JSON.stringify({
          success: false,
          deviceId: null,
          error: 'Device not found for UUID'
        });
      }
      
      return JSON.stringify({
        success: true,
        // The device's ongoing identity is its assigned name, not its UUID -
        // this method exists specifically to resolve one to the other, so
        // returning row.uuid here (a leftover from before that distinction
        // existed) would just hand the caller back what they already had.
        deviceId: row.name,
        name: row.name,
        error: null
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        deviceId: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      db.close();
    }
  }

  async GetDeviceInfo(uuid: string): Promise<string> {
    const device = getDeviceByUuid(uuid);
    if (!device) return JSON.stringify({ success: false, device: null, error: 'Device not found' });
    return JSON.stringify({ success: true, device, error: null });
  }

  async ListDevices(): Promise<string> {
    const { devices } = getDevicesListSync();
    return JSON.stringify({ success: true, devices, error: null });
  }

  // Role -> devices.name -> treat as a raw uuid. Used by application-service
  // (which never opens devicehub.db itself) wherever it needs to turn a
  // user-supplied identifier into a uuid.
  async ResolveIdentifier(identifier: string): Promise<string> {
    const uuid = resolveIdentifierToUuid(identifier);
    if (!uuid) return JSON.stringify({ success: false, uuid: null, error: 'Device not found' });
    return JSON.stringify({ success: true, uuid, error: null });
  }

  // uuid -> role if assigned, else raw MQTT name, else the uuid itself - the
  // identifier application clients and the UI should display.
  async ResolvePublicId(uuid: string): Promise<string> {
    const publicId = resolvePublicIdFromUuid(uuid);
    return JSON.stringify({ success: true, publicId, error: null });
  }
}

export async function startDevicesDbusServer(bus: any): Promise<any> {
  const devicesService = new DevicesInterface();
  
  console.log('Starting Devices D-Bus server with dbus-native');

  // Create the service object with actual method implementations
  const serviceObject = {
    // Single JSON string in/out, same as every other method here - the old
    // ['ssss', 's'] + raw-callback shape was the only method in the codebase
    // built that way, and dbus-native's reply marshalling for it crashed the
    // whole process with "Serialisation of JS 'undefined' type is not
    // supported by d-bus" on every successful registration.
    RegisterDevice: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid, name, token, metaJson } = request;
        const result = await devicesService.RegisterDevice(uuid, name, token, metaJson);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    ClaimDeviceName: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid } = request;
        const result = await devicesService.ClaimDeviceName(uuid);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          deviceId: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    ResolveDeviceIdByUuid: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid } = request;
        const result = await devicesService.ResolveDeviceIdByUuid(uuid);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          deviceId: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    GetDeviceInfo: async (deviceId: string) => {
      try {
        const result = await devicesService.GetDeviceInfo(deviceId);
        return result;
      } catch (error) {
        throw error;
      }
    },
    ListDevices: async () => {
      try {
        const result = await devicesService.ListDevices();
        return result;
      } catch (error) {
        throw error;
      }
    },
    ResolveIdentifier: async (identifier: string) => {
      try {
        return await devicesService.ResolveIdentifier(identifier);
      } catch (error) {
        return JSON.stringify({ success: false, uuid: null, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    },
    ResolvePublicId: async (uuid: string) => {
      try {
        return await devicesService.ResolvePublicId(uuid);
      } catch (error) {
        return JSON.stringify({ success: false, publicId: uuid, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      RegisterDevice: ['s', 's'],
      ClaimDeviceName: ['s', 's'],
      ResolveDeviceIdByUuid: ['s', 's'],
      GetDeviceInfo: ['s', 's'],
      ListDevices: ['', 's'],
      ResolveIdentifier: ['s', 's'],
      ResolvePublicId: ['s', 's']
    },
    signals: {}
  });
  
  console.log(`Devices D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
