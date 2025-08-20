import * as dbus from 'dbus-next';
import { twinGetTwin, twinSetDesired, twinSetReported, twinListDevices } from './dbus-twin-client.js';

// Core is the primary D-Bus surface; expose Twin operations on the Core bus name
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/TwinService';
const IFACE_NAME = 'io.edgeberry.devicehub.TwinService';

class CoreTwinInterface extends (dbus.interface.Interface as any) {
  constructor() {
    super(IFACE_NAME);
    this.addMethod('GetTwin', { inSignature: 's', outSignature: 'suss' }, (deviceId: string) => this._GetTwin(deviceId));
    this.addMethod('SetDesired', { inSignature: 'ss', outSignature: 'bus' }, (deviceId: string, patchJson: string) => this._SetDesired(deviceId, patchJson));
    this.addMethod('SetReported', { inSignature: 'ss', outSignature: 'bus' }, (deviceId: string, patchJson: string) => this._SetReported(deviceId, patchJson));
    this.addMethod('ListDevices', { inSignature: '', outSignature: 'as' }, () => this._ListDevices());
  }

  // Mirror Twin signatures for GetTwin: (desiredJson, desiredVersion, reportedJson, error)
  private async _GetTwin(deviceId: string): Promise<[string, number, string, string]> {
    try {
      const [desired, dver, reported, err] = await twinGetTwin(deviceId);
      return [desired, dver >>> 0, reported, err || ''];
    } catch (e: any) {
      return ['', 0, '', String(e?.message || 'error')];
    }
  }

  // For SetDesired/SetReported, expose (ok, version, error)
  private async _SetDesired(deviceId: string, patchJson: string): Promise<[boolean, number, string]> {
    try {
      const v = await twinSetDesired(deviceId, patchJson ? JSON.parse(patchJson) : {});
      const ver = (typeof v === 'number' ? v : 0) >>> 0;
      return [ver > 0, ver, ''];
    } catch (e: any) {
      return [false, 0, String(e?.message || 'error')];
    }
  }
  private async _SetReported(deviceId: string, patchJson: string): Promise<[boolean, number, string]> {
    try {
      const v = await twinSetReported(deviceId, patchJson ? JSON.parse(patchJson) : {});
      const ver = (typeof v === 'number' ? v : 0) >>> 0;
      return [ver > 0, ver, ''];
    } catch (e: any) {
      return [false, 0, String(e?.message || 'error')];
    }
  }

  private async _ListDevices(): Promise<string[]> {
    try { return await twinListDevices(); } catch { return []; }
  }
}

export async function startCoreTwinDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    try { await bus.requestName(BUS_NAME, 0); } catch {}
    const iface = new CoreTwinInterface();
    bus.export(OBJECT_PATH, iface as unknown as dbus.interface.Interface);
    console.log('[core-service] D-Bus TwinService exported at', OBJECT_PATH);
  } catch (e) {
    console.error('[core-service] failed to start D-Bus TwinService', e);
  }
}
