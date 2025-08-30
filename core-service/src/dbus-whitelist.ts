import * as dbus from 'dbus-next';
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

export async function startWhitelistDbusServer(): Promise<dbus.MessageBus> {
  const bus = dbus.systemBus();
  
  const whitelistService = new WhitelistInterface();
  
  // Add method handler for WhitelistService methods
  (bus as any).addMethodHandler(async (msg: any) => {
    if (msg.path === OBJECT_PATH && msg.interface === IFACE_NAME) {
      const method = msg.member;
      const args = msg.body || [];
      
      try {
        switch (method) {
          case 'CheckUUID':
            return await whitelistService.CheckUUID(args[0]);
          case 'List':
            return await whitelistService.List();
          case 'Add':
            return await whitelistService.Add(args[0], args[1]);
          case 'Remove':
            return await whitelistService.Remove(args[0]);
          case 'Get':
            return await whitelistService.Get(args[0]);
          case 'MarkUsed':
            return await whitelistService.MarkUsed(args[0]);
          default:
            throw new Error(`Unknown method: ${method}`);
        }
      } catch (error) {
        console.error(`[dbus-whitelist] Error in ${method}:`, error);
        throw error;
      }
    }
    
    // Handle introspection
    if (msg.path === OBJECT_PATH && msg.interface === 'org.freedesktop.DBus.Introspectable' && msg.member === 'Introspect') {
      return `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="${IFACE_NAME}">
    <method name="CheckUUID">
      <arg direction="in" type="s" name="uuid"/>
      <arg direction="out" type="b" name="ok"/>
      <arg direction="out" type="s" name="note"/>
      <arg direction="out" type="s" name="created_at"/>
      <arg direction="out" type="s" name="error"/>
    </method>
    <method name="MarkUsed">
      <arg direction="in" type="s" name="uuid"/>
      <arg direction="out" type="b" name="ok"/>
      <arg direction="out" type="s" name="error"/>
    </method>
  </interface>
</node>`;
    }
  });
  
  await bus.requestName(BUS_NAME, 0);
  console.log(`[dbus-whitelist] WhitelistService exported at ${OBJECT_PATH} on system bus`);
  
  return bus as any;
}
