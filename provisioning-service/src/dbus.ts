import * as dbus from 'dbus-native';

// D-Bus service configuration
const WHITELIST_BUS_NAME = 'io.edgeberry.devicehub.Core';
const WHITELIST_OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const WHITELIST_IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService';

const CERT_BUS_NAME = 'io.edgeberry.devicehub.Core';
const CERT_OBJECT_PATH = '/io/edgeberry/devicehub/CertificateService';
const CERT_IFACE_NAME = 'io.edgeberry.devicehub.CertificateService';

const DEVICES_BUS_NAME = 'io.edgeberry.devicehub.Core';
const DEVICES_OBJECT_PATH = '/io/edgeberry/devicehub/DevicesService';
const DEVICES_IFACE_NAME = 'io.edgeberry.devicehub.DevicesService';

let bus: any | null = null;

function getBus(): any {
  if (!bus) {
    bus = dbus.systemBus();
  }
  return bus;
}

function callDbusMethod(busName: string, objectPath: string, interfaceName: string, member: string, ...args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const connection = getBus();
    const service = connection.getService(busName);
    
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
    const requestJson = JSON.stringify({ uuid });
    const result = await callDbusMethod(WHITELIST_BUS_NAME, WHITELIST_OBJECT_PATH, WHITELIST_IFACE_NAME, 'CheckUUID', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return { 
      ok: response.success, 
      note: response.note || undefined, 
      used_at: response.used_at || undefined,
      error: response.error || undefined
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusMarkUsed(uuid: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const requestJson = JSON.stringify({ uuid });
    const result = await callDbusMethod(WHITELIST_BUS_NAME, WHITELIST_OBJECT_PATH, WHITELIST_IFACE_NAME, 'MarkUsed', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return { 
      ok: response.success, 
      error: response.error || undefined 
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusIssueFromCSR(deviceId: string, csrPem: string, validityDays: number): Promise<{ ok: boolean; certPem?: string; caChainPem?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceId, csrPem, days: validityDays });
    const result = await callDbusMethod(CERT_BUS_NAME, CERT_OBJECT_PATH, CERT_IFACE_NAME, 'IssueFromCSR', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return { 
      ok: response.success, 
      certPem: response.certPem || undefined, 
      caChainPem: response.caChainPem || undefined, 
      error: response.error || undefined 
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusRegisterDevice(deviceId: string, name: string, token: string, metaJson: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await callDbusMethod(DEVICES_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'RegisterDevice', deviceId, name, token, metaJson);
    const [success, message] = result;
    return { 
      ok: success, 
      error: success ? undefined : message 
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
