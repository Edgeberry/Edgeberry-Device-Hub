import * as dbus from 'dbus-native';
import { getTwin, setTwinDoc, recordDeviceConnectionStatus } from './twin-store.js';

const OBJECT_PATH = '/io/edgeberry/devicehub/TwinService';
const IFACE_NAME = 'io.edgeberry.devicehub.TwinService';

// WebSocket broadcast function - will be set during initialization
let broadcastFunction: ((topic: string, payload: any) => void) | null = null;

export function setBroadcastFunction(fn: (topic: string, payload: any) => void) {
  broadcastFunction = fn;
}

class CoreTwinInterface {
  // Single JSON-string request/response, matching every other D-Bus method
  // on Core (Whitelist/Devices/Certificate) - see the comment on
  // dbus-whitelist.ts. Returns both desired and reported so a caller never
  // needs a second round trip to compute a delta.
  async GetTwin(requestJson: string): Promise<string> {
    try {
      const { deviceId } = JSON.parse(requestJson);
      if (!deviceId) return JSON.stringify({ success: false, error: 'deviceId required' });
      const { desired, reported } = getTwin(deviceId);
      return JSON.stringify({ success: true, desired, reported, error: null });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async SetDesired(requestJson: string): Promise<string> {
    try {
      const { deviceId, patchJson } = JSON.parse(requestJson);
      if (!deviceId) return JSON.stringify({ success: false, error: 'deviceId required' });
      const patch = patchJson ? JSON.parse(patchJson) : {};
      setTwinDoc('twin_desired', deviceId, patch);
      const { desired, reported } = getTwin(deviceId);
      return JSON.stringify({ success: true, desired, reported, error: null });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async SetReported(requestJson: string): Promise<string> {
    try {
      const { deviceId, patchJson } = JSON.parse(requestJson);
      if (!deviceId) return JSON.stringify({ success: false, error: 'deviceId required' });
      const patch = patchJson ? JSON.parse(patchJson) : {};
      setTwinDoc('twin_reported', deviceId, patch);
      const { desired, reported } = getTwin(deviceId);
      return JSON.stringify({ success: true, desired, reported, error: null });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async UpdateDeviceStatus(deviceId: string, status: string, timestamp: string): Promise<string> {
    const timestampNum = parseInt(timestamp);
    const isOnline = status === 'online';
    const timestampIso = new Date(timestampNum).toISOString();

    console.log(`[core-service] Device status update: ${deviceId} is ${status} at ${timestampIso}`);

    // Persist - this is now the only place a connection-status event for
    // this device gets recorded (twin-service used to write this itself
    // directly to twin.db; it now only calls this D-Bus method).
    try {
      recordDeviceConnectionStatus(deviceId, isOnline, timestampIso);
    } catch (error) {
      console.error(`[core-service] Failed to persist device status for ${deviceId}:`, error);
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }

    // Broadcast device status update via WebSocket immediately
    if (broadcastFunction) {
      const statusUpdate = {
        deviceId,
        status: isOnline,
        timestamp: timestampIso,
        last_seen: isOnline ? null : timestampIso
      };

      setImmediate(() => {
        broadcastFunction!('device.status', { type: 'device.status', data: statusUpdate });
        console.log(`[core-service] Broadcasted ${deviceId} status (${status}) via WebSocket`);
      });
    } else {
      console.warn(`[core-service] No broadcast function available for device status update`);
    }

    return JSON.stringify({ success: true });
  }
}

export async function startCoreTwinDbusServer(bus: any): Promise<any> {
  const twinService = new CoreTwinInterface();

  console.log('Starting Twin D-Bus server with dbus-native');

  const serviceObject = {
    GetTwin: async (requestJson: string) => {
      try {
        return await twinService.GetTwin(requestJson);
      } catch (error) {
        throw error;
      }
    },
    SetDesired: async (requestJson: string) => {
      try {
        return await twinService.SetDesired(requestJson);
      } catch (error) {
        throw error;
      }
    },
    SetReported: async (requestJson: string) => {
      try {
        return await twinService.SetReported(requestJson);
      } catch (error) {
        throw error;
      }
    },
    UpdateDeviceStatus: async (deviceId: string, status: string, timestamp: string) => {
      try {
        return await twinService.UpdateDeviceStatus(deviceId, status, timestamp);
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
      SetDesired: ['s', 's'],
      SetReported: ['s', 's'],
      UpdateDeviceStatus: ['sss', 's']
    },
    signals: {}
  });

  console.log(`Twin D-Bus server started on io.edgeberry.devicehub.Core at ${OBJECT_PATH}`);
  return bus;
}
