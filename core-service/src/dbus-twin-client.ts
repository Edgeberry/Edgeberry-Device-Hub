import * as dbus from 'dbus-next';

const TWIN_BUS = 'io.edgeberry.devicehub.Twin';
const TWIN_OBJ = '/io/edgeberry/devicehub/Twin';
const TWIN_IFACE = 'io.edgeberry.devicehub.Twin1';

type TwinIface = {
  GetTwin(deviceId: string): Promise<[string, number, string, string]>;
  SetDesired(deviceId: string, patchJson: string): Promise<number>;
  SetReported(deviceId: string, patchJson: string): Promise<number>;
  ListDevices(): Promise<string[]>;
};

let _iface: TwinIface | null = null;

export async function getTwinInterface(): Promise<TwinIface> {
  if (_iface) return _iface;
  const bus = dbus.systemBus();
  const obj = await bus.getProxyObject(TWIN_BUS, TWIN_OBJ);
  const iface = obj.getInterface(TWIN_IFACE) as unknown as TwinIface;
  _iface = iface;
  return iface;
}

export async function twinGetTwin(deviceId: string){
  const iface = await getTwinInterface();
  return iface.GetTwin(deviceId);
}

export async function twinSetDesired(deviceId: string, patch: unknown){
  const iface = await getTwinInterface();
  return iface.SetDesired(deviceId, JSON.stringify(patch ?? {}));
}

export async function twinSetReported(deviceId: string, patch: unknown){
  const iface = await getTwinInterface();
  return iface.SetReported(deviceId, JSON.stringify(patch ?? {}));
}

export async function twinListDevices(){
  const iface = await getTwinInterface();
  return iface.ListDevices();
}
