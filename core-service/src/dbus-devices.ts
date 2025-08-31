import * as dbus from 'dbus-native';

const BUS_NAME = 'io.edgeberry.devicehub.DevicesService';
const OBJECT_PATH = '/io/edgeberry/devicehub/DevicesService';
const IFACE_NAME = 'io.edgeberry.devicehub.DevicesService1';

class DevicesInterface {
  async ResolveDeviceIdByUUID(uuid: string): Promise<[boolean, string, string]> {
    // Placeholder implementation
    return [false, '', 'Device not found'];
  }

  async GetDeviceInfo(deviceId: string): Promise<[boolean, string, string]> {
    // Placeholder implementation
    return [false, '', 'Device not found'];
  }

  async ListDevices(): Promise<string[]> {
    // Placeholder implementation
    return [];
  }
}

export async function startDevicesDbusServer(): Promise<any> {
  const bus = dbus.systemBus();
  const devicesService = new DevicesInterface();
  
  console.log('Starting Devices D-Bus server with dbus-native');
  
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
    GetDeviceInfo: async (deviceId: string) => {
      try {
        const result = await devicesService.GetDeviceInfo(deviceId);
        return result;
      } catch (error) {
        throw error;
      }
    },
    ListDevices: async () => {
      try {
        const result = await devicesService.ListDevices();
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
      GetDeviceInfo: ['s', 'bss'],
      ListDevices: ['', 'as']
    },
    signals: {}
  });
  
  console.log(`Devices D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
