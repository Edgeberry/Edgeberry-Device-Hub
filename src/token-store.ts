/**
 * API token verification for external applications. Full token CRUD
 * (create/list/delete/toggle) lives in the admin REST routes in index.ts;
 * this is the per-request verification path used by the application
 * sub-service's REST middleware and WebSocket connection handler.
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

export type TokenInfo = { id: string; name: string; scopes: string[] };

export function verifyToken(token: string): { ok: boolean; token?: TokenInfo; error?: string } {
  const db = openDb();
  if (!db) return { ok: false, error: 'Database unavailable' };
  try {
    const row = db.prepare('SELECT id, name, scopes, expires_at, active FROM api_tokens WHERE token = ?').get(token) as any;
    if (!row) return { ok: false, error: 'Invalid token' };
    if (!row.active) return { ok: false, error: 'Token inactive' };
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { ok: false, error: 'Token expired' };
    }

    db.prepare('UPDATE api_tokens SET last_used = ? WHERE id = ?').run(new Date().toISOString(), row.id);

    return {
      ok: true,
      token: {
        id: row.id,
        name: row.name,
        // Stored as a comma-joined string (see POST /api/tokens in index.ts), not JSON
        scopes: row.scopes ? row.scopes.split(',').filter(Boolean) : []
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
