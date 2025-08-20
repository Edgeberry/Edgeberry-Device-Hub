import fs from 'fs';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { CA_CRT_PATH, CA_KEY_PATH } from './config.js';

async function runCmd(cmd: string, args: string[], input?: string): Promise<{ code: number | null; out: string; err: string }>{
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: string[] = [];
    const err: string[] = [];
    p.stdout.on('data', (c: Buffer) => out.push(c.toString()));
    p.stderr.on('data', (c: Buffer) => err.push(c.toString()));
    if (input) {
      p.stdin.write(input);
      p.stdin.end();
    }
    p.on('close', (code) => resolve({ code, out: out.join(''), err: err.join('') }));
  });
}

export async function issueDeviceCertFromCSR(deviceId: string, csrPem: string, days?: number): Promise<{ certPem: string; caChainPem: string }>{
  if (!fs.existsSync(CA_CRT_PATH) || !fs.existsSync(CA_KEY_PATH)) {
    throw new Error('Root CA not found. Ensure CA_CRT_PATH and CA_KEY_PATH are configured.');
  }
  // Basic CSR sanity
  if (!/-----BEGIN CERTIFICATE REQUEST-----[\s\S]+-----END CERTIFICATE REQUEST-----/.test(csrPem)) {
    throw new Error('invalid_csr');
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeberry-csr-'));
  const csrPath = path.join(tmpDir, `${deviceId}.csr`);
  const crtPath = path.join(tmpDir, `${deviceId}.crt`);
  const extPath = path.join(tmpDir, `${deviceId}.ext`);
  fs.writeFileSync(csrPath, csrPem);
  const daysStr = String(days ?? 825);
  // Minimal client certificate extensions
  const extContent = [
    '[v3_client]',
    'basicConstraints=CA:FALSE',
    'keyUsage = digitalSignature, keyEncipherment',
    'extendedKeyUsage = clientAuth',
    'subjectKeyIdentifier = hash',
    'authorityKeyIdentifier = keyid,issuer',
    ''
  ].join('\n');
  try { fs.writeFileSync(extPath, extContent, { encoding: 'utf8' }); } catch (e) { throw new Error(`failed_writing_extfile: ${String((e as Error).message || e)}`); }
  const res = await runCmd('openssl', ['x509', '-req', '-in', csrPath, '-CA', CA_CRT_PATH, '-CAkey', CA_KEY_PATH, '-CAcreateserial', '-out', crtPath, '-days', daysStr, '-sha256', '-extfile', extPath, '-extensions', 'v3_client']);
  try { fs.unlinkSync(csrPath); } catch {}
  try { fs.unlinkSync(extPath); } catch {}
  if (res.code !== 0) {
    try { fs.unlinkSync(crtPath); } catch {}
    throw new Error(`cert_issue_failed: ${res.err || res.out}`);
  }
  const certPem = fs.readFileSync(crtPath, 'utf8');
  try { fs.unlinkSync(crtPath); } catch {}
  const caChainPem = fs.readFileSync(CA_CRT_PATH, 'utf8');
  return { certPem, caChainPem };
}
