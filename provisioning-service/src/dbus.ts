import * as dbus from 'dbus-native';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const WL_OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const WL_IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService';
const CERT_OBJECT_PATH = '/io/edgeberry/devicehub/CertificateService';
const CERT_IFACE_NAME = 'io.edgeberry.devicehub.CertificateService';

let bus: any | null = null;

function getBus(): any {
  if (!bus) {
    bus = dbus.systemBus();
  }
  return bus;
}

function callDbusMethod(objectPath: string, interfaceName: string, member: string, ...args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const connection = getBus();
    const service = connection.getService(BUS_NAME);
    
    service.getInterface(objectPath, interfaceName, (err: any, iface: any) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Call the method with callback
      const callback = (err: any, ...results: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(results);
      };
      
      // Add callback to args and call method
      iface[member](...args, callback);
    });
  });
}

export async function dbusCheckUUID(uuid: string): Promise<{ ok: boolean; note?: string; used_at?: string; error?: string }> {
  try {
    const result = await callDbusMethod(WL_OBJECT_PATH, WL_IFACE_NAME, 'CheckUUID', uuid);
    const [ok, note, used_at, error] = result;
    return { ok: !!ok, note: note || undefined, used_at: used_at || undefined, error: error || undefined };
  } catch (error) {
    throw error;
  }
}

export async function dbusMarkUsed(uuid: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await callDbusMethod(WL_OBJECT_PATH, WL_IFACE_NAME, 'MarkUsed', uuid);
    const [ok, error] = result;
    return { ok: !!ok, error: error || undefined };
  } catch (error) {
    throw error;
  }
}

export async function dbusIssueFromCSR(uuid: string, csrPem: string, validityDays: number): Promise<{ ok: boolean; certPem?: string; keyPem?: string; error?: string }> {
  try {
    const result = await callDbusMethod(CERT_OBJECT_PATH, CERT_IFACE_NAME, 'IssueFromCSR', uuid, csrPem, validityDays);
    const [ok, certPem, keyPem, error] = result;
    return { ok: !!ok, certPem: certPem || undefined, keyPem: keyPem || undefined, error: error || undefined };
  } catch (error) {
    throw error;
  }
}
