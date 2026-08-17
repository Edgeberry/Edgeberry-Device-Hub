/**
 * TokenService - the single place `api_tokens` is verified from. Full
 * token CRUD (create/list/delete/toggle) already lives in index.ts's
 * `/api/tokens` REST routes (admin-facing, same process, no D-Bus needed).
 * This interface exists specifically for application-service, which
 * verifies an *external* app's bearer token on every request/WS connection
 * and used to do that by opening devicehub.db directly.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DEVICEHUB_DB } from './config.js';

const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/TokenService';
const IFACE_NAME = 'io.edgeberry.devicehub.TokenService';

function openDb(file: string): any {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch { /* ignore */ }
  try {
    return new Database(file);
  } catch (error) {
    console.error(`Failed to open database ${file}:`, error);
    return null;
  }
}

class TokenInterface {
  async VerifyToken(token: string): Promise<string> {
    const db = openDb(DEVICEHUB_DB);
    if (!db) return JSON.stringify({ success: false, error: 'Database unavailable' });

    try {
      const row = db.prepare('SELECT id, name, scopes, expires_at, active FROM api_tokens WHERE token = ?').get(token) as any;
      if (!row) return JSON.stringify({ success: false, error: 'Invalid token' });
      if (!row.active) return JSON.stringify({ success: false, error: 'Token inactive' });
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return JSON.stringify({ success: false, error: 'Token expired' });
      }

      db.prepare('UPDATE api_tokens SET last_used = ? WHERE id = ?').run(new Date().toISOString(), row.id);

      return JSON.stringify({
        success: true,
        id: row.id,
        name: row.name,
        scopes: row.scopes ? JSON.parse(row.scopes) : [],
        error: null
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

export async function startTokenDbusServer(bus: any): Promise<any> {
  const tokenService = new TokenInterface();

  const serviceObject = {
    VerifyToken: async (token: string) => {
      try {
        return await tokenService.VerifyToken(token);
      } catch (error) {
        return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  };

  bus.exportInterface(serviceObject, OBJECT_PATH, {
    name: IFACE_NAME,
    methods: {
      VerifyToken: ['s', 's']
    },
    signals: {}
  });

  console.log(`Token D-Bus server started on ${BUS_NAME} at ${OBJECT_PATH}`);
  return bus;
}
