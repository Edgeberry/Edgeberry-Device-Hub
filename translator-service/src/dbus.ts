import * as dbus from 'dbus-native';

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
  
  const devicesIface: DevicesIface = {
    ResolveDeviceIdByUUID: (uuid: string): Promise<[boolean, string, string]> => {
      return new Promise((resolve, reject) => {
        const service = bus.getService(CORE_BUS);
        service.getInterface(DEVICES_OBJ, DEVICES_IFACE, (err: any, iface: any) => {
          if (err) {
            reject(err);
            return;
          }
          
          iface.ResolveDeviceIdByUUID(uuid, (err: any, ok: boolean, deviceId: string, error: string) => {
            if (err) {
              reject(err);
              return;
            }
            resolve([ok, deviceId, error]);
          });
        });
      });
    }
  };
  
  _iface = devicesIface;
  return devicesIface;
}

export async function resolveDeviceIdByUuid(uuid: string): Promise<string | null> {
  const iface = await getDevicesInterface();
  const [ok, deviceId, err] = await iface.ResolveDeviceIdByUUID(uuid);
  if (!ok) return null;
  return deviceId || null;
}
