import * as dbus from 'dbus-next';
import { issueDeviceCertFromCSR } from './certs.js';
import { CA_CRT } from './config.js';
import fs from 'fs';

// D-Bus constants (share the same bus name as other Core services)
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/CertificateService';
const IFACE_NAME = 'io.edgeberry.devicehub.CertificateService';

class CertificateInterface extends (dbus.interface.Interface as any) {
  constructor() {
    super(IFACE_NAME);
    // Register methods imperatively to avoid decorator runtime issues
    this.addMethod(
      'IssueFromCSR',
      { inSignature: 'ssu', outSignature: 'bsss' },
      (deviceId: string, csrPem: string, days: number) => this._IssueFromCSR(deviceId, csrPem, days)
    );
  }

  // IssueFromCSR(s deviceId, s csrPem, u days) → (b ok, s certPem, s caChainPem, s error)
  private async _IssueFromCSR(deviceId: string, csrPem: string, days: number): Promise<[boolean, string, string, string]> {
    try {
      const d = Number(days || 0) || undefined;
      const { certPem, caChainPem } = await issueDeviceCertFromCSR(deviceId, csrPem, d);
      // Ensure CA exists and is readable; if not, still return certPem with empty chain
      let ca = '';
      try { if (fs.existsSync(CA_CRT)) ca = fs.readFileSync(CA_CRT, 'utf8'); } catch {}
      return [true, certPem, ca || caChainPem || '', ''];
    } catch (e: any) {
      return [false, '', '', String(e?.message || 'error')];
    }
  }
}

export async function startCertificateDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    try { await bus.requestName(BUS_NAME, 0); } catch {}
    const iface = new CertificateInterface();
    bus.export(OBJECT_PATH, iface as unknown as dbus.interface.Interface);
    console.log('[core-service] D-Bus CertificateService exported at', OBJECT_PATH);
  } catch (e) {
    console.error('[core-service] failed to start D-Bus CertificateService', e);
  }
}
