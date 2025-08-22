import Database from 'better-sqlite3';
import { PROVISIONING_DB } from './config.js';
import * as dbus from 'dbus-next';

// D-Bus: Devices interface owned by core-service
// Bus: io.edgeberry.devicehub.Core (same as other core interfaces)
// Object: /io/edgeberry/devicehub/Devices
// Interface: io.edgeberry.devicehub.Devices1
// Methods:
//   ResolveDeviceIdByUUID(s uuid) -> (b ok, s device_id, s error)

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/Devices';
const IFACE_NAME = 'io.edgeberry.devicehub.Devices1';

function openDb(file: string){
  try {
    const db: any = new (Database as any)(file);
    db.pragma('journal_mode = WAL');
    return db as any;
  } catch {
    return null;
  }
}

class DevicesInterface extends (dbus.interface.Interface as any) {
  constructor(){
    super(IFACE_NAME);
    this.addMethod(
      'ResolveDeviceIdByUUID',
      { inSignature: 's', outSignature: 'bss' },
      (uuid: string) => this._ResolveDeviceIdByUUID(uuid)
    );
  }

  private _ResolveDeviceIdByUUID(uuid: string): [boolean, string, string] {
    try {
      if (!uuid || typeof uuid !== 'string') return [false, '', 'invalid_uuid'];
      const db = openDb(PROVISIONING_DB);
      if (!db) return [false, '', 'db_unavailable'];
      try {
        // devices(id TEXT PRIMARY KEY, name TEXT, token TEXT, meta TEXT, created_at TEXT)
        // meta JSON may contain { uuid: string }
        const rows: Array<{ id: string; meta: string | null }> = db.prepare('SELECT id, meta FROM devices').all();
        for (const r of rows){
          if (!r || !r.meta) continue;
          try {
            const meta = JSON.parse(r.meta || '{}');
            const u = typeof meta?.uuid === 'string' ? String(meta.uuid) : undefined;
            if (u && u === uuid) return [true, String(r.id || ''), ''];
          } catch {}
        }
        return [false, '', 'uuid_not_mapped'];
      } finally {
        try { db.close(); } catch {}
      }
    } catch (e: any) {
      return [false, '', String(e?.message || 'error')];
    }
  }
}

export async function startDevicesDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    try { await bus.requestName(BUS_NAME, 0); } catch {}
    const iface = new DevicesInterface();
    bus.export(OBJECT_PATH, iface as unknown as dbus.interface.Interface);
    console.log('[core-service] D-Bus Devices1 exported at', OBJECT_PATH);
  } catch (e) {
    console.error('[core-service] failed to start D-Bus Devices1', e);
  }
}
