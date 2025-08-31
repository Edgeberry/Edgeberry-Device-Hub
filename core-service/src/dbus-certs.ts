import * as dbus from 'dbus-native';
import { issueDeviceCertFromCSR } from './certs.js';

// D-Bus constants
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/CertificateService';
const IFACE_NAME = 'io.edgeberry.devicehub.CertificateService1';

export class CertificateInterface {
  async IssueFromCSR(deviceId: string, csrPem: string, days: number): Promise<string> {
    try {
      console.log(`[CertificateInterface] IssueFromCSR called for device: ${deviceId}`);
      
      const result = await issueDeviceCertFromCSR(deviceId, csrPem, days);
      
      // Return JSON string with success response
      return JSON.stringify({
        success: true,
        certPem: result.certPem,
        caChainPem: result.caChainPem,
        error: null
      });
    } catch (error) {
      console.error('[CertificateInterface] Error in IssueFromCSR:', error);
      // Return JSON string with error response
      return JSON.stringify({
        success: false,
        certPem: null,
        caChainPem: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export async function startCertificateDbusServer(bus: any): Promise<any> {
  const certificateService = new CertificateInterface();

  console.log('Starting Certificate D-Bus server with dbus-native');

  // Create the service object with actual method implementations
  const serviceObject = {
    IssueFromCSR: async (requestJson: string) => {
      try {
        const request = JSON.parse(requestJson);
        const { deviceId, csrPem, days } = request;
        const result = await certificateService.IssueFromCSR(deviceId, csrPem, days);
        return result;
      } catch (error) {
        return JSON.stringify({
          success: false,
          certPem: null,
          caChainPem: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  };

  // Export the interface using the correct dbus-native pattern
  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      IssueFromCSR: ['s', 's']
    },
    signals: {}
  });

  console.log(`Certificate D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
