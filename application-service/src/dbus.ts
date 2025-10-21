/**
 * D-Bus interface for Application Service
 * 
 * Exposes connection status methods to core-service via D-Bus
 */
import * as dbus from 'dbus-native';

const SERVICE = 'application-service';
const BUS_NAME = 'io.edgeberry.devicehub.ApplicationService';
const OBJECT_PATH = '/io/edgeberry/devicehub/ApplicationService';
const IFACE_NAME = 'io.edgeberry.devicehub.ApplicationService';

let bus: any | null = null;

export type ConnectionStatusGetter = () => {
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
};

/**
 * Initialize D-Bus service and export connection status interface
 */
export async function startApplicationDbusService(getConnectionStatus: ConnectionStatusGetter): Promise<void> {
  try {
    bus = dbus.systemBus();
    
    // Request the bus name
    bus.requestName(BUS_NAME, 0, (err: any, retCode: number) => {
      if (err) {
        console.error(`[${SERVICE}] Failed to request D-Bus name:`, err);
        return;
      }
      
      // retCode values:
      // 1 = primary owner
      // 2 = queued
      // 3 = already owner
      // 4 = already exists
      if (retCode === 1 || retCode === 3) {
        console.log(`[${SERVICE}] D-Bus name acquired: ${BUS_NAME}`);
      } else {
        console.warn(`[${SERVICE}] D-Bus name request returned code ${retCode}`);
      }
    });
    
    // Service object with async methods (matches pattern from dbus-twin.ts)
    const serviceObject = {
      GetConnectionStatus: async () => {
        try {
          const status = getConnectionStatus();
          const response = {
            success: true,
            totalConnections: status.totalConnections,
            activeApplications: status.activeApplications,
            connections: status.connections
          };
          return JSON.stringify(response);
        } catch (error: any) {
          console.error(`[${SERVICE}] D-Bus GetConnectionStatus error:`, error);
          return JSON.stringify({
            success: false,
            error: error?.message || 'Unknown error',
            totalConnections: 0,
            activeApplications: 0,
            connections: []
          });
        }
      }
    };
    
    // Export the interface using the correct dbus-native pattern
    bus.exportInterface(serviceObject, OBJECT_PATH, {
      name: IFACE_NAME,
      methods: {
        GetConnectionStatus: ['', 's'] // no input, string output
      },
      signals: {}
    });
    
    console.log(`[${SERVICE}] D-Bus interface exported at ${OBJECT_PATH}`);
    
  } catch (error) {
    console.error(`[${SERVICE}] Failed to initialize D-Bus service:`, error);
    throw error;
  }
}

/**
 * Cleanup D-Bus resources
 */
export function stopApplicationDbusService(): void {
  if (bus) {
    try {
      bus.connection.end();
      bus = null;
    } catch (error) {
      console.error(`[${SERVICE}] Error closing D-Bus connection:`, error);
    }
  }
}
