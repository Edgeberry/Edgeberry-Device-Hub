import * as dbus from 'dbus-native';

// D-Bus client configuration - connect to Core service DevicesService
const CORE_BUS_NAME = 'io.edgeberry.devicehub.Core';
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

export async function dbusResolveDeviceNameByUuid(uuid: string): Promise<{ ok: boolean; deviceName?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ uuid });
    const result = await callDbusMethod(CORE_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'ResolveDeviceIdByUuid', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return {
      ok: response.success,
      deviceName: response.name || undefined,
      error: response.error || undefined
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function resolveDeviceNameByUuid(uuid: string): Promise<string | null> {
  try {
    const result = await dbusResolveDeviceNameByUuid(uuid);
    if (!result.ok || !result.deviceName) {
      return null;
    }
    return result.deviceName;
  } catch (error) {
    console.error('[translator-service] Error resolving UUID to device name:', error);
    return null;
  }
}

// Legacy function for backward compatibility
export async function dbusResolveDeviceIdByUuid(uuid: string): Promise<{ ok: boolean; deviceId?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ uuid });
    const result = await callDbusMethod(CORE_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'ResolveDeviceIdByUuid', requestJson);
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

export async function resolveDeviceIdByUuid(uuid: string): Promise<string | null> {
  try {
    const result = await dbusResolveDeviceIdByUuid(uuid);
    if (!result.ok || !result.deviceId) {
      return null;
    }
    return result.deviceId;
  } catch (error) {
    console.error('[translator-service] Error resolving UUID to deviceId:', error);
    return null;
  }
}
