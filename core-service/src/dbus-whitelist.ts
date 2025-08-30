import * as dbus from 'dbus-native';
import { PROVISIONING_DB } from './config.js';
import { openDb, DB } from './types/database-types.js';

type WhitelistEntry = {
  uuid: string;
  name: string;
  description: string;
  timestamp: bigint;
};

// D-Bus constants
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService';

class WhitelistInterface {
  private db: DB | null = null;
  
  private getDb(): DB | null {
    if (!this.db) {
      this.db = openDb(PROVISIONING_DB);
      if (!this.db) {
        console.error('Failed to open whitelist database');
      }
    }
    return this.db;
  }

  async CheckUUID(uuid: string): Promise<[boolean, string, string, string]> {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      console.warn('Invalid UUID provided to CheckUUID');
      return [false, 'invalid_uuid', '', ''];
    }

    const db = this.getDb();
    if (!db) {
      return [false, 'database_error', '', ''];
    }

    try {
      const stmt = db.prepare('SELECT note, created_at, used_at FROM uuid_whitelist WHERE uuid = ?');
      const row = stmt.get(uuid) as { note?: string; created_at?: string; used_at?: string } | undefined;
      
      if (!row) {
        return [false, 'uuid_not_whitelisted', '', ''];
      }

      if (row.used_at) {
        return [false, String(row.note || ''), String(row.used_at || ''), 'uuid_already_used'];
      }

      return [
        true,
        String(row.note || ''),
        String(row.created_at || ''),
        ''
      ];
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('CheckUUID error:', errorMessage);
      return [false, 'internal_error', '', ''];
    }
  }

  async List(): Promise<Array<[string, string, string, bigint]>> {
    const db = this.getDb();
    if (!db) {
      return [];
    }

    try {
      const stmt = db.prepare('SELECT uuid, note, created_at, used_at FROM uuid_whitelist ORDER BY created_at DESC');
      const rows = stmt.all() as Array<{ uuid: string; note: string; created_at: string; used_at?: string }>;
      
      return rows.map(row => [
        row.uuid,
        row.note || '',
        row.created_at || '',
        BigInt(Date.parse(row.used_at || '0'))
      ]);
    } catch (e) {
      console.error('List error:', e);
      return [];
    }
  }

  async Add(uuid: string, note: string): Promise<[boolean, string, string]> {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      return [false, 'invalid_uuid', ''];
    }

    const db = this.getDb();
    if (!db) {
      return [false, 'database_error', ''];
    }

    try {
      const stmt = db.prepare('INSERT INTO uuid_whitelist (uuid, note, created_at) VALUES (?, ?, datetime("now"))');
      const result = stmt.run(uuid.trim(), note || '');
      
      if (result.changes > 0) {
        return [true, '', ''];
      } else {
        return [false, 'insert_failed', ''];
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('Add error:', errorMessage);
      return [false, errorMessage, ''];
    }
  }

  async Remove(uuid: string): Promise<[boolean, string, string]> {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      return [false, 'invalid_uuid', ''];
    }

    const db = this.getDb();
    if (!db) {
      return [false, 'database_error', ''];
    }

    try {
      const stmt = db.prepare('DELETE FROM uuid_whitelist WHERE uuid = ?');
      const result = stmt.run(uuid.trim());
      
      if (result.changes > 0) {
        return [true, '', ''];
      } else {
        return [false, 'uuid_not_found', ''];
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('Remove error:', errorMessage);
      return [false, errorMessage, ''];
    }
  }

  async Get(uuid: string): Promise<[boolean, string, string, string, string]> {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      console.warn('Invalid UUID provided to Get');
      return [false, 'invalid_uuid', '', '', ''];
    }

    const db = this.getDb();
    if (!db) {
      return [false, 'database_error', '', '', ''];
    }

    try {
      const stmt = db.prepare('SELECT note, created_at, used_at FROM uuid_whitelist WHERE uuid = ?');
      const row = stmt.get(uuid) as { note?: string; created_at?: string; used_at?: string } | undefined;
      
      if (!row) {
        return [false, 'uuid_not_whitelisted', '', '', ''];
      }

      return [
        true,
        String(row.note || ''),
        String(row.created_at || ''),
        String(row.used_at || ''),
        ''
      ];
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('Get error:', errorMessage);
      return [false, 'internal_error', '', '', ''];
    }
  }

  async MarkUsed(uuid: string): Promise<[boolean, string]> {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      console.warn('Invalid UUID provided to MarkUsed');
      return [false, 'invalid_uuid'];
    }

    const db = this.getDb();
    if (!db) {
      return [false, 'database_error'];
    }

    try {
      const stmt = db.prepare('UPDATE uuid_whitelist SET used_at = datetime("now") WHERE uuid = ? AND used_at IS NULL');
      const result = stmt.run(uuid.trim());
      
      return [result.changes > 0, ''];
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('MarkUsed error:', errorMessage);
      return [false, errorMessage];
    }
  }
}

export async function startWhitelistDbusServer(): Promise<any> {
  const bus = dbus.systemBus();
  const whitelistService = new WhitelistInterface();
  
  console.log('Starting Whitelist D-Bus server with dbus-native');
  
  // Create service interface using dbus-native pattern
  const service = bus.getService(BUS_NAME);
  const obj = service.createObject(OBJECT_PATH);
  const iface = obj.createInterface(IFACE_NAME);
  
  // Add CheckUUID method
  iface.addMethod('CheckUUID', {
    in: ['s'],
    out: ['b', 's', 's', 's']
  }, async (uuid: string, callback: Function) => {
    try {
      const result = await whitelistService.CheckUUID(uuid);
      callback(null, ...result);
    } catch (error) {
      callback(error);
    }
  });
  
  // Add List method
  iface.addMethod('List', {
    in: [],
    out: ['as']
  }, async (callback: Function) => {
    try {
      const result = await whitelistService.List();
      callback(null, result);
    } catch (error) {
      callback(error);
    }
  });
  
  // Add Add method
  iface.addMethod('Add', {
    in: ['s', 's'],
    out: ['b', 's']
  }, async (uuid: string, note: string, callback: Function) => {
    try {
      const result = await whitelistService.Add(uuid, note);
      callback(null, ...result);
    } catch (error) {
      callback(error);
    }
  });
  
  // Add MarkUsed method
  iface.addMethod('MarkUsed', {
    in: ['s'],
    out: ['b', 's']
  }, async (uuid: string, callback: Function) => {
    try {
      const result = await whitelistService.MarkUsed(uuid);
      callback(null, ...result);
    } catch (error) {
      callback(error);
    }
  });
  
  console.log(`Whitelist D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
