import Database from 'better-sqlite3';
import { PROVISIONING_DB } from './config.js';
import * as dbus from 'dbus-next';

// D-Bus constants
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService';

function openDb(file: string){
  try {
    const db: any = new (Database as any)(file);
    db.pragma('journal_mode = WAL');
    return db as any;
  } catch {
    return null;
  }
}

// Define the D-Bus interface with dbus-next high-level Interface
// Note: cast Interface to any (same pattern as dbus-certs) to avoid runtime issues with TS decorator metadata
class WhitelistInterface extends (dbus.interface.Interface as any) {
  constructor() {
    super(IFACE_NAME);
    // Register methods imperatively to avoid decorator runtime issues
    this.addMethod(
      'CheckUUID',
      { inSignature: 's', outSignature: 'bsss' },
      (uuid: string) => this._CheckUUID(uuid)
    );
    this.addMethod(
      'MarkUsed',
      { inSignature: 's', outSignature: 'bs' },
      (uuid: string) => this._MarkUsed(uuid)
    );
  }

  // CheckUUID(s uuid) → (b ok, s note, s used_at, s error)
  private _CheckUUID(uuid: string): [boolean, string, string, string] {
    try {
      const db = openDb(PROVISIONING_DB);
      if (!db) return [false, '', '', 'db_unavailable'];
      try {
        const row = db.prepare('SELECT uuid, note, created_at, used_at FROM uuid_whitelist WHERE uuid = ?').get(uuid);
        if (!row) return [false, '', '', 'uuid_not_whitelisted'];
        if (row.used_at) return [false, String(row.note || ''), String(row.used_at || ''), 'uuid_already_used'];
        return [true, String(row.note || ''), String(row.used_at || ''), ''];
      } finally {
        try { db.close(); } catch {}
      }
    } catch (e: any) {
      return [false, '', '', String(e?.message || 'error')];
    }
  }

  // MarkUsed(s uuid) → (b ok, s error)
  private _MarkUsed(uuid: string): [boolean, string] {
    try {
      const db = openDb(PROVISIONING_DB);
      if (!db) return [false, 'db_unavailable'];
      try {
        const now = new Date().toISOString();
        const info = db.prepare('UPDATE uuid_whitelist SET used_at = ? WHERE uuid = ? AND used_at IS NULL').run(now, uuid);
        // ok even if 0 changes (idempotent) as long as row exists
        const exists = db.prepare('SELECT 1 FROM uuid_whitelist WHERE uuid = ?').get(uuid);
        if (!exists) return [false, 'uuid_not_whitelisted'];
        return [true, ''];
      } finally {
        try { db.close(); } catch {}
      }
    } catch (e: any) {
      return [false, String(e?.message || 'error')];
    }
  }
}

export async function startWhitelistDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    // Requesting name is handled by systemd Type=dbus; but harmless to request here as well
    try { await bus.requestName(BUS_NAME, 0); } catch {}

    const iface = new WhitelistInterface();
    const obj = bus.export(OBJECT_PATH, iface as unknown as dbus.interface.Interface);
    console.log('[core-service] D-Bus WhitelistService exported at', OBJECT_PATH);
  } catch (e) {
    console.error('[core-service] failed to start D-Bus WhitelistService', e);
  }
}
