import * as dbus from 'dbus-native';
import { issueDeviceCertFromCSR } from './certs.js';
import path from 'path';
import fs from 'fs';
import { CA_CRT } from './config.js';
import { getArrayValue } from './types/dbus-helpers.js';

type CertIssueResult = [boolean, string, string, string];

// D-Bus constants (share the same bus name as other Core services)
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/CertificateService';
const IFACE_NAME = 'io.edgeberry.devicehub.CertificateService';

class CertificateInterface {
  async IssueFromCSR(deviceId: string, csrPem: string, days: number): Promise<[boolean, string, string, string]> {
    try {
      if (typeof deviceId !== 'string' || typeof csrPem !== 'string' || typeof days !== 'number') {
        throw new Error('Invalid parameter types');
      }
      
      const d = days > 0 ? days : undefined;
      const { certPem, caChainPem } = await issueDeviceCertFromCSR(deviceId, csrPem, d);
      
      // Ensure CA exists and is readable; if not, still return certPem with empty chain
      let ca = '';
      try { 
        if (fs.existsSync(CA_CRT)) {
          ca = fs.readFileSync(CA_CRT, 'utf8');
        }
      } catch (readError) {
        console.warn('Failed to read CA certificate:', readError);
      }
      
      return [
        true,
        String(certPem || ''),
        String(ca || caChainPem || ''),
        ''
      ];
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error('Certificate issue error:', errorMessage);
      return [false, '', '', errorMessage];
    }
  }
}

export async function startCertificateDbusServer(): Promise<any> {
  const bus = dbus.systemBus();
  const certificateService = new CertificateInterface();
  
  console.log('Starting Certificate D-Bus server with dbus-native');
  
  // Create service interface using dbus-native pattern
  const service = bus.getService(BUS_NAME);
  const obj = service.createObject(OBJECT_PATH);
  const iface = obj.createInterface(IFACE_NAME);
  
  // Add IssueFromCSR method
  iface.addMethod('IssueFromCSR', {
    in: ['s', 's', 'i'],
    out: ['b', 's', 's', 's']
  }, async (uuid: string, csrPem: string, validityDays: number, callback: Function) => {
    try {
      const result = await certificateService.IssueFromCSR(uuid, csrPem, validityDays);
      callback(null, ...result);
    } catch (error) {
      callback(error);
    }
  });
  
  console.log(`Certificate D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
