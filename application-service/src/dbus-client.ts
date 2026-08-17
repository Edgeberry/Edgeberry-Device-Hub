/**
 * D-Bus client for core-service's data services. application-service used
 * to open devicehub.db directly for all of this - core-service is now the
 * sole owner of that file, so every device/token/event lookup goes through
 * one of these calls instead. Same callDbusMethod pattern as
 * provisioning-service/src/dbus.ts and twin-service/src/dbus.ts.
 */
import * as dbus from 'dbus-native';

const SERVICE = 'application-service';
const CORE_BUS_NAME = 'io.edgeberry.devicehub.Core';

const DEVICES_OBJECT_PATH = '/io/edgeberry/devicehub/DevicesService';
const DEVICES_IFACE_NAME = 'io.edgeberry.devicehub.DevicesService';
const TOKEN_OBJECT_PATH = '/io/edgeberry/devicehub/TokenService';
const TOKEN_IFACE_NAME = 'io.edgeberry.devicehub.TokenService';
const EVENTS_OBJECT_PATH = '/io/edgeberry/devicehub/EventsService';
const EVENTS_IFACE_NAME = 'io.edgeberry.devicehub.EventsService';
const TWIN_OBJECT_PATH = '/io/edgeberry/devicehub/TwinService';
const TWIN_IFACE_NAME = 'io.edgeberry.devicehub.TwinService';

let bus: any | null = null;

function getBus(): any {
  if (!bus) bus = dbus.systemBus();
  return bus;
}

function callDbusMethod(busName: string, objectPath: string, interfaceName: string, member: string, ...args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const connection = getBus();
    const service = connection.getService(busName);
    service.getInterface(objectPath, interfaceName, (err: any, iface: any) => {
      if (err) { reject(err); return; }
      const callback = (callErr: any, ...results: any[]) => {
        if (callErr) { reject(callErr); return; }
        resolve(results);
      };
      iface[member](...args, callback);
    });
  });
}

export type DeviceListEntry = {
  uuid: string;
  name: string;
  role: string | null;
  token: string;
  meta: any;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  disabled: boolean;
};

export async function dbusListDevices(): Promise<DeviceListEntry[]> {
  try {
    const result = await callDbusMethod(CORE_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'ListDevices');
    const response = JSON.parse(result[0] as string);
    return response.success ? response.devices : [];
  } catch (error) {
    console.error(`[${SERVICE}] dbusListDevices failed:`, error);
    return [];
  }
}

export async function dbusGetDeviceInfo(uuid: string): Promise<DeviceListEntry | null> {
  try {
    const result = await callDbusMethod(CORE_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'GetDeviceInfo', uuid);
    const response = JSON.parse(result[0] as string);
    return response.success ? response.device : null;
  } catch (error) {
    console.error(`[${SERVICE}] dbusGetDeviceInfo failed:`, error);
    return null;
  }
}

/** Role -> devices.name -> raw uuid. Returns null if nothing resolves. */
export async function dbusResolveIdentifier(identifier: string): Promise<string | null> {
  if (!identifier) return null;
  try {
    const result = await callDbusMethod(CORE_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'ResolveIdentifier', identifier);
    const response = JSON.parse(result[0] as string);
    return response.success ? response.uuid : null;
  } catch (error) {
    console.error(`[${SERVICE}] dbusResolveIdentifier failed:`, error);
    return null;
  }
}

/** uuid -> role if assigned, else raw MQTT name, else the uuid itself. */
export async function dbusResolvePublicId(uuid: string): Promise<string> {
  try {
    const result = await callDbusMethod(CORE_BUS_NAME, DEVICES_OBJECT_PATH, DEVICES_IFACE_NAME, 'ResolvePublicId', uuid);
    const response = JSON.parse(result[0] as string);
    return response.publicId || uuid;
  } catch (error) {
    console.error(`[${SERVICE}] dbusResolvePublicId failed:`, error);
    return uuid;
  }
}

export type TokenInfo = { id: string; name: string; scopes: string[] };

export async function dbusVerifyToken(token: string): Promise<{ ok: boolean; token?: TokenInfo; error?: string }> {
  try {
    const result = await callDbusMethod(CORE_BUS_NAME, TOKEN_OBJECT_PATH, TOKEN_IFACE_NAME, 'VerifyToken', token);
    const response = JSON.parse(result[0] as string);
    if (!response.success) return { ok: false, error: response.error || 'Invalid token' };
    return { ok: true, token: { id: response.id, name: response.name, scopes: response.scopes || [] } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusRecordEvent(deviceUuid: string, eventType: string, data: any): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceUuid, eventType, payloadJson: JSON.stringify(data ?? {}) });
    const result = await callDbusMethod(CORE_BUS_NAME, EVENTS_OBJECT_PATH, EVENTS_IFACE_NAME, 'RecordEvent', requestJson);
    const response = JSON.parse(result[0] as string);
    return { ok: response.success, ts: response.ts, error: response.error || undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export type EventRecord = { deviceUuid: string; eventType: string; ts: string; data: any };

export async function dbusQueryEvents(filter: { deviceUuid?: string; eventType?: string; startTime?: string; endTime?: string; limit?: number; offset?: number }): Promise<EventRecord[]> {
  try {
    const result = await callDbusMethod(CORE_BUS_NAME, EVENTS_OBJECT_PATH, EVENTS_IFACE_NAME, 'QueryEvents', JSON.stringify(filter));
    const response = JSON.parse(result[0] as string);
    return response.success ? response.events : [];
  } catch (error) {
    console.error(`[${SERVICE}] dbusQueryEvents failed:`, error);
    return [];
  }
}

export type TwinDoc = { version: number; doc: Record<string, unknown> };

export async function dbusGetTwin(deviceId: string): Promise<{ ok: boolean; desired?: TwinDoc; reported?: TwinDoc; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceId });
    const result = await callDbusMethod(CORE_BUS_NAME, TWIN_OBJECT_PATH, TWIN_IFACE_NAME, 'GetTwin', requestJson);
    const response = JSON.parse(result[0] as string);
    return { ok: response.success, desired: response.desired, reported: response.reported, error: response.error || undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
