import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { CA_CRT, CA_KEY, CERTS_DIR, PROV_DIR, ROOT_DIR, DEVICEHUB_DB, CRL_PATH, CRL_NUMBER_PATH, PERSISTENT_CERTS_DIR } from './config.js';
import os from 'os';

export function ensureDirs() {
  for (const d of [CERTS_DIR, ROOT_DIR, PROV_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function runCmd(cmd: string, args: string[], input?: string): Promise<{ code: number | null; out: string; err: string }>{
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: string[] = [];
    const err: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on('close', (code) => resolve({ code, out: out.join(''), err: err.join('') }));
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
  const fingerprintResult = await runCmd('openssl', ['x509', '-noout', '-fingerprint', '-sha256', '-in', pemPath]);
  const endDateResult = await runCmd('openssl', ['x509', '-noout', '-enddate', '-in', pemPath]);
  const subjectResult = await runCmd('openssl', ['x509', '-noout', '-subject', '-nameopt', 'RFC2253', '-in', pemPath]);
  return {
    fingerprintSha256: fingerprintResult.out.toString().trim().split('=').pop(),
    notAfter: endDateResult.out.toString().trim().split('=').pop(),
    subject: subjectResult.out.toString().trim().replace(/^subject=/, ''),
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


// The fleet-wide provisioning ("claim") certificate isn't tied to a device
// uuid the way issued device certs are, but it lives in the same
// `certificates` table so a renewal can revoke the outgoing one through the
// same CRL machinery. This sentinel occupies the uuid column for that one
// row instead of a real device uuid - never matched by
// revokeCertificatesForUuid, which only looks up real device uuids.
const PROVISIONING_CERT_SENTINEL_UUID = '__provisioning_cert__';

function openCertsDb(): any {
  const db = new Database(DEVICEHUB_DB);
  db.prepare(`CREATE TABLE IF NOT EXISTS certificates (
    serial TEXT PRIMARY KEY,
    uuid TEXT NOT NULL,
    device_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_certificates_uuid ON certificates(uuid)').run();
  return db;
}

// Tracked by the board's UUID, not just its currently-assigned name: a UUID
// that reprovisions (fresh-start - see ClaimDeviceName) gets a new name and a
// new cert each time, and revoking a stolen board ("the board is the
// passport" - disabling its whitelist entry) needs to reach every cert ever
// issued for that UUID, not only the one it happens to be using right now.
function recordIssuedCertificate(serial: string, uuid: string, deviceId: string, days: number): void {
  if (!serial) return;
  try {
    const db = openCertsDb();
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      db.prepare('INSERT OR REPLACE INTO certificates (serial, uuid, device_id, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)')
        .run(serial, uuid, deviceId, now.toISOString(), expiresAt.toISOString());
    } finally { db.close(); }
  } catch (e) {
    console.warn('[certs] Warning: failed to record issued certificate:', (e as Error).message);
  }
}

// Marks every certificate ever issued for this UUID as revoked (idempotent -
// already-revoked rows keep their original revoked_at). Does not itself touch
// the live CRL; call regenerateCRL() after to publish the change.
export async function revokeCertificatesForUuid(uuid: string): Promise<string[]> {
  const db = openCertsDb();
  try {
    const now = new Date().toISOString();
    db.prepare('UPDATE certificates SET revoked_at = ? WHERE uuid = ? AND revoked_at IS NULL').run(now, uuid);
    const rows = db.prepare('SELECT serial FROM certificates WHERE uuid = ? AND revoked_at IS NOT NULL').all(uuid) as Array<{ serial: string }>;
    return rows.map(r => r.serial);
  } finally { db.close(); }
}

function toCaDate(iso: string): string {
  // openssl's CA-database (index.txt) date format: YYMMDDHHMMSSZ. Two-digit
  // years are unambiguous through 2049, which covers every certificate this
  // system will realistically ever issue (max validity is a couple of years).
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// Rebuilds the CRL from every revoked row in the certificates table and
// publishes it to CRL_PATH. This system doesn't use openssl's `ca` command for
// day-to-day signing (issueDeviceCertFromCSR/issueProvisioningCert use the
// one-shot `x509 -req -CA ... -CAcreateserial` form, which keeps no index), so
// the index.txt `ca -gencrl` needs is synthesized fresh each time from our own
// SQLite table - it only needs to list revoked ("R") rows, since that's all a
// CRL contains anyway.
export async function regenerateCRL(): Promise<void> {
  if (!(await caExists())) throw new Error('Root CA not found. Generate it first.');

  const db = openCertsDb();
  let revoked: Array<{ serial: string; device_id: string; expires_at: string; revoked_at: string }>;
  try {
    revoked = db.prepare('SELECT serial, device_id, expires_at, revoked_at FROM certificates WHERE revoked_at IS NOT NULL').all() as any[];
  } finally { db.close(); }

  fs.mkdirSync(PERSISTENT_CERTS_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeberry-crl-'));
  try {
    const indexPath = path.join(tmpDir, 'index.txt');
    const cnfPath = path.join(tmpDir, 'openssl.cnf');
    const outPath = path.join(tmpDir, 'crl.pem');
    const crlNumberWorkPath = path.join(tmpDir, 'crlnumber');

    const indexLines = revoked.map(r =>
      `R\t${toCaDate(r.expires_at)}\t${toCaDate(r.revoked_at)}\t${r.serial}\tunknown\t/CN=${r.device_id}`
    );
    fs.writeFileSync(indexPath, indexLines.length ? indexLines.join('\n') + '\n' : '');

    // crlnumber persists across regenerations (in PERSISTENT_CERTS_DIR, not the
    // temp dir) so CRL numbers only ever increase - reusing one could make a
    // TLS stack treat a newer CRL as stale next to one it already cached.
    if (!fs.existsSync(CRL_NUMBER_PATH)) fs.writeFileSync(CRL_NUMBER_PATH, '01\n');
    fs.copyFileSync(CRL_NUMBER_PATH, crlNumberWorkPath);

    const cnf = [
      '[ca]',
      'default_ca = CA_default',
      '',
      '[CA_default]',
      `database = ${indexPath}`,
      `certificate = ${CA_CRT}`,
      `private_key = ${CA_KEY}`,
      `crlnumber = ${crlNumberWorkPath}`,
      'default_crl_days = 30',
      'default_md = sha256',
      '',
    ].join('\n');
    fs.writeFileSync(cnfPath, cnf);

    const res = await runCmd('openssl', ['ca', '-config', cnfPath, '-gencrl', '-out', outPath]);
    if (res.code !== 0) throw new Error(`openssl ca -gencrl failed: ${res.err || res.out}`);

    fs.copyFileSync(crlNumberWorkPath, CRL_NUMBER_PATH);

    // Publish via same-directory temp file + rename (atomic on POSIX) so
    // nothing ever reads a partially-written crl.pem.
    const publishTmpPath = `${CRL_PATH}.tmp`;
    fs.copyFileSync(outPath, publishTmpPath);
    try {
      fs.chmodSync(publishTmpPath, 0o640);
      await runCmd('chgrp', ['mosquitto', publishTmpPath]);
    } catch (e) {
      console.warn('[certs] Warning: could not set CRL permissions:', (e as Error).message);
    }
    fs.renameSync(publishTmpPath, CRL_PATH);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  // The broker reads its copies from /etc/mosquitto/certs, not from
  // PERSISTENT_CERTS_DIR - push the update over and reload it.
  await syncCertsToMosquitto();
}

/** Publish an initial (possibly empty) CRL at boot so Mosquitto's `crlfile` always has something valid to load - an empty revoked-set is itself a valid CRL. */
export async function ensureCRLExists(): Promise<void> {
  if (fs.existsSync(CRL_PATH)) return;
  await regenerateCRL();
}

/**
 * Mirror the persistent certificates (ca/server cert+key/CRL) into
 * /etc/mosquitto/certs, fix ownership, rehash the CA directory, and reload
 * Mosquitto. Replaces the old edgeberry-cert-sync/ca-rehash systemd path
 * units (which watched PERSISTENT_CERTS_DIR from outside the process) -
 * running as one root process, we can just do this directly whenever we
 * write a certificate. Best-effort: on a dev machine without
 * /etc/mosquitto or systemd this logs and moves on.
 */
export async function syncCertsToMosquitto(): Promise<void> {
  const MQTT_CERTS_DIR = '/etc/mosquitto/certs';
  const MQTT_CA_DIR = path.join(MQTT_CERTS_DIR, 'edgeberry-ca.d');
  if (!fs.existsSync(MQTT_CERTS_DIR)) {
    console.log('[certs] /etc/mosquitto/certs not present; skipping broker cert sync');
    return;
  }
  try {
    const copies: Array<[string, string]> = [
      [path.join(PERSISTENT_CERTS_DIR, 'ca.crt'), path.join(MQTT_CERTS_DIR, 'ca.crt')],
      [path.join(PERSISTENT_CERTS_DIR, 'server.crt'), path.join(MQTT_CERTS_DIR, 'server.crt')],
      [path.join(PERSISTENT_CERTS_DIR, 'server.key'), path.join(MQTT_CERTS_DIR, 'server.key')],
      [CRL_PATH, path.join(MQTT_CERTS_DIR, 'crl.pem')],
    ];
    const synced: string[] = [];
    for (const [src, dst] of copies) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        synced.push(path.basename(dst));
      }
    }
    // The CA also lives in the capath dir the broker trusts client certs from
    const caSrc = path.join(PERSISTENT_CERTS_DIR, 'ca.crt');
    if (fs.existsSync(caSrc)) {
      fs.mkdirSync(MQTT_CA_DIR, { recursive: true });
      fs.copyFileSync(caSrc, path.join(MQTT_CA_DIR, 'ca.crt'));
    }

    await runCmd('sh', ['-c', `chown root:mosquitto ${MQTT_CERTS_DIR}/*.crt ${MQTT_CERTS_DIR}/*.key ${MQTT_CERTS_DIR}/crl.pem 2>/dev/null; chown -R root:mosquitto ${MQTT_CA_DIR} 2>/dev/null; chmod 640 ${MQTT_CA_DIR}/* 2>/dev/null; true`]);

    if (fs.existsSync(MQTT_CA_DIR)) {
      const rehash = await runCmd('c_rehash', [MQTT_CA_DIR]);
      if (rehash.code !== 0) await runCmd('openssl', ['rehash', MQTT_CA_DIR]);
    }

    const reload = await runCmd('systemctl', ['reload', 'mosquitto']);
    if (reload.code !== 0) await runCmd('systemctl', ['restart', 'mosquitto']);
    console.log(`[certs] synced to broker (${synced.join(', ') || 'nothing to copy'}) and reloaded Mosquitto`);
  } catch (e) {
    console.warn('[certs] Warning: broker cert sync failed:', (e as Error).message);
  }
}

// Issue a device certificate from a CSR PEM and return PEM strings for cert and CA chain
export async function issueDeviceCertFromCSR(uuid: string, deviceId: string, csrPem: string, days?: number): Promise<{ certPem: string; caChainPem: string }>{
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
    const subjectResult = await runCmd('openssl', ['req', '-noout', '-subject', '-nameopt', 'RFC2253', '-in', csrPath]);
    const subjectLine = (subjectResult.out || '').toString().trim();
    const cnMatch = subjectLine.match(/CN=([^,\/]+)/);
    const cn = cnMatch ? cnMatch[1] : '';
    if (!cn || cn !== deviceId) {
      try { fs.unlinkSync(csrPath); } catch {}
      throw new Error('csr_cn_mismatch');
    }
  } catch (e) {
    // If openssl fails to parse, treat as invalid CSR
    if ((e as Error).message === 'csr_cn_mismatch') throw e;
    throw new Error('invalid_csr_subject');
  }
  const certDays = days ?? 825;
  const daysStr = String(certDays);
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
  const serialRes = await runCmd('openssl', ['x509', '-in', crtPath, '-noout', '-serial']);
  const serial = (serialRes.out || '').trim().split('=').pop() || '';
  const certPem = fs.readFileSync(crtPath, 'utf8');
  try { fs.unlinkSync(crtPath); } catch {}
  const caChainPem = fs.readFileSync(CA_CRT, 'utf8');
  recordIssuedCertificate(serial, uuid, deviceId, certDays);
  return { certPem, caChainPem };
}

// Generate the fleet-wide provisioning ("claim") certificate devices use to
// bootstrap. Skips if one already exists, UNLESS force is set - the startup
// call site (core-service/src/index.ts) relies on that skip so a routine
// restart never silently replaces it out from under already-provisioned
// devices; force:true is for the explicit admin "Renew" action, which does
// mean to replace it (see the POST /renew route's warning about the
// unprovisioned fleet).
export async function generateProvisioningCert(opts?: { force?: boolean }): Promise<void> {
  if (!(await caExists())) {
    throw new Error('Root CA not found. Generate it first.');
  }

  ensureDirs();

  const provisioningCertPath = path.join(PROV_DIR, 'provisioning.crt');
  const provisioningKeyPath = path.join(PROV_DIR, 'provisioning.key');

  // Skip if already exists (unless a renewal was explicitly requested)
  if (!opts?.force && fs.existsSync(provisioningCertPath) && fs.existsSync(provisioningKeyPath)) {
    console.log('[certs] Provisioning certificate already exists');
    return;
  }

  // A forced renewal replaces the fleet-wide claim credential - revoke the
  // outgoing one (CRL) so this is a genuine "the old one stops working"
  // renewal, not just a new file sitting next to a still-trusted old one
  // (both are signed by the same root CA, so without this the old claim
  // cert would keep authenticating fine forever). Any device that hasn't
  // completed its first claim yet and is still holding only the old cert
  // fails its next TLS handshake with the broker once the CRL picks this
  // up - the "damage to the unprovisioned fleet" the /renew route warns
  // about is this, deliberately, not a side effect to avoid.
  if (opts?.force && fs.existsSync(provisioningCertPath)) {
    try {
      const serialRes = await runCmd('openssl', ['x509', '-in', provisioningCertPath, '-noout', '-serial']);
      const serial = (serialRes.out || '').trim().split('=').pop();
      if (serial) {
        const meta = await readCertMeta(provisioningCertPath);
        const db = openCertsDb();
        try {
          const now = new Date().toISOString();
          db.prepare(
            'INSERT OR REPLACE INTO certificates (serial, uuid, device_id, issued_at, expires_at, revoked_at) '+
            'VALUES (?, ?, ?, ?, ?, ?)'
          ).run(serial, PROVISIONING_CERT_SENTINEL_UUID, 'provisioning', now, meta.notAfter || now, now);
        } finally { db.close(); }
        await regenerateCRL();
      }
    } catch (e) {
      console.warn('[certs] Warning: failed to revoke outgoing provisioning cert:', (e as Error).message);
    }
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

    // Mirror the new claim cert into PERSISTENT_CERTS_DIR. PROV_DIR lives
    // under the app install root, which the installer overwrites on every
    // deploy by copying the persistent copy back over it
    // (deploy-artifacts.sh, configure_persistent_certs). Without this
    // write-back the persistent copy stays frozen at whatever the first
    // install generated, so the next upgrade restores a claim certificate
    // that a previous renewal already revoked - and every device then fails
    // its provisioning handshake with "certificate revoked" until someone
    // renews again by hand.
    try {
      fs.mkdirSync(PERSISTENT_CERTS_DIR, { recursive: true });
      const persistentCert = path.join(PERSISTENT_CERTS_DIR, 'provisioning.crt');
      const persistentKey = path.join(PERSISTENT_CERTS_DIR, 'provisioning.key');
      fs.copyFileSync(provisioningCertPath, persistentCert);
      fs.copyFileSync(provisioningKeyPath, persistentKey);
      try { fs.chmodSync(persistentCert, 0o640); } catch {}
      try { fs.chmodSync(persistentKey, 0o640); } catch {}
      console.log('[certs] Mirrored provisioning certificate to persistent storage');
    } catch (e) {
      console.warn('[certs] Warning: could not mirror provisioning certificate to persistent storage:', (e as Error).message);
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

