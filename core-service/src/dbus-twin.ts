import * as dbus from 'dbus-native';

const BUS_NAME = 'io.edgeberry.devicehub.TwinService';
const OBJECT_PATH = '/io/edgeberry/devicehub/TwinService';
const IFACE_NAME = 'io.edgeberry.devicehub.TwinService';

class CoreTwinInterface {
  async GetTwin(deviceId: string): Promise<[string, number, string, string]> {
    return ['{}', 0, '{}', ''];
  }

  async SetDesired(deviceId: string, patchJson: string): Promise<[boolean, number, string]> {
    return [true, 1, ''];
  }

  async SetReported(deviceId: string, patchJson: string): Promise<[boolean, number, string]> {
    return [true, 1, ''];
  }

  async ListDevices(): Promise<string[]> {
    return [];
  }
}

export async function startCoreTwinDbusServer(): Promise<any> {
  const bus = dbus.systemBus();
  const twinService = new CoreTwinInterface();
  
  console.log('Starting Twin D-Bus server with dbus-native');
  
  // Request bus name
  bus.requestName(BUS_NAME, 0, (err: any, res: any) => {
    if (err) {
      console.error('D-Bus service name acquisition failed:', err);
    } else {
      console.log(`D-Bus service name "${BUS_NAME}" successfully acquired`);
    }
  });

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
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      GetTwin: ['s', 'suss'],
      SetDesired: ['ss', 'bus'],
      SetReported: ['ss', 'bus'],
      ListDevices: ['', 'as']
    },
    signals: {}
  });
  
  console.log(`Twin D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
