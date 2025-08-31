import * as dbus from 'dbus-native';

const OBJECT_PATH = '/io/edgeberry/devicehub/TwinService';
const IFACE_NAME = 'io.edgeberry.devicehub.TwinService';

// WebSocket broadcast function - will be set during initialization
let broadcastFunction: ((topic: string, payload: any) => void) | null = null;

export function setBroadcastFunction(fn: (topic: string, payload: any) => void) {
  broadcastFunction = fn;
}

class CoreTwinInterface {
  async GetTwin(deviceId: string): Promise<string> {
    return JSON.stringify({ desired: {}, reported: {}, version: 0, error: '' });
  }

  async SetDesired(deviceId: string, patchJson: string): Promise<string> {
    return JSON.stringify({ success: true, newVersion: 1, error: '' });
  }

  async SetReported(deviceId: string, patchJson: string): Promise<string> {
    return JSON.stringify({ success: true, newVersion: 1, error: '' });
  }

  async ListDevices(): Promise<string> {
    return JSON.stringify([]);
  }

  async UpdateDeviceStatus(deviceId: string, status: string, timestamp: string): Promise<string> {
    const timestampNum = parseInt(timestamp);
    console.log(`[core-service] Device status update: ${deviceId} is ${status} at ${new Date(timestampNum).toISOString()}`);
    
    // Broadcast device status update via WebSocket
    if (broadcastFunction) {
      const statusUpdate = {
        deviceId,
        status: status === 'online',
        timestamp: new Date(timestampNum).toISOString(),
        last_seen: status === 'offline' ? new Date(timestampNum).toISOString() : null
      };
      
      // Broadcast to both authenticated and public device status topics
      broadcastFunction('device.status', { type: 'device.status', data: statusUpdate });
      broadcastFunction('device.status.public', { type: 'device.status.public', data: { 
        deviceId, 
        status: status === 'online',
        timestamp: new Date(timestampNum).toISOString()
      }});
    }
    
    return JSON.stringify({ success: true });
  }
}

export async function startCoreTwinDbusServer(bus: any): Promise<any> {
  const twinService = new CoreTwinInterface();
  
  console.log('Starting Twin D-Bus server with dbus-native');

  // Create the service object with actual method implementations
  const serviceObject = {
    GetTwin: async (deviceId: string) => {
      try {
        const result = await twinService.GetTwin(deviceId);
        return result;
      } catch (error) {
        throw error;
      }
    },
    SetDesired: async (deviceId: string, patchJson: string) => {
      try {
        const result = await twinService.SetDesired(deviceId, patchJson);
        return result;
      } catch (error) {
        throw error;
      }
    },
    SetReported: async (deviceId: string, patchJson: string) => {
      try {
        const result = await twinService.SetReported(deviceId, patchJson);
        return result;
      } catch (error) {
        throw error;
      }
    },
    ListDevices: async () => {
      try {
        const result = await twinService.ListDevices();
        return result;
      } catch (error) {
        throw error;
      }
    },
    UpdateDeviceStatus: async (deviceId: string, status: string, timestamp: string) => {
      try {
        const result = await twinService.UpdateDeviceStatus(deviceId, status, timestamp);
        return result;
      } catch (error) {
        throw error;
      }
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      GetTwin: ['s', 's'],
      SetDesired: ['ss', 's'],
      SetReported: ['ss', 's'],
      ListDevices: ['', 's'],
      UpdateDeviceStatus: ['sss', 's']
    },
    signals: {}
  });
  
  console.log(`Twin D-Bus server started on io.edgeberry.devicehub.Core at ${OBJECT_PATH}`);
  return bus;
}
