import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { CA_CRT, CA_KEY, CERTS_DIR, PROV_DIR, ROOT_DIR } from './config.js';

export function ensureDirs() {
  for (const d of [CERTS_DIR, ROOT_DIR, PROV_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function runCmd(cmd: string, args: string[], input?: string): Promise<{ code: number | null; out: string; err: string }>{
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

export async function caExists(): Promise<boolean> {
  return fs.existsSync(CA_KEY) && fs.existsSync(CA_CRT);
}

export async function generateRootCA(params?: { cn?: string; days?: number; keyBits?: number }): Promise<void> {
  ensureDirs();
  const cn = params?.cn || 'Edgeberry Device Hub Root CA';
  const days = String(params?.days ?? 3650);
  const keyBits = String(params?.keyBits ?? 4096);
  const keyRes = await runCmd('openssl', ['genrsa', '-out', CA_KEY, keyBits]);
  if (keyRes.code !== 0) throw new Error(`openssl genrsa failed: ${keyRes.err || keyRes.out}`);
  const subj = `/CN=${cn}`;
  const crtRes = await runCmd('openssl', ['req', '-x509', '-new', '-nodes', '-key', CA_KEY, '-sha256', '-days', days, '-subj', subj, '-out', CA_CRT]);
  if (crtRes.code !== 0) throw new Error(`openssl req -x509 failed: ${crtRes.err || crtRes.out}`);
}

export async function readCertMeta(pemPath: string): Promise<{ fingerprintSha256?: string; notAfter?: string; subject?: string }>{
  if (!fs.existsSync(pemPath)) return {};
  const fp = await runCmd('openssl', ['x509', '-noout', '-fingerprint', '-sha256', '-in', pemPath]);
  const nd = await runCmd('openssl', ['x509', '-noout', '-enddate', '-in', pemPath]);
  const sj = await runCmd('openssl', ['x509', '-noout', '-subject', '-nameopt', 'RFC2253', '-in', pemPath]);
  return {
    fingerprintSha256: fp.out.toString().trim().split('=').pop(),
    notAfter: nd.out.toString().trim().split('=').pop(),
    subject: sj.out.toString().trim().replace(/^subject=/, ''),
  };
}

export async function issueProvisioningCert(name: string, days?: number): Promise<{ certPath: string; keyPath: string }>{
  ensureDirs();
  if (!(await caExists())) throw new Error('Root CA not found. Generate it first.');
  const base = name.replace(/[^A-Za-z0-9._-]/g, '_');
  const keyPath = path.join(PROV_DIR, `${base}.key`);
  const csrPath = path.join(PROV_DIR, `${base}.csr`);
  const crtPath = path.join(PROV_DIR, `${base}.crt`);
  const extPath = path.join(PROV_DIR, `${base}.ext`);
  const daysStr = String(days ?? 825);
  let r = await runCmd('openssl', ['genrsa', '-out', keyPath, '2048']);
  if (r.code !== 0) throw new Error(`openssl genrsa failed: ${r.err || r.out}`);
  r = await runCmd('openssl', ['req', '-new', '-key', keyPath, '-subj', `/CN=${name}`,'-out', csrPath]);
  if (r.code !== 0) throw new Error(`openssl req -new failed: ${r.err || r.out}`);
  // Write minimal client certificate extensions
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
  r = await runCmd('openssl', ['x509', '-req', '-in', csrPath, '-CA', CA_CRT, '-CAkey', CA_KEY, '-CAcreateserial', '-out', crtPath, '-days', daysStr, '-sha256', '-extfile', extPath, '-extensions', 'v3_client']);
  if (r.code !== 0) throw new Error(`openssl x509 -req failed: ${r.err || r.out}`);
  try { fs.unlinkSync(csrPath); } catch {}
  try { fs.unlinkSync(extPath); } catch {}
  return { certPath: crtPath, keyPath };
}

