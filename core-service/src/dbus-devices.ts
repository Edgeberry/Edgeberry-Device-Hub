import * as dbus from 'dbus-native';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/Core/Devices1';
const IFACE_NAME = 'io.edgeberry.devicehub.Core.Devices1';

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
  
  // Create service interface using dbus-native pattern
  const service = bus.getService(BUS_NAME);
  const obj = service.createObject(OBJECT_PATH);
  const iface = obj.createInterface(IFACE_NAME);
  
  // Add GetDeviceInfo method
  iface.addMethod('GetDeviceInfo', {
    in: ['s'],
    out: ['b', 's', 's']
  }, async (deviceId: string, callback: Function) => {
    try {
      const result = await devicesService.GetDeviceInfo(deviceId);
      callback(null, ...result);
    } catch (error) {
      callback(error);
    }
  });
  
  // Add ListDevices method
  iface.addMethod('ListDevices', {
    in: [],
    out: ['as']
  }, async (callback: Function) => {
    try {
      const result = await devicesService.ListDevices();
      callback(null, result);
    } catch (error) {
      callback(error);
    }
  });
  
  console.log(`Devices D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
