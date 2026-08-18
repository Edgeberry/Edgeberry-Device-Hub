/**
 * Device registry - shared by the admin REST API (index.ts), the
 * provisioning sub-service (services/provisioning/), and the application
 * sub-service (services/application/). One implementation so every surface
 * agrees on device shape, online-status resolution, and role precedence.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { DEVICEHUB_DB } from './config.js';
import { getAllDeviceStatuses } from './twin-store.js';
import { generateDefaultDeviceName, validateDeviceName } from './device-names.js';

export type DeviceListEntry = {
  uuid: string;
  name: string;
  role: string | null;
  /** Free-form operator tags. A device can be in any number of groups, and a
   *  group exists only as long as some device references it. */
  groups: string[];
  token: string;
  meta: any;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  disabled: boolean;
};

export function tryParseJson(txt: any) {
  if (typeof txt !== 'string') return txt;
  try { return JSON.parse(txt); } catch { return txt; }
}

function openDb(file: string): any {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch { /* ignore */ }
  try {
    const db: any = new (Database as any)(file);
    db.pragma('journal_mode = WAL');
    return db;
  } catch {
    return null;
  }
}

export function getDevicesListSync(): { devices: DeviceListEntry[] } {
  const db = openDb(DEVICEHUB_DB);
  if (!db) {
    console.error(`[getDevicesListSync] Failed to open database: ${DEVICEHUB_DB}`);
    return { devices: [] };
  }
  try {
    const tableInfo = db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string; type: string; pk: number }>;
    const hasUuidColumn = tableInfo.some(col => col.name === 'uuid');
    if (!hasUuidColumn) {
      console.error(`[getDevicesListSync] SCHEMA ERROR: devices table missing uuid column. Available columns:`, tableInfo.map(col => col.name));
      return { devices: [] };
    }

    const rows = db.prepare('SELECT uuid, name, token, meta, created_at FROM devices ORDER BY created_at DESC').all() as any[];

    const deviceStatuses = getAllDeviceStatuses();

    // A device whose whitelist UUID was disabled is effectively blacklisted -
    // it can no longer (re)provision - so its status should say so regardless
    // of whatever the twin database last heard from it.
    let disabledUuids = new Set<string>();
    try {
      const disabledRows = db.prepare('SELECT uuid FROM uuid_whitelist WHERE disabled_at IS NOT NULL').all() as Array<{ uuid: string }>;
      disabledUuids = new Set(disabledRows.map(r => r.uuid));
    } catch (e) {
      console.error('[getDevicesListSync] Failed to load disabled whitelist UUIDs:', e);
    }

    let roleByUuid = new Map<string, string>();
    try {
      const roleRows = db.prepare('SELECT role, uuid FROM device_roles').all() as Array<{ role: string; uuid: string }>;
      roleByUuid = new Map(roleRows.map(r => [r.uuid, r.role]));
    } catch (e) {
      console.error('[getDevicesListSync] Failed to load device roles:', e);
    }

    // Loaded in one query and bucketed in memory rather than per device -
    // this list is rendered on every dashboard poll and every application
    // GET /api/devices. Keyed by role: groups belong to the application id,
    // so a device without a role simply has none.
    const groupsByRole = new Map<string, string[]>();
    try {
      const groupRows = db.prepare('SELECT role, group_name FROM device_groups ORDER BY group_name').all() as Array<{ role: string; group_name: string }>;
      for (const g of groupRows) {
        const list = groupsByRole.get(g.role);
        if (list) list.push(g.group_name);
        else groupsByRole.set(g.role, [g.group_name]);
      }
    } catch (e) {
      console.error('[getDevicesListSync] Failed to load device groups:', e);
    }

    const devices = rows.map((r: any) => {
      // Keyed by whatever MQTT identity twin-service actually observed in the
      // topic/connection-log line - the device's assigned name (r.name),
      // never its UUID, once it has completed the masked-identity
      // provisioning handshake.
      const deviceStatus = deviceStatuses[r.name] ?? deviceStatuses[r.uuid];
      const online = deviceStatus ? deviceStatus.online : false;
      const last_seen = deviceStatus ? deviceStatus.last_seen : null;

      const deviceRole = roleByUuid.get(r.uuid) ?? null;
      return {
        uuid: r.uuid,
        name: r.name,
        role: deviceRole,
        groups: deviceRole ? (groupsByRole.get(deviceRole) ?? []) : [],
        token: r.token,
        meta: tryParseJson(r.meta),
        created_at: r.created_at,
        last_seen,
        online,
        disabled: disabledUuids.has(r.uuid)
      };
    });
    return { devices };
  } catch (error) {
    console.error(`[getDevicesListSync] Error querying devices:`, error);
    return { devices: [] };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Role → devices.name → treat as a raw uuid, same precedence used
 * throughout the UI/API for resolving a user-facing identifier to a uuid. */
export function resolveIdentifierToUuid(identifier: string): string | null {
  if (!identifier) return null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const db = openDb(DEVICEHUB_DB);
  if (!db) return uuidPattern.test(identifier) ? identifier : null;
  try {
    const role = db.prepare('SELECT uuid FROM device_roles WHERE role = ?').get(identifier) as any;
    if (role) return role.uuid;
    const device = db.prepare('SELECT uuid FROM devices WHERE name = ?').get(identifier) as any;
    if (device) return device.uuid;
    return uuidPattern.test(identifier) ? identifier : null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** uuid → role if assigned, else raw MQTT name, else the uuid itself - the
 * identifier application clients and the UI should display. */
export function resolvePublicIdFromUuid(uuid: string): string {
  const db = openDb(DEVICEHUB_DB);
  if (!db) return uuid;
  try {
    const role = db.prepare('SELECT role FROM device_roles WHERE uuid = ?').get(uuid) as any;
    if (role?.role) return role.role;
    const device = db.prepare('SELECT name FROM devices WHERE uuid = ?').get(uuid) as any;
    return device?.name || uuid;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Single device by uuid, same shape as one entry from getDevicesListSync(). */
export function getDeviceByUuid(uuid: string): DeviceListEntry | null {
  const { devices } = getDevicesListSync();
  return devices.find(d => d.uuid === uuid) || null;
}

// ===== Groups =====
//
// Operator-assigned tags, keyed on the *role* (the application-facing id),
// not on the hardware uuid. See the device_groups comment in
// ensureDeviceHubSchema: the tag belongs to the application identity, so it
// travels with that identity when the role is repointed at replacement
// hardware. A device with no role has no application identity yet and so
// carries no groups.

// Long enough for an opaque tenancy identifier - a "user-<uuid>" tag is ~41
// characters, and callers may prefix or namespace further.
export const MAX_GROUP_NAME_LENGTH = 128;

/**
 * Accept what callers actually send - a single group as a bare string, or a
 * list - and reduce it to a clean, de-duplicated, order-stable array.
 * Returns an error rather than silently dropping bad entries, so a typo in an
 * automation surfaces instead of quietly un-grouping a device.
 *
 * Group names are compared **exactly**, case included, everywhere they are
 * matched. Case-insensitive matching would be friendlier for hand-typed tags
 * ("Freezers" == "freezers"), but groups are also used as tenancy markers -
 * a `user-<opaque-id>` tag scoping a fleet to one owner. Opaque ids can differ
 * by case alone, and folding case would silently merge two distinct owners
 * into one group, showing each other's devices and telemetry. Two tags that
 * differ only in case are therefore two groups.
 */
export function normalizeGroups(input: unknown): { ok: boolean; groups?: string[]; error?: string } {
  if (input === null || input === undefined) return { ok: true, groups: [] };
  const raw = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return { ok: false, error: 'groups must be a string or an array of strings' };
    const name = entry.trim();
    if (!name) continue; // tolerate empty padding, e.g. from a trailing comma
    if (name.length > MAX_GROUP_NAME_LENGTH) {
      return { ok: false, error: `group name exceeds ${MAX_GROUP_NAME_LENGTH} characters: "${name.slice(0, 20)}..."` };
    }
    if (seen.has(name)) continue;
    seen.add(name);
    groups.push(name);
  }
  return { ok: true, groups };
}

/** Groups for an application id (role). */
export function getGroupsForRole(role: string): string[] {
  if (!role) return [];
  const db = openDb(DEVICEHUB_DB);
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT group_name FROM device_groups WHERE role = ? ORDER BY group_name').all(role) as Array<{ group_name: string }>;
    return rows.map(r => r.group_name);
  } catch {
    return [];
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Groups for whatever device currently holds a given hardware uuid, via its role. */
export function getDeviceGroups(uuid: string): string[] {
  const device = getDeviceByUuid(uuid);
  return device && device.role ? getGroupsForRole(device.role) : [];
}

/** Replace an application id's entire group membership. */
export function setGroupsForRole(role: string, groups: string[]): { ok: boolean; groups?: string[]; error?: string } {
  if (!role) return { ok: false, error: 'role_required' };
  const db = openDb(DEVICEHUB_DB);
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    const apply = db.transaction(() => {
      db.prepare('DELETE FROM device_groups WHERE role = ?').run(role);
      const insert = db.prepare('INSERT OR IGNORE INTO device_groups (role, group_name) VALUES (?, ?)');
      for (const g of groups) insert.run(role, g);
    });
    apply();
    return { ok: true, groups };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Every group currently in use, with how many devices carry it. */
export function listGroups(): Array<{ group: string; device_count: number }> {
  const db = openDb(DEVICEHUB_DB);
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT group_name AS "group", COUNT(*) AS device_count FROM device_groups GROUP BY group_name ORDER BY group_name'
    ).all() as Array<{ group: string; device_count: number }>;
  } catch {
    return [];
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Drop every group membership for an application id - used when a role is
 *  retired (cleared, or its device decommissioned). Not called on a swap:
 *  there the role lives on, so its groups must too. */
export function clearGroupsForRole(role: string): void {
  if (!role) return;
  const db = openDb(DEVICEHUB_DB);
  if (!db) return;
  try {
    db.prepare('DELETE FROM device_groups WHERE role = ?').run(role);
  } catch { /* ignore */ } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// ===== Provisioning-side registration (used by services/provisioning/) =====

function ensureDevicesTable(db: any) {
  db.prepare(`CREATE TABLE IF NOT EXISTS devices (
    uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT,
    meta TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

// crypto.randomBytes rather than Math.random(): this name is a security
// boundary (the whole point is that it must not be predictable). No fixed
// prefix - a device name should not read as if it encodes a scheme.
function generateRandomDeviceName(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

// The name a device is assigned during provisioning, so its UUID (a
// long-lived hardware identity, not a one-time secret) never becomes its
// ongoing MQTT/TLS identity.
//
// Every successful claim gets a *fresh* random name, replacing whatever was
// reserved before - reprovisioning is meant to be a genuine fresh start,
// not a renewal of the old identity. The row is upserted rather than
// deleted-and-reinserted: the uuid is the primary key and never changes, so
// only the mutable columns need resetting, and device_events.device_id has a
// foreign key onto devices(uuid) - deleting the row first fails outright
// (SQLITE_CONSTRAINT_FOREIGNKEY) as soon as the device has any recorded
// telemetry or events, which is every reprovision of a device that has ever
// been in service. The upsert also removes the window where the uuid has no
// row at all.
//
// Random on purpose: a name derived from the UUID would let anyone who
// learns the UUID predict the device's public identity ahead of time.
// Uniqueness is a real database constraint (the unique index below), not a
// check-then-insert race - a collision retries with a new candidate.
export function claimDeviceName(uuid: string): { ok: boolean; deviceId?: string; error?: string } {
  const db = openDb(DEVICEHUB_DB);
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    ensureDevicesTable(db);
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_name ON devices(name)').run();

    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = generateRandomDeviceName();
      try {
        const claim = db.transaction((deviceUuid: string, deviceName: string) => {
          db.prepare(
            `INSERT INTO devices (uuid, name, token, meta, created_at)
             VALUES (?, ?, '', '{}', CURRENT_TIMESTAMP)
             ON CONFLICT(uuid) DO UPDATE SET
               name = excluded.name,
               token = excluded.token,
               meta = excluded.meta,
               created_at = excluded.created_at`
          ).run(deviceUuid, deviceName);
        });
        claim(uuid, candidate);
        console.log(`[devices-store] Claimed uuid=${uuid} -> deviceId=${candidate}`);
        return { ok: true, deviceId: candidate };
      } catch (e: any) {
        if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || e?.code === 'SQLITE_CONSTRAINT') {
          continue; // name collision - try another candidate
        }
        throw e;
      }
    }
    return { ok: false, error: 'name_space_exhausted' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Reads back whatever claimDeviceName most recently assigned for this
 * uuid, without claiming a new name - round 2 of provisioning must see the
 * exact name round 1 handed the device, not a fresh one. */
export function resolveDeviceIdByUuid(uuid: string): { ok: boolean; deviceId?: string; error?: string } {
  const db = openDb(DEVICEHUB_DB);
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    const row = db.prepare('SELECT uuid, name FROM devices WHERE uuid = ?').get(uuid) as any;
    if (!row) return { ok: false, error: 'Device not found for UUID' };
    // The device's ongoing identity is its assigned name, not its UUID -
    // this function exists specifically to resolve one to the other.
    return { ok: true, deviceId: row.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

export function registerDevice(uuid: string, name: string, token: string, metaJson: string): { ok: boolean; name?: string; error?: string } {
  const db = openDb(DEVICEHUB_DB);
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    ensureDevicesTable(db);

    let deviceName = name;
    if (!deviceName) {
      deviceName = generateDefaultDeviceName(uuid);
    } else {
      const validation = validateDeviceName(deviceName);
      if (!validation.valid) {
        deviceName = validation.sanitized || generateDefaultDeviceName(uuid);
      }
    }

    db.prepare(`INSERT OR REPLACE INTO devices (uuid, name, token, meta, created_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(uuid, deviceName, token || '', metaJson || '{}');
    console.log(`[devices-store] Device registered: ${uuid} -> ${deviceName}`);
    return { ok: true, name: deviceName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
