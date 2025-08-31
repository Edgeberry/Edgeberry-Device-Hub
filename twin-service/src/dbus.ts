import * as dbus from 'dbus-native';
import { getTwin, setDoc } from './db.js';
import type { Json } from './types.js';
import fs from 'node:fs';

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

// Twin service now acts as a client to Core's TwinService D-Bus interface
export async function dbusGetTwin(deviceId: string): Promise<{ ok: boolean; desiredJson?: string; desiredVersion?: number; reportedJson?: string; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceId });
    const result = await callDbusMethod(CORE_BUS_NAME, TWIN_OBJECT_PATH, TWIN_IFACE_NAME, 'GetTwin', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return {
      ok: response.success,
      desiredJson: response.desiredJson || undefined,
      desiredVersion: response.desiredVersion || undefined,
      reportedJson: response.reportedJson || undefined,
      error: response.error || undefined
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusSetDesired(deviceId: string, desiredJson: string): Promise<{ ok: boolean; newVersion?: number; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceId, desiredJson });
    const result = await callDbusMethod(CORE_BUS_NAME, TWIN_OBJECT_PATH, TWIN_IFACE_NAME, 'SetDesired', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return {
      ok: response.success,
      newVersion: response.newVersion || undefined,
      error: response.error || undefined
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function dbusSetReported(deviceId: string, reportedJson: string): Promise<{ ok: boolean; newVersion?: number; error?: string }> {
  try {
    const requestJson = JSON.stringify({ deviceId, reportedJson });
    const result = await callDbusMethod(CORE_BUS_NAME, TWIN_OBJECT_PATH, TWIN_IFACE_NAME, 'SetReported', requestJson);
    const responseJson = result[0];
    const response = JSON.parse(responseJson);
    return {
      ok: response.success,
      newVersion: response.newVersion || undefined,
      error: response.error || undefined
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Initialize D-Bus client connection (no server functionality)
export async function startTwinDbusClient(): Promise<void> {
  let version = 'unknown';
  try {
    const pkgJsonPath = new URL('../package.json', import.meta.url);
    const pkgRaw = fs.readFileSync(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    version = pkg.version ?? version;
  } catch {}
  console.log(`[twin-service] v${version} D-Bus client initialized for ${CORE_BUS_NAME}`);
}

