import * as dbus from 'dbus-native';
import Database from 'better-sqlite3';
import { DEVICEHUB_DB } from './config.js';
import { generateDefaultDeviceName, validateDeviceName, sanitizeDeviceName } from './device-names.js';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/DevicesService';
const IFACE_NAME = 'io.edgeberry.devicehub.DevicesService';

function openDb(path: string): Database.Database | null {
  try {
    return new Database(path);
  } catch (e) {
    console.error(`Failed to open database ${path}:`, e);
    return null;
  }
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
        deviceId: row.uuid,
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

  async GetDeviceInfo(deviceId: string): Promise<string> {
    // Placeholder implementation
    return JSON.stringify({ success: false, name: '', error: 'Device not found' });
  }

  async ListDevices(): Promise<string> {
    // Placeholder implementation
    return JSON.stringify([]);
  }
}

export async function startDevicesDbusServer(bus: any): Promise<any> {
  const devicesService = new DevicesInterface();
  
  console.log('Starting Devices D-Bus server with dbus-native');

  // Create the service object with actual method implementations
  const serviceObject = {
    RegisterDevice: (uuid: string, name: string, token: string, metaJson: string, callback: (err: any, result?: string) => void) => {
      console.log(`[D-Bus DevicesService] RegisterDevice called with callback pattern`);
      devicesService.RegisterDevice(uuid, name, token, metaJson)
        .then(result => callback(null, result))
        .catch(error => callback(error));
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
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      RegisterDevice: ['ssss', 's'],
      ResolveDeviceIdByUuid: ['s', 's'],
      GetDeviceInfo: ['s', 's'],
      ListDevices: ['', 's']
    },
    signals: {}
  });
  
  console.log(`Devices D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
