import * as dbus from 'dbus-native';

// D-Bus constants
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/WhitelistService';
const IFACE_NAME = 'io.edgeberry.devicehub.WhitelistService1';

export class WhitelistInterface {
  async CheckUUID(uuid: string): Promise<string> {
    // Placeholder implementation - replace with actual whitelist logic
    console.log(`[WhitelistInterface] CheckUUID called for: ${uuid}`);
    return JSON.stringify({
      success: true,
      uuid: uuid,
      note: 'Test Device',
      used_at: null,
      error: null
    });
  }

  async List(): Promise<string> {
    // Placeholder implementation - replace with actual whitelist logic
    console.log('[WhitelistInterface] List called');
    return JSON.stringify({
      success: true,
      uuids: ['9205255a-6767-4a8f-8a8b-499239906911'],
      error: null
    });
  }

  async Add(uuid: string, note: string): Promise<string> {
    // Placeholder implementation - replace with actual whitelist logic
    console.log(`[WhitelistInterface] Add called for: ${uuid} with note: ${note}`);
    return JSON.stringify({
      success: true,
      error: null
    });
  }

  async MarkUsed(uuid: string): Promise<string> {
    // Placeholder implementation - replace with actual whitelist logic
    console.log(`[WhitelistInterface] MarkUsed called for: ${uuid}`);
    return JSON.stringify({
      success: true,
      error: null
    });
  }
}

export async function startWhitelistDbusServer(bus: any): Promise<any> {
  const whitelistService = new WhitelistInterface();

  console.log('Starting Whitelist D-Bus server with dbus-native');

  // Create the service object with actual method implementations
  const serviceObject = {
    CheckUUID: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid } = request;
        const result = await whitelistService.CheckUUID(uuid);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          uuid: null,
          note: null,
          used_at: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    List: async (requestJson: string) => {
      try {
        const result = await whitelistService.List();
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          uuids: [],
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    Add: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid, note } = request;
        const result = await whitelistService.Add(uuid, note);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    },
    MarkUsed: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { uuid } = request;
        const result = await whitelistService.MarkUsed(uuid);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      CheckUUID: ['s', 's'],
      List: ['s', 's'],
      Add: ['s', 's'],
      MarkUsed: ['s', 's']
    },
    signals: {}
  });

  console.log(`Whitelist D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
