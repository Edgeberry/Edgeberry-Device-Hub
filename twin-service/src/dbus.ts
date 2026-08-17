import fs from 'fs';
import dbus from 'dbus-native';
import type { Json } from './types.js';

const SERVICE = 'twin-service';

// D-Bus client configuration - connect to Core service, don't claim bus name
const CORE_BUS_NAME = 'io.edgeberry.devicehub.Core';
const TWIN_OBJECT_PATH = '/io/edgeberry/devicehub/TwinService';
const TWIN_IFACE_NAME = 'io.edgeberry.devicehub.TwinService';

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

export type TwinDoc = { version: number; doc: Json };

/** Twin service acts purely as a client to Core's TwinService D-Bus
 * interface - it never opens twin.db itself. Returns both desired and
 * reported so callers (mqtt.ts) never need a second round trip to compute
 * a delta. */
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

export async function dbusSetDesired(deviceId: string, patch: Json): Promise<{ ok: boolean; desired?: TwinDoc; reported?: TwinDoc; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceId, patchJson: JSON.stringify(patch) });
    const result = await callDbusMethod(CORE_BUS_NAME, TWIN_OBJECT_PATH, TWIN_IFACE_NAME, 'SetDesired', requestJson);
    const response = JSON.parse(result[0] as string);
    return { ok: response.success, desired: response.desired, reported: response.reported, error: response.error || undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusSetReported(deviceId: string, patch: Json): Promise<{ ok: boolean; desired?: TwinDoc; reported?: TwinDoc; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceId, patchJson: JSON.stringify(patch) });
    const result = await callDbusMethod(CORE_BUS_NAME, TWIN_OBJECT_PATH, TWIN_IFACE_NAME, 'SetReported', requestJson);
    const response = JSON.parse(result[0] as string);
    return { ok: response.success, desired: response.desired, reported: response.reported, error: response.error || undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusUpdateDeviceStatus(deviceId: string, status: string, timestamp: number): Promise<boolean> {
  try {
    const result = await callDbusMethod(CORE_BUS_NAME, TWIN_OBJECT_PATH, TWIN_IFACE_NAME, 'UpdateDeviceStatus', deviceId, status, timestamp.toString());
    const response = JSON.parse(result[0] as string);
    return response.success;
  } catch (error: any) {
    console.error(`[${SERVICE}] Failed to update device status via D-Bus:`, error);
    throw new Error(`Failed to report device status to core-service: ${error?.message || 'Unknown error'}`);
  }
}

// Initialize D-Bus client connection (no server functionality)
export async function startTwinDbusClient(): Promise<void> {
  let version = 'unknown';
  try {
    const pkgJsonPath = new URL('../package.json', import.meta.url);
    const pkgRaw = fs.readFileSync(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    version = pkg.version;
  } catch (error) {
    console.warn(`[${SERVICE}] could not read package.json for version:`, error);
  }

  // Add global error handler for unhandled D-Bus errors
  process.on('uncaughtException', (error) => {
    if (error.message && error.message.includes('No root XML node')) {
      console.error(`[${SERVICE}] D-Bus XML introspection error (non-fatal):`, error.message);
      return; // Don't crash the service for D-Bus introspection errors
    }
    // Re-throw other uncaught exceptions
    throw error;
  });

  console.log(`[${SERVICE}] v${version} D-Bus client initialized for ${CORE_BUS_NAME}`);
}
