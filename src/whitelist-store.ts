/**
 * UUID whitelist - gate for device provisioning. Used by the provisioning
 * sub-service's claim handshake (services/provisioning/mqtt.ts) and the
 * admin REST routes in index.ts.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DEVICEHUB_DB } from './config.js';

function openDb(): any {
  try {
    fs.mkdirSync(path.dirname(DEVICEHUB_DB), { recursive: true });
  } catch { /* ignore */ }
  try {
    return new Database(DEVICEHUB_DB);
  } catch (error) {
    console.error(`Failed to open database ${DEVICEHUB_DB}:`, error);
    return null;
  }
}

export type WhitelistCheck = {
  ok: boolean;
  uuid?: string | null;
  note?: string | null;
  used_at?: string | null;
  error?: string;
};

export function checkUuid(uuid: string): WhitelistCheck {
  const db = openDb();
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    const row = db.prepare('SELECT uuid, hardware_version, manufacturer, used_at, disabled_at FROM uuid_whitelist WHERE uuid = ?').get(uuid) as any;
    if (!row) return { ok: false, uuid, error: 'UUID not found in whitelist' };

    // An admin-disabled entry is rejected the same way a used one is -
    // just reversible, where used_at never clears.
    if (row.disabled_at) {
      return { ok: false, uuid: row.uuid, note: `${row.manufacturer} ${row.hardware_version}` || null, used_at: row.used_at || null, error: 'UUID disabled' };
    }

    // used_at is informational ("last claimed"), not a gate - a whitelisted
    // UUID is the device's durable hardware identity, not a one-time
    // secret, and it must be able to reprovision itself for as long as it
    // stays whitelisted and not disabled.
    return { ok: true, uuid: row.uuid, note: `${row.manufacturer} ${row.hardware_version}` || null, used_at: row.used_at || null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Records the most recent successful claim. Always succeeds for a UUID
 * that exists - reprovisioning is meant to work every time. The actual
 * "one claim in flight at a time" guarantee comes from Mosquitto: the
 * provisioning connection's client ID is the UUID, and the broker only
 * tolerates one live connection per client ID. */
export function markUsed(uuid: string): { ok: boolean; error?: string } {
  const db = openDb();
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    const existing = db.prepare('SELECT uuid FROM uuid_whitelist WHERE uuid = ?').get(uuid);
    if (!existing) return { ok: false, error: 'UUID not found in whitelist' };
    const info = db.prepare('UPDATE uuid_whitelist SET used_at = ? WHERE uuid = ?').run(new Date().toISOString(), uuid);
    if (info.changes === 0) return { ok: false, error: 'Failed to mark UUID as used' };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
