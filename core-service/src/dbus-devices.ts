import * as dbus from 'dbus-native';
import Database from 'better-sqlite3';

const BUS_NAME = 'io.edgeberry.devicehub.DevicesService';
const OBJECT_PATH = '/io/edgeberry/devicehub/DevicesService';
const IFACE_NAME = 'io.edgeberry.devicehub.DevicesService';

const PROVISIONING_DB = process.env.PROVISIONING_DB || 'provisioning.db';

function openDb(path: string): Database.Database | null {
  try {
    return new Database(path);
  } catch (e) {
    console.error(`Failed to open database ${path}:`, e);
    return null;
  }
}

class DevicesInterface {
  async RegisterDevice(deviceId: string, name: string, token: string, metaJson: string): Promise<[boolean, string]> {
    const db = openDb(PROVISIONING_DB);
    if (!db) return [false, 'Database unavailable'];
    
    try {
      // Create devices table if it doesn't exist
      db.prepare(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          name TEXT,
          token TEXT,
          meta TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();
      
      // Insert or replace device record
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO devices (id, name, token, meta, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);
      
      stmt.run(deviceId, name || '', token || '', metaJson || '{}');
      console.log(`[DevicesService] Registered device: ${deviceId}`);
      return [true, 'Device registered successfully'];
    } catch (error) {
      console.error(`[DevicesService] Failed to register device ${deviceId}:`, error);
      return [false, `Registration failed: ${(error as Error).message}`];
    } finally {
      db.close();
    }
  }

  async ResolveDeviceIdByUuid(uuid: string): Promise<string> {
    const db = openDb(PROVISIONING_DB);
    if (!db) {
      return JSON.stringify({
        success: false,
        deviceId: null,
        error: 'Database unavailable'
      });
    }
    
    try {
      // Look up device by UUID in the devices table
      // In the provisioning flow, devices are registered with their UUID as the device ID initially
      // or we might have a separate uuid_to_device mapping table
      const row = db.prepare('SELECT id FROM devices WHERE id = ?').get(uuid) as any;
      
      if (!row) {
        return JSON.stringify({
          success: false,
          deviceId: null,
          error: 'Device not found for UUID'
        });
      }
      
      return JSON.stringify({
        success: true,
        deviceId: row.id,
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

  async GetDeviceInfo(deviceId: string): Promise<[boolean, string, string]> {
    // Placeholder implementation
    return [false, '', 'Device not found'];
  }

  async ListDevices(): Promise<string[]> {
    // Placeholder implementation
    return [];
  }
}

export async function startDevicesDbusServer(bus: any): Promise<any> {
  const devicesService = new DevicesInterface();
  
  console.log('Starting Devices D-Bus server with dbus-native');

  // Create the service object with actual method implementations
  const serviceObject = {
    RegisterDevice: async (deviceId: string, name: string, token: string, metaJson: string) => {
      try {
        const result = await devicesService.RegisterDevice(deviceId, name, token, metaJson);
        return result;
      } catch (error) {
        throw error;
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
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      RegisterDevice: ['ssss', 'bs'],
      ResolveDeviceIdByUuid: ['s', 's'],
      GetDeviceInfo: ['s', 'bss'],
      ListDevices: ['', 'as']
    },
    signals: {}
  });
  
  console.log(`Devices D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
