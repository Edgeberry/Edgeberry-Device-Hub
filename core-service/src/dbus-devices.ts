import * as dbus from 'dbus-native';
import Database from 'better-sqlite3';
import { DEVICEHUB_DB } from './config.js';

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
      // Create devices table if it doesn't exist
      console.log(`[DevicesService] Creating devices table if not exists`);
      db.prepare(`
        CREATE TABLE IF NOT EXISTS devices (
          uuid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token TEXT,
          meta TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();

      // Generate automatic name if none provided: EDGB-<first 4 UUID chars>
      const deviceName = name || `EDGB-${uuid.substring(0, 4).toUpperCase()}`;
      console.log(`[DevicesService] Using device name: ${deviceName}`);

      // Insert or replace device record
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO devices (uuid, name, token, meta, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);
      const result = stmt.run(uuid, deviceName, token || '', metaJson || '{}');
      console.log(`[DevicesService] Database insert result:`, result);
      
      // Verify the device was inserted
      const verifyStmt = db.prepare('SELECT uuid, name FROM devices WHERE uuid = ?');
      const verifyResult = verifyStmt.get(uuid);
      console.log(`[DevicesService] Verification query result:`, verifyResult);
      
      console.log(`[DevicesService] Successfully registered device: ${uuid} (${deviceName})`);
      return JSON.stringify({ success: true, message: 'Device registered successfully' });
    } catch (error) {
      console.error(`[DevicesService] Failed to register device ${uuid}:`, error);
      return JSON.stringify({ success: false, error: `Registration failed: ${(error as Error).message}` });
    } finally {
      db.close();
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
