import * as dbus from 'dbus-next';
import { issueDeviceCertFromCSR } from './certs.js';
import { CA_CRT } from './config.js';
import fs from 'fs';
import { getArrayValue } from './types/dbus-helpers.js';

type CertIssueResult = [boolean, string, string, string];

// D-Bus constants (share the same bus name as other Core services)
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/CertificateService';
const IFACE_NAME = 'io.edgeberry.devicehub.CertificateService';

class CertificateInterface extends (dbus.interface.Interface as any) {
  constructor() {
    super(IFACE_NAME);
    
    // Register methods with the correct signature format
    this.addMethod('IssueFromCSR', { 
      inSignature: 'ssu', 
      outSignature: 'bsss',
      handler: this.issueFromCSR.bind(this)
    });
  }

  // IssueFromCSR(s deviceId, s csrPem, u days) → (b ok, s certPem, s caChainPem, s error)
  private async issueFromCSR(deviceId: string, csrPem: string, days: number): Promise<CertIssueResult> {
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

export async function startCertificateDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    try { 
      await bus.requestName(BUS_NAME, 0);
    } catch (e) {
      console.warn(`[core-service] Could not request name ${BUS_NAME}:`, e);
    }
    
    const iface = new CertificateInterface();
    bus.export(OBJECT_PATH, iface);
    console.log(`[core-service] D-Bus CertificateService exported at ${OBJECT_PATH}`);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('[core-service] Failed to start D-Bus CertificateService:', errorMessage);
    throw e; // Re-throw to allow caller to handle the error
  }
}
