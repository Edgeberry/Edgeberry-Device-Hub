import { systemBus } from 'dbus-next';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService';

let ifaceProxy: any | null = null;

async function getIface(): Promise<any> {
  if (ifaceProxy) return ifaceProxy;
  const bus = systemBus();
  const obj = await bus.getProxyObject(BUS_NAME, OBJECT_PATH);
  const iface = obj.getInterface(IFACE_NAME);
  ifaceProxy = iface as any;
  return ifaceProxy;
}

export async function dbusCheckUUID(uuid: string): Promise<{ ok: boolean; note?: string; used_at?: string; error?: string }>{
  const iface = await getIface();
  const [ok, note, used_at, error] = await iface.CheckUUID(uuid);
  return { ok: !!ok, note: note || undefined, used_at: used_at || undefined, error: error || undefined };
}

export async function dbusMarkUsed(uuid: string): Promise<{ ok: boolean; error?: string }>{
  const iface = await getIface();
  const [ok, error] = await iface.MarkUsed(uuid);
  return { ok: !!ok, error: error || undefined };
}
