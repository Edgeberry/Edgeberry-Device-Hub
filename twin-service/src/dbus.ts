import * as dbus from 'dbus-next';
import { getTwin, setDoc } from './db.js';
import type { Json } from './types.js';

const BUS_NAME = 'io.edgeberry.devicehub.Twin';
const OBJECT_PATH = '/io/edgeberry/devicehub/Twin';
const IFACE_NAME = 'io.edgeberry.devicehub.Twin1';

class TwinInterface extends (dbus.interface.Interface as any) {
  private _db: any;
  constructor(db: any) {
    super(IFACE_NAME);
    this._db = db;
    this.addMethod('GetTwin', { inSignature: 's', outSignature: 'suss' }, (deviceId: string) => this._GetTwin(deviceId));
    this.addMethod('SetDesired', { inSignature: 'ss', outSignature: 'u' }, (deviceId: string, patchJson: string) => this._SetDoc('twin_desired', deviceId, patchJson));
    this.addMethod('SetReported', { inSignature: 'ss', outSignature: 'u' }, (deviceId: string, patchJson: string) => this._SetDoc('twin_reported', deviceId, patchJson));
    // Optional MVP: ListDevices -> empty for now (not persisted list).
    this.addMethod('ListDevices', { inSignature: '', outSignature: 'as' }, () => this._ListDevices());
  }

  // GetTwin(s deviceId) -> (s desiredJson, u desiredVersion, s reportedJson, s error)
  private _GetTwin(deviceId: string): [string, number, string, string] {
    try {
      const twin = getTwin(this._db, deviceId);
      const desired = JSON.stringify(twin.desired.doc as Json);
      const reported = JSON.stringify(twin.reported.doc as Json);
      return [desired, twin.desired.version, reported, ''];
    } catch (e: any) {
      return ['', 0, '', String(e?.message || 'error')];
    }
  }

  // SetDesired/SetReported -> (u version)
  private _SetDoc(table: 'twin_desired' | 'twin_reported', deviceId: string, patchJson: string): number {
    try {
      const patch = patchJson ? (JSON.parse(patchJson) as Json) : {};
      const { version } = setDoc(this._db, table, deviceId, patch);
      return version >>> 0; // ensure unsigned
    } catch {
      return 0;
    }
  }

  private _ListDevices(): string[] {
    try {
      const rows = this._db.prepare('SELECT device_id FROM twin_desired UNION SELECT device_id FROM twin_reported').all() as { device_id: string }[];
      return rows.map(r => r.device_id);
    } catch {
      return [];
    }
  }
}

export async function startTwinDbusServer(db: any): Promise<void> {
  const bus = dbus.systemBus();
  try { await bus.requestName(BUS_NAME, 0); } catch {}
  const iface = new TwinInterface(db);
  bus.export(OBJECT_PATH, iface as unknown as dbus.interface.Interface);
  console.log('[twin-service] D-Bus Twin1 exported at', OBJECT_PATH);
}
