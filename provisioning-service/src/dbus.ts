import { systemBus } from 'dbus-next';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const WL_OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const WL_IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService';
const CERT_OBJECT_PATH = '/io/edgeberry/devicehub/CertificateService';
const CERT_IFACE_NAME = 'io.edgeberry.devicehub.CertificateService';

let wlIfaceProxy: any | null = null;
let certIfaceProxy: any | null = null;

async function getWhitelistIface(): Promise<any> {
  if (wlIfaceProxy) return wlIfaceProxy;
  const bus = systemBus();
  const obj = await bus.getProxyObject(BUS_NAME, WL_OBJECT_PATH);
  const iface = obj.getInterface(WL_IFACE_NAME);
  wlIfaceProxy = iface as any;
  return wlIfaceProxy;
}

async function getCertIface(): Promise<any> {
  if (certIfaceProxy) return certIfaceProxy;
  const bus = systemBus();
  const obj = await bus.getProxyObject(BUS_NAME, CERT_OBJECT_PATH);
  const iface = obj.getInterface(CERT_IFACE_NAME);
  certIfaceProxy = iface as any;
  return certIfaceProxy;
}

export async function dbusCheckUUID(uuid: string): Promise<{ ok: boolean; note?: string; used_at?: string; error?: string }>{
  const iface = await getWhitelistIface();
  const [ok, note, used_at, error] = await iface.CheckUUID(uuid);
  return { ok: !!ok, note: note || undefined, used_at: used_at || undefined, error: error || undefined };
}

export async function dbusMarkUsed(uuid: string): Promise<{ ok: boolean; error?: string }>{
  const iface = await getWhitelistIface();
  const [ok, error] = await iface.MarkUsed(uuid);
  return { ok: !!ok, error: error || undefined };
}

export async function dbusIssueFromCSR(deviceId: string, csrPem: string, days?: number): Promise<{ ok: boolean; certPem?: string; caChainPem?: string; error?: string }>{
  const iface = await getCertIface();
  const d = typeof days === 'number' && isFinite(days) ? Math.max(1, Math.floor(days)) : 0;
  const [ok, certPem, caChainPem, error] = await iface.IssueFromCSR(deviceId, csrPem, d);
  return { ok: !!ok, certPem: certPem || undefined, caChainPem: caChainPem || undefined, error: error || undefined };
}
