import * as dbus from 'dbus-native';
import { getTwin, setDoc } from './db.js';
import type { Json } from './types.js';
import fs from 'node:fs';

const BUS_NAME = 'io.edgeberry.devicehub.Twin';
const OBJECT_PATH = '/io/edgeberry/devicehub/Twin';
const IFACE_NAME = 'io.edgeberry.devicehub.Twin1';

// We avoid the high-level Interface API and use the low-level message handler API
// to register D-Bus methods without decorators or subclassing.

export async function startTwinDbusServer(db: any): Promise<void> {
  const bus = dbus.systemBus();
  
  // Create service interface using dbus-native pattern
  const service = bus.getService(BUS_NAME);
  const obj = service.createObject(OBJECT_PATH);
  const iface = obj.createInterface(IFACE_NAME);
  
  // Add GetTwin method
  iface.addMethod('GetTwin', {
    in: ['s'],
    out: ['s', 'u', 's', 's']
  }, (deviceId: string, callback: Function) => {
    try {
      const twin = getTwin(db, deviceId);
      const desired = JSON.stringify(twin.desired.doc as Json);
      const reported = JSON.stringify(twin.reported.doc as Json);
      callback(null, desired, twin.desired.version >>> 0, reported, '');
    } catch (e: any) {
      callback(null, '', 0, '', String(e?.message || 'error'));
    }
  });
  
  // Add SetDesired method
  iface.addMethod('SetDesired', {
    in: ['s', 's'],
    out: ['u']
  }, (deviceId: string, patchJson: string, callback: Function) => {
    try {
      const patch = patchJson ? (JSON.parse(patchJson) as Json) : {};
      const { version } = setDoc(db, 'twin_desired', deviceId, patch);
      callback(null, version >>> 0);
    } catch {
      callback(null, 0);
    }
  });
  
  // Add SetReported method
  iface.addMethod('SetReported', {
    in: ['s', 's'],
    out: ['u']
  }, (deviceId: string, patchJson: string, callback: Function) => {
    try {
      const patch = patchJson ? (JSON.parse(patchJson) as Json) : {};
      const { version } = setDoc(db, 'twin_reported', deviceId, patch);
      callback(null, version >>> 0);
    } catch {
      callback(null, 0);
    }
  });
  
  // Add ListDevices method
  iface.addMethod('ListDevices', {
    in: [],
    out: ['as']
  }, (callback: Function) => {
    try {
      const rows = db
        .prepare('SELECT device_id FROM twin_desired UNION SELECT device_id FROM twin_reported')
        .all() as { device_id: string }[];
      callback(null, rows.map((r) => r.device_id));
    } catch {
      callback(null, [] as string[]);
    }
  });
  
  let version = 'unknown';
  try {
    const pkgJsonPath = new URL('../package.json', import.meta.url);
    const pkgRaw = fs.readFileSync(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    version = pkg.version ?? version;
  } catch {}
  console.log(`[twin-service] v${version} D-Bus ${IFACE_NAME} listening at ${OBJECT_PATH}`);
}

