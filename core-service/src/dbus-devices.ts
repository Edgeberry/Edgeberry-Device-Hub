import * as dbus from 'dbus-next';
import { PROVISIONING_DB } from './config.js';
import { openDb, DeviceRow, DeviceMeta, DB } from './types/database-types.js';

// D-Bus constants
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/Core/Devices1';
const IFACE_NAME = 'io.edgeberry.devicehub.Core.Devices1';

type DBusVariant = {
  type: string;
  value: unknown;
};

type DBusDict = Record<string, DBusVariant>;

class DevicesInterface extends (dbus.interface.Interface as any) {
  private db: DB | null = null;
  
  private getDb(): DB | null {
    if (!this.db) {
      this.db = openDb(PROVISIONING_DB);
      if (!this.db) {
        console.error('Failed to open database');
      }
    }
    return this.db;
  }
  constructor() {
    super(IFACE_NAME);
    
    // Register methods with the correct signature format
    this.addMethod('List', { 
      inSignature: '', 
      outSignature: 'aa{sv}',
      handler: this.list.bind(this)
    });
    
    this.addMethod('Get', { 
      inSignature: 's', 
      outSignature: 'a{sv}',
      handler: this.get.bind(this)
    });
    
    this.addMethod('Set', { 
      inSignature: 'sa{sv}', 
      outSignature: 'b',
      handler: this.set.bind(this)
    });
    
    this.addMethod('Remove', { 
      inSignature: 's', 
      outSignature: 'b',
      handler: this.remove.bind(this)
    });
    
    this.addMethod('ResolveDeviceIdByUUID', {
      inSignature: 's',
      outSignature: 's',
      handle: this._resolveDeviceIdByUUID.bind(this)
    });
    
    this.addMethod('UpdateLastSeen', { 
      inSignature: 's', 
      outSignature: 'b',
      handle: this._updateLastSeen.bind(this)
    });
  }


  private async list(): Promise<DBusDict[]> {
    const db = this.getDb();
    if (!db) return [];
    
    try {
      const stmt = db.prepare('SELECT id, meta, created_at, updated_at FROM devices');
      const rows = stmt.all() as DeviceRow[];
      
      return rows.map(row => {
        try {
          const meta: DeviceMeta = row.meta ? JSON.parse(row.meta) : {};
          return {
            id: { type: 's', value: String(row.id || '') },
            meta: { type: 's', value: JSON.stringify(meta) },
            createdAt: { type: 't', value: new Date(row.created_at as string).getTime() || 0 },
            updatedAt: { type: 't', value: new Date(row.updated_at as string).getTime() || 0 }
          } as unknown as DBusDict;
        } catch (e) {
          console.error(`Error processing device ${row.id}:`, e);
          return {} as DBusDict;
        }
      });
    } catch (error) {
      console.error('Error listing devices:', error);
      return [];
    }
  }
  
  private async get(deviceId: string): Promise<DBusDict> {
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      console.warn('Invalid device ID provided to Get');
      return {} as DBusDict;
    }
    
    const db = this.getDb();
    if (!db) return {} as DBusDict;
    
