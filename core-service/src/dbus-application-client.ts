/**
 * D-Bus client for calling Application Service methods
 */
import * as dbus from 'dbus-native';

const APP_BUS_NAME = 'io.edgeberry.devicehub.ApplicationService';
const APP_OBJECT_PATH = '/io/edgeberry/devicehub/ApplicationService';
const APP_IFACE_NAME = 'io.edgeberry.devicehub.ApplicationService';

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

/**
 * Get connection status from application-service via D-Bus
 */
export async function getConnectionStatus(): Promise<{
  totalConnections: number;
  activeApplications: number;
  connections: Array<{
    tokenId: string;
    appName: string;
    connectionCount: number;
    subscriptions: Array<{
      topics: string[];
      devices: string[];
    }>;
  }>;
}> {
  try {
    const result = await callDbusMethod(
      APP_BUS_NAME,
      APP_OBJECT_PATH,
      APP_IFACE_NAME,
      'GetConnectionStatus'
    );
    
    const response = JSON.parse(result[0] as string);
    
    if (response.success) {
      return {
        totalConnections: response.totalConnections || 0,
        activeApplications: response.activeApplications || 0,
        connections: response.connections || []
      };
    } else {
      throw new Error(response.error || 'Unknown error');
    }
  } catch (error: any) {
    console.error('[core-service] Failed to get connection status via D-Bus:', error.message);
    // Return empty status on error to keep UI functional
    return {
      totalConnections: 0,
      activeApplications: 0,
      connections: []
    };
  }
}
