import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { CA_CRT, CA_KEY, CERTS_DIR, PROV_DIR, ROOT_DIR } from './config.js';
import os from 'os';

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
  
  // Set proper permissions for Mosquitto to read certificates
  try {
    fs.chmodSync(CA_KEY, 0o640); // rw-r-----
    fs.chmodSync(CA_CRT, 0o640); // rw-r-----
    // Try to set group ownership to mosquitto if running as root
    try {
      await runCmd('chgrp', ['mosquitto', CA_KEY, CA_CRT]);
    } catch {
      // Ignore chgrp errors (may not be running as root or mosquitto group may not exist)
    }
  } catch (e) {
    console.warn('[certs] Warning: Could not set certificate permissions:', (e as Error).message);
  }
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
  
  // Set proper permissions for Mosquitto to read certificates
  try {
    fs.chmodSync(keyPath, 0o640); // rw-r-----
    fs.chmodSync(crtPath, 0o640); // rw-r-----
    // Try to set group ownership to mosquitto if running as root
    try {
      await runCmd('chgrp', ['mosquitto', keyPath, crtPath]);
    } catch {
      // Ignore chgrp errors (may not be running as root or mosquitto group may not exist)
    }
  } catch (e) {
    console.warn('[certs] Warning: Could not set certificate permissions:', (e as Error).message);
  }
  
  return { certPath: crtPath, keyPath };
}


// Issue a device certificate from a CSR PEM and return PEM strings for cert and CA chain
export async function issueDeviceCertFromCSR(deviceId: string, csrPem: string, days?: number): Promise<{ certPem: string; caChainPem: string }>{
  if (!(await caExists())) {
    throw new Error('Root CA not found. Generate it first.');
  }
  if (!/-----BEGIN CERTIFICATE REQUEST-----[\s\S]+-----END CERTIFICATE REQUEST-----/.test(csrPem)) {
    throw new Error('invalid_csr');
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeberry-csr-'));
  const csrPath = path.join(tmpDir, `${deviceId}.csr`);
  const crtPath = path.join(tmpDir, `${deviceId}.crt`);
  const extPath = path.join(tmpDir, `${deviceId}.ext`);
  fs.writeFileSync(csrPath, csrPem);
  // Validate CSR CN equals deviceId because Mosquitto maps CN -> username for ACLs
  // If mismatched, the device would authenticate under a different username than the topic deviceId
  try {
    const subj = await runCmd('openssl', ['req', '-noout', '-subject', '-nameopt', 'RFC2253', '-in', csrPath]);
    const line = (subj.out || '').toString().trim();
    const m = line.match(/CN=([^,\/]+)/);
    const cn = m ? m[1] : '';
    if (!cn || cn !== deviceId) {
      try { fs.unlinkSync(csrPath); } catch {}
      throw new Error('csr_cn_mismatch');
    }
  } catch (e) {
    // If openssl fails to parse, treat as invalid CSR
    if ((e as Error).message === 'csr_cn_mismatch') throw e;
    throw new Error('invalid_csr_subject');
  }
  const daysStr = String(days ?? 825);
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
  const res = await runCmd('openssl', ['x509', '-req', '-in', csrPath, '-CA', CA_CRT, '-CAkey', CA_KEY, '-CAcreateserial', '-out', crtPath, '-days', daysStr, '-sha256', '-extfile', extPath, '-extensions', 'v3_client']);
  try { fs.unlinkSync(csrPath); } catch {}
  try { fs.unlinkSync(extPath); } catch {}
  if (res.code !== 0) {
    try { fs.unlinkSync(crtPath); } catch {}
    throw new Error(`cert_issue_failed: ${res.err || res.out}`);
  }
  const certPem = fs.readFileSync(crtPath, 'utf8');
  try { fs.unlinkSync(crtPath); } catch {}
  const caChainPem = fs.readFileSync(CA_CRT, 'utf8');
  return { certPem, caChainPem };
}

// Generate provisioning client certificate for device bootstrap
export async function generateProvisioningCert(): Promise<void> {
  if (!(await caExists())) {
    throw new Error('Root CA not found. Generate it first.');
  }
  
  ensureDirs();
  
  const provisioningCertPath = path.join(PROV_DIR, 'provisioning.crt');
  const provisioningKeyPath = path.join(PROV_DIR, 'provisioning.key');
  
  // Skip if already exists
  if (fs.existsSync(provisioningCertPath) && fs.existsSync(provisioningKeyPath)) {
    console.log('[certs] Provisioning certificate already exists');
    return;
  }
  
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeberry-prov-'));
  const keyPath = path.join(tmpDir, 'provisioning.key');
  const csrPath = path.join(tmpDir, 'provisioning.csr');
  const crtPath = path.join(tmpDir, 'provisioning.crt');
  const extPath = path.join(tmpDir, 'provisioning.ext');
  
  try {
    // Generate private key (unencrypted for provisioning)
    let r = await runCmd('openssl', ['genrsa', '-out', keyPath, '2048']);
    if (r.code !== 0) throw new Error(`key generation failed: ${r.err || r.out}`);
    
    // Generate CSR
    r = await runCmd('openssl', ['req', '-new', '-key', keyPath, '-out', csrPath, '-subj', '/CN=provisioning-client']);
    if (r.code !== 0) throw new Error(`CSR generation failed: ${r.err || r.out}`);
    
    // Create extension file for client certificate
    const extContent = [
      '[v3_client]',
      'basicConstraints=CA:FALSE',
      'keyUsage = digitalSignature, keyEncipherment',
      'extendedKeyUsage = clientAuth',
      'subjectKeyIdentifier = hash',
      'authorityKeyIdentifier = keyid,issuer',
      ''
    ].join('\n');
    fs.writeFileSync(extPath, extContent, { encoding: 'utf8' });
    
    // Sign certificate
    r = await runCmd('openssl', ['x509', '-req', '-in', csrPath, '-CA', CA_CRT, '-CAkey', CA_KEY, '-CAcreateserial', '-out', crtPath, '-days', '825', '-sha256', '-extfile', extPath, '-extensions', 'v3_client']);
    if (r.code !== 0) throw new Error(`certificate signing failed: ${r.err || r.out}`);
    
    // Copy to final locations
    fs.copyFileSync(crtPath, provisioningCertPath);
    fs.copyFileSync(keyPath, provisioningKeyPath);
    
    // Set proper permissions for Mosquitto to read certificates
    try {
      fs.chmodSync(provisioningKeyPath, 0o640); // rw-r-----
      fs.chmodSync(provisioningCertPath, 0o640); // rw-r-----
      // Try to set group ownership to mosquitto if running as root
      try {
        await runCmd('chgrp', ['mosquitto', provisioningKeyPath, provisioningCertPath]);
      } catch {
        // Ignore chgrp errors (may not be running as root or mosquitto group may not exist)
      }
    } catch (e) {
      console.warn('[certs] Warning: Could not set certificate permissions:', (e as Error).message);
    }
    
    console.log('[certs] Generated provisioning certificate');
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(keyPath); } catch {}
    try { fs.unlinkSync(csrPath); } catch {}
    try { fs.unlinkSync(crtPath); } catch {}
    try { fs.unlinkSync(extPath); } catch {}
    try { fs.rmdirSync(tmpDir); } catch {}
  }
}

