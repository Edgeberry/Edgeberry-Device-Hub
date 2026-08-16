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
      const callback = (callErr: any, ...results: any[]) => {
        if (callErr) {
          reject(callErr);
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

export async function dbusIssueFromCSR(uuid: string, deviceId: string, csrPem: string, validityDays: number): Promise<{ ok: boolean; certPem?: string; caChainPem?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ uuid, deviceId, csrPem, days: validityDays });
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

export async function dbusClaimDeviceName(uuid: string): Promise<{ ok: boolean; deviceId?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ uuid });
    const result = await callDbusMethod(DEVICES_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'ClaimDeviceName', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return {
      ok: response.success,
      deviceId: response.deviceId || undefined,
      error: response.error || undefined
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Reads back whatever ClaimDeviceName most recently assigned for this uuid,
// without claiming a new name - used by round 2 of provisioning, which must
// see the exact name round 1 handed the device, not a fresh one (see the
// comment above the dbusClaimDeviceName call in mqtt.ts).
export async function dbusResolveDeviceIdByUuid(uuid: string): Promise<{ ok: boolean; deviceId?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ uuid });
    const result = await callDbusMethod(DEVICES_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'ResolveDeviceIdByUuid', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return {
      ok: response.success,
      deviceId: response.deviceId || undefined,
      error: response.error || undefined
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusRegisterDevice(uuid: string, name: string, token: string, metaJson: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Single JSON string in/out, matching every other D-Bus method on Core -
    // see the comment on RegisterDevice in core-service/src/dbus-devices.ts.
    const requestJson = JSON.stringify({ uuid, name, token, metaJson });
    const result = await callDbusMethod(DEVICES_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'RegisterDevice', requestJson);
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
