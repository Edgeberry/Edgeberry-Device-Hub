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

class WhitelistInterface extends (dbus.interface.Interface as any) {
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
  constructor() {
    super(IFACE_NAME);

    // Register all methods with proper type signatures
    this.addMethod('CheckUUID', {
      inSignature: 's',
      outSignature: 'bsss',
      handler: this.checkUUID.bind(this)
    });

    this.addMethod('List', {
      inSignature: '',
      outSignature: 'a(sssx)',
      handler: this.list.bind(this)
    });

    this.addMethod('Add', {
      inSignature: 'ss',
      outSignature: 'bss',
      handler: this.add.bind(this)
    });

    this.addMethod('Remove', {
      inSignature: 's',
      outSignature: 'bss',
      handler: this.remove.bind(this)
    });

    this.addMethod('Get', {
      inSignature: 's',
      outSignature: 'bsssx',
      handler: this.get.bind(this)
    });
  }


  private async checkUUID(uuid: string): Promise<[boolean, string, string, string]> {
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

  private async list(): Promise<Array<[string, string, string, bigint]>> {
    const db = this.getDb();
    if (!db) {
      return [];
    }

    try {
      const stmt = db.prepare(`
        SELECT 
          uuid, 
          note, 
          created_at,
          strftime('%s', used_at) as used_at_ts 
        FROM uuid_whitelist
      `);
      
      const rows = stmt.all() as Array<{
        uuid: string;
        note: string;
        created_at: string;
        used_at_ts: number | null;
      }>;

      return rows.map(row => {
        const timestamp = row.used_at_ts ? BigInt(row.used_at_ts) : 0n;
        
        return [
          String(row.uuid || ''),
          String(row.note || ''),
          String(row.created_at || ''),
          timestamp
        ];
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('List error:', errorMessage);
      return [];
    }
  }

  private async add(uuid: string, note: string): Promise<[boolean, string, string]> {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      console.warn('Invalid UUID provided to Add');
      return [false, 'invalid_uuid', ''];
    }

    const db = this.getDb();
    if (!db) {
      return [false, 'database_error', ''];
    }

    try {
      // Check if UUID already exists
      const existing = db.prepare('SELECT uuid FROM uuid_whitelist WHERE uuid = ?').get(uuid);
      if (existing) {
        return [false, 'uuid_already_exists', ''];
      }
      
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO uuid_whitelist (uuid, note, created_at)
        VALUES (?, ?, ?)
      `);
      
      const result = stmt.run(uuid, note || '', now);
      return [result.changes > 0, 'success', ''];
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('Add error:', errorMessage);
      
      if (errorMessage.includes('UNIQUE constraint failed')) {
        return [false, 'duplicate', ''];
      }
      
      return [false, 'internal_error', errorMessage];
    }
  }

  private async remove(uuid: string): Promise<[boolean, string, string]> {
    if (typeof uuid !== 'string' || !uuid.trim()) {
      console.warn('Invalid UUID provided to Remove');
      return [false, 'invalid_uuid', ''];
    }

    const db = this.getDb();
    if (!db) {
      return [false, 'database_error', ''];
    }

    try {
      const stmt = db.prepare('DELETE FROM uuid_whitelist WHERE uuid = ?');
      const result = stmt.run(uuid);
      
      if (result.changes === 0) {
        return [false, 'not_found', ''];
      }
      
      return [true, 'success', ''];
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('Remove error:', errorMessage);
      return [false, 'internal_error', errorMessage];
    }
  }
}

export async function startWhitelistDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    
    try { 
      await bus.requestName(BUS_NAME, 0);
    } catch (e) {
      console.warn(`[core-service] Could not request name ${BUS_NAME}:`, e);
    }
    
    const iface = new WhitelistInterface();
    bus.export(OBJECT_PATH, iface);
    console.log(`[core-service] D-Bus WhitelistService exported at ${OBJECT_PATH}`);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('[core-service] Failed to start D-Bus WhitelistService:', errorMessage);
    throw e; // Re-throw to allow caller to handle the error
  }
}
