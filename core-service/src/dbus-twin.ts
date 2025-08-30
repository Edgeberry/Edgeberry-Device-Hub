import * as dbus from 'dbus-native';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
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
  
  // Create service interface using dbus-native pattern
  const service = bus.getService(BUS_NAME);
  const obj = service.createObject(OBJECT_PATH);
  const iface = obj.createInterface(IFACE_NAME);
  
  // Add GetTwin method
  iface.addMethod('GetTwin', {
    in: ['s'],
    out: ['s', 'u', 's', 's']
  }, async (deviceId: string, callback: Function) => {
    try {
      const result = await twinService.GetTwin(deviceId);
      callback(null, ...result);
    } catch (error) {
      callback(error);
    }
  });
  
  // Add SetDesired method
  iface.addMethod('SetDesired', {
    in: ['s', 's'],
    out: ['b', 'u', 's']
  }, async (deviceId: string, patchJson: string, callback: Function) => {
    try {
      const result = await twinService.SetDesired(deviceId, patchJson);
      callback(null, ...result);
    } catch (error) {
      callback(error);
    }
  });
  
  // Add SetReported method
  iface.addMethod('SetReported', {
    in: ['s', 's'],
    out: ['b', 'u', 's']
  }, async (deviceId: string, patchJson: string, callback: Function) => {
    try {
      const result = await twinService.SetReported(deviceId, patchJson);
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
      const result = await twinService.ListDevices();
      callback(null, result);
    } catch (error) {
      callback(error);
    }
  });
  
  console.log(`Twin D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
