import * as dbus from 'dbus-next';
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

export async function startCertificateDbusServer(bus: any): Promise<void> {
  try {
    const certService = new CertificateInterface();
    
    // Add method handler for CertificateService methods using the same pattern as WhitelistService
    (bus as any).addMethodHandler(async (msg: any) => {
      if (msg.path === OBJECT_PATH && msg.interface === IFACE_NAME) {
        const method = msg.member;
        const args = msg.body || [];
        
        try {
          switch (method) {
            case 'IssueFromCSR':
              return await certService.IssueFromCSR(args[0], args[1], args[2]);
            default:
              throw new Error(`Unknown method: ${method}`);
          }
        } catch (error) {
          console.error(`[dbus-certs] Error in ${method}:`, error);
          throw error;
        }
      }
      
      // Handle introspection
      if (msg.path === OBJECT_PATH && msg.interface === 'org.freedesktop.DBus.Introspectable' && msg.member === 'Introspect') {
        return `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="${IFACE_NAME}">
    <method name="IssueFromCSR">
      <arg direction="in" type="s" name="deviceId"/>
      <arg direction="in" type="s" name="csrPem"/>
      <arg direction="in" type="u" name="days"/>
      <arg direction="out" type="b" name="success"/>
      <arg direction="out" type="s" name="certPem"/>
      <arg direction="out" type="s" name="caChainPem"/>
      <arg direction="out" type="s" name="error"/>
    </method>
  </interface>
</node>`;
      }
    });
    
    console.log(`[dbus-certs] CertificateService exported at ${OBJECT_PATH} on system bus`);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('[core-service] Failed to start D-Bus CertificateService:', errorMessage);
    throw e; // Re-throw to allow caller to handle the error
  }
}
