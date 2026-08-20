/**
 * Edgeberry Device Hub admin CLI.
 *
 * Operates directly on the Device Hub SQLite database rather than through
 * core-service's HTTP API - this must keep working even when core-service
 * itself is down (e.g. an operator locked out and needing to reset the
 * admin password), and it must run as a plain one-shot process rather than
 * booting the whole service (index.ts starts the HTTP/MQTT/D-Bus stack as a
 * side effect of being imported, so this is a separate entrypoint that only
 * pulls in the side-effect-free pieces: config.ts and password.ts). Uses the
 * same bcrypt hashing (password.ts) and `users` table schema core-service
 * itself uses, so a password set here is exactly what core-service's own
 * login will accept.
 */
import Database from 'better-sqlite3';
import { DEVICEHUB_DB, ADMIN_USER } from './config.js';
import { hashPassword, validatePasswordStrength } from './password.js';
import { isAuthDisabled, setAuthDisabled, isWebTerminalEnabled, setWebTerminalEnabled } from './app-settings.js';

function openDb(){
  return new (Database as any)(DEVICEHUB_DB);
}

function ensureUsersTable(db: any){
  db.prepare(
    'CREATE TABLE IF NOT EXISTS users ('+
    ' username TEXT PRIMARY KEY,'+
    ' password_hash TEXT NOT NULL,'+
    ' created_at TEXT DEFAULT CURRENT_TIMESTAMP,'+
    ' updated_at TEXT DEFAULT CURRENT_TIMESTAMP)'
  ).run();
}

async function updatePassword(newPassword: string){
  const validationError = validatePasswordStrength(newPassword);
  if (validationError) {
    console.error(`Error: ${validationError}`);
    process.exitCode = 1;
    return;
  }
  const db = openDb();
  try {
    ensureUsersTable(db);
    const hash = await hashPassword(newPassword);
    const existing = db.prepare('SELECT username FROM users WHERE username = ?').get(ADMIN_USER);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?').run(hash, ADMIN_USER);
    } else {
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(ADMIN_USER, hash);
    }
    console.log(`Password updated for user "${ADMIN_USER}".`);
  } finally {
    db.close();
  }
}

function listDevices(){
  const db = openDb();
  try {
    const devicesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'").get();
    if (!devicesTable) {
      console.log('No devices table found yet - core-service has not started on this Hub.');
      return;
    }
    const rows = db.prepare('SELECT uuid, name, created_at FROM devices ORDER BY created_at DESC').all() as Array<{ uuid: string; name: string; created_at: string }>;
    if (rows.length === 0) {
      console.log('No devices found.');
      return;
    }
    let roleByUuid = new Map<string, string>();
    try {
      const roleRows = db.prepare('SELECT role, uuid FROM device_roles').all() as Array<{ role: string; uuid: string }>;
      roleByUuid = new Map(roleRows.map(r => [r.uuid, r.role]));
    } catch { /* device_roles may not exist yet */ }

    const col = { uuid: 36, name: 12, role: 20 };
    const header = `${'UUID'.padEnd(col.uuid)}  ${'NAME'.padEnd(col.name)}  ${'ROLE'.padEnd(col.role)}  CREATED`;
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const r of rows) {
      const role = roleByUuid.get(r.uuid) || '-';
      console.log(`${r.uuid.padEnd(col.uuid)}  ${r.name.padEnd(col.name)}  ${role.padEnd(col.role)}  ${r.created_at}`);
    }
  } finally {
    db.close();
  }
}

function disableLogin(){
  setAuthDisabled(true);
  console.log('Login disabled. Every Device Hub request (UI and API) is now open with no session check.');
  console.log('Only do this behind a reverse proxy that handles authentication itself (nginx auth_basic, an oauth2-proxy, mTLS, etc).');
  console.log('Re-enable with: devicehub --enable-login');
}

function enableLogin(){
  setAuthDisabled(false);
  console.log('Login re-enabled. Requests now require a valid session again.');
}

function loginStatus(){
  console.log(isAuthDisabled() ? 'Login is DISABLED (open access, no session check).' : 'Login is enabled (default).');
}

/*
 *  The browser terminal is off unless switched on here, and can only be
 *  switched on here. It serves a shell on this host, so enabling it should
 *  require the access it grants - an admin session alone must not be able to
 *  widen itself into one. Takes effect immediately; no service restart.
 */
function enableWebTerminal(){
  setWebTerminalEnabled(true);
  console.log('Web terminal ENABLED. The Terminal button in the System panel now opens a shell on this host.');
  console.log(`It runs as the user the service runs as (currently ${process.getuid?.() === 0 ? 'root' : 'uid ' + process.getuid?.()}), and is reachable by anyone with an admin session.`);
  console.log('Disable it again with: devicehub --disable-webterminal');
}

function disableWebTerminal(){
  setWebTerminalEnabled(false);
  console.log('Web terminal DISABLED (default). Existing sessions are unaffected until they disconnect; new ones are refused.');
}

function webTerminalStatus(){
  console.log(isWebTerminalEnabled() ? 'Web terminal is ENABLED.' : 'Web terminal is disabled (default).');
}

function printHelp(){
  console.log(`Edgeberry Device Hub admin CLI

Usage:
  devicehub --update-password <newPassword>   Set the admin account password
  devicehub --list-devices                    List registered devices
  devicehub --disable-login                   Disable the built-in login (for use behind a
                                               reverse proxy that already handles auth)
  devicehub --enable-login                    Re-enable the built-in login (default)
  devicehub --login-status                    Show whether login is currently enabled
  devicehub --enable-webterminal              Enable the browser terminal in the web UI
                                               (off by default - it serves a shell on this host)
  devicehub --disable-webterminal             Disable the browser terminal (default)
  devicehub --webterminal-status              Show whether the browser terminal is enabled
  devicehub --help                             Show this help
`);
}

async function main(){
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const pwIdx = args.indexOf('--update-password');
  if (pwIdx !== -1) {
    const value = args[pwIdx + 1];
    if (!value) {
      console.error('Error: --update-password requires a value, e.g. --update-password "newPassword"');
      process.exitCode = 1;
      return;
    }
    await updatePassword(value);
    return;
  }

  if (args.includes('--list-devices')) {
    listDevices();
    return;
  }

  if (args.includes('--disable-login')) {
    disableLogin();
    return;
  }

  if (args.includes('--enable-login')) {
    enableLogin();
    return;
  }

  if (args.includes('--login-status')) {
    loginStatus();
    return;
  }

  if (args.includes('--enable-webterminal')) {
    enableWebTerminal();
    return;
  }

  if (args.includes('--disable-webterminal')) {
    disableWebTerminal();
    return;
  }

  if (args.includes('--webterminal-status')) {
    webTerminalStatus();
    return;
  }

  console.error(`Unknown argument: ${args[0]}`);
  printHelp();
  process.exitCode = 1;
}

main().catch(e => {
  console.error('Error:', e?.message || e);
  process.exitCode = 1;
});