    try {
      const stmt = db.prepare('SELECT id, meta, created_at, updated_at FROM devices WHERE id = ?');
      const row = stmt.get(deviceId) as DeviceRow | undefined;
      
      if (!row) {
        console.warn(`Device not found: ${deviceId}`);
        return {} as DBusDict;
      }
      
      const meta: DeviceMeta = row.meta ? JSON.parse(row.meta) : {};
      return {
        id: { type: 's', value: String(row.id || '') },
        meta: { type: 's', value: JSON.stringify(meta) },
        createdAt: { type: 't', value: new Date(row.created_at as string).getTime() || 0 },
        updatedAt: { type: 't', value: new Date(row.updated_at as string).getTime() || 0 }
      } as unknown as DBusDict;
    } catch (error) {
      console.error(`Error getting device ${deviceId}:`, error);
      return {} as DBusDict;
    }
  }
  
  private async set(deviceId: string, properties: DBusDict): Promise<boolean> {
    if (typeof deviceId !== 'string' || !deviceId.trim() || !properties) {
      console.warn('Invalid parameters for Set');
      return false;
    }
    
    const db = this.getDb();
    if (!db) return false;
    
    const now = new Date().toISOString();
    
    try {
      // Get existing device to merge with updates
      const getStmt = db.prepare('SELECT meta FROM devices WHERE id = ?');
      const existing = getStmt.get(deviceId) as { meta?: string } | undefined;
      
      let meta: DeviceMeta = {};
      if (existing?.meta) {
        try {
          meta = JSON.parse(existing.meta);
        } catch (e) {
          console.warn(`Error parsing existing meta for device ${deviceId}:`, e);
        }
      }
      
      // Update meta with new properties
      for (const [key, variant] of Object.entries(properties)) {
        if (key === 'meta' && variant?.type === 's' && typeof variant.value === 'string') {
          try {
            const newMeta = JSON.parse(variant.value);
            meta = { ...meta, ...newMeta };
          } catch (e) {
            console.warn(`Error parsing meta for device ${deviceId}:`, e);
          }
        }
      }
      
      const upsertStmt = db.prepare(`
        INSERT INTO devices (id, meta, updated_at, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          meta = excluded.meta,
          updated_at = excluded.updated_at
      `);
      
      const result = upsertStmt.run(
        deviceId,
        JSON.stringify(meta),
        now,
        existing ? undefined : now // Only set created_at for new records
      );
      
      return result.changes > 0;
    } catch (error) {
      console.error(`Error setting properties for device ${deviceId}:`, error);
      return false;
    }
  }
  
  private async remove(deviceId: string): Promise<boolean> {
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      console.warn('Invalid device ID provided to Remove');
      return false;
    }
    
    const db = this.getDb();
    if (!db) return false;
    
    try {
      const stmt = db.prepare('DELETE FROM devices WHERE id = ?');
      const result = stmt.run(deviceId);
      return result.changes > 0;
    } catch (error) {
      console.error(`Error removing device ${deviceId}:`, error);
      return false;
    }
  }
  
  private async _updateLastSeen(deviceId: string): Promise<boolean> {
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      console.warn('Invalid device ID provided to UpdateLastSeen');
      return false;
    }
    
    const db = this.getDb();
    if (!db) return false;
    
    try {
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        UPDATE devices 
        SET meta = json_set(COALESCE(meta, '{}'), '$.lastSeen', ?)
        WHERE id = ?
      `);
      const result = stmt.run(now, deviceId);
      return result.changes > 0;
    } catch (error) {
      console.error(`Error updating last seen for device ${deviceId}:`, error);
      return false;
    }
  }
  
  private _resolveDeviceIdByUUID(uuid: string): string {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      console.warn('Invalid UUID provided to ResolveDeviceIdByUUID');
      return '';
    }
    
    const db = openDb(PROVISIONING_DB);
    if (!db) {
      console.error('Failed to open database for device resolution');
      return '';
    }
    
    try {
      const stmt = db.prepare('SELECT id, meta FROM devices');
      const rows = stmt.all() as DeviceRow[];
      
      for (const row of rows) {
        if (!row?.meta) continue;
        
        try {
          const meta: DeviceMeta = JSON.parse(row.meta);
          const deviceUuid = meta?.uuid;
          if (deviceUuid === uuid) {
            return String(row.id || '');
          }
        } catch (e) {
          console.error(`Error parsing meta for device ${row.id}:`, e);
        }
      }
      
      console.debug(`No device found with UUID: ${uuid}`);
      return '';
    } catch (error) {
      console.error('Error in _resolveDeviceIdByUUID:', error);
      return '';
    } finally {
      try { db?.close(); } catch (e) {
        console.error('Error closing database:', e);
      }
    }
  }
}

export async function startDevicesDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    
    try { 
      await bus.requestName(BUS_NAME, 0);
    } catch (e) {
      console.warn(`[core-service] Could not request name ${BUS_NAME}:`, e);
    }
    
    const iface = new DevicesInterface();
    bus.export(OBJECT_PATH, iface);
    console.log(`[core-service] D-Bus DevicesService exported at ${OBJECT_PATH}`);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('[core-service] Failed to start D-Bus DevicesService:', errorMessage);
    throw e; // Re-throw to allow caller to handle the error
  }
}
