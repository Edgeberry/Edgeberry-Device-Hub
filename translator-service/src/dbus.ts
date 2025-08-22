import * as dbus from 'dbus-next';

const CORE_BUS = 'io.edgeberry.devicehub.Core';
const DEVICES_OBJ = '/io/edgeberry/devicehub/Devices';
const DEVICES_IFACE = 'io.edgeberry.devicehub.Devices1';

type DevicesIface = {
  ResolveDeviceIdByUUID(uuid: string): Promise<[boolean, string, string]>;
};

let _iface: DevicesIface | null = null;

export async function getDevicesInterface(): Promise<DevicesIface> {
  if (_iface) return _iface;
  const bus = dbus.systemBus();
  const obj = await bus.getProxyObject(CORE_BUS, DEVICES_OBJ);
  const iface = obj.getInterface(DEVICES_IFACE) as unknown as DevicesIface;
  _iface = iface;
  return iface;
}

export async function resolveDeviceIdByUuid(uuid: string): Promise<string | null> {
  const iface = await getDevicesInterface();
  const [ok, deviceId, err] = await iface.ResolveDeviceIdByUUID(uuid);
  if (!ok) return null;
  return deviceId || null;
}
