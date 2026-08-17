/**
 * Small generic key/value store for admin-toggleable runtime settings
 * (devicehub.db's `app_settings` table). Shared by index.ts (the
 * provisioning claim-cert HTTP-fetch toggle), auth.ts (the auth-disabled
 * escape hatch - see isAuthDisabled), and cli.ts (`devicehub --disable-login`
 * writes here directly, without core-service needing to be running).
 *
 * Ensures the table itself on every open rather than assuming
 * ensureDeviceHubSchema() already ran, since the CLI may be the very first
 * thing to touch this database on a fresh install.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DEVICEHUB_DB } from './config.js';

function openDb(): any {
  try {
    fs.mkdirSync(path.dirname(DEVICEHUB_DB), { recursive: true });
  } catch { /* ignore */ }
  const db: any = new (Database as any)(DEVICEHUB_DB);
  db.pragma('journal_mode = WAL');
  db.prepare('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
  return db;
}

// "1"/"0" strings rather than SQLite's 0/1 integer affinity quirks - keeps
// the stored value unambiguous regardless of how a row was inserted.
export function getAppSetting(key: string, defaultValue: string): string {
  const db = openDb();
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
    return row ? row.value : defaultValue;
  } catch {
    return defaultValue;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

export function setAppSetting(key: string, value: string): void {
  const db = openDb();
  try {
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// Escape hatch for deployments where a reverse proxy (nginx, an oauth2
// proxy, mTLS at the edge, ...) already fully gates access to the Hub -
// requiring a *second*, separate login inside the app is redundant there.
// Default false: every existing deployment keeps requiring login exactly
// as before unless an operator explicitly opts out via the CLI.
const AUTH_DISABLED_KEY = 'auth_disabled';

export function isAuthDisabled(): boolean {
  return getAppSetting(AUTH_DISABLED_KEY, '0') === '1';
}

export function setAuthDisabled(disabled: boolean): void {
  setAppSetting(AUTH_DISABLED_KEY, disabled ? '1' : '0');
}
