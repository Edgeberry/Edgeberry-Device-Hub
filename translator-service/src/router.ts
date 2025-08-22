import { resolveDeviceIdByUuid } from './dbus.js';
import { SERVICE, CACHE_REFRESH_MS } from './config.js';

// Simple in-memory cache with TTL
const ttlMs = Math.max(5_000, CACHE_REFRESH_MS);
const cache = new Map<string, { id: string; exp: number }>();

function getCached(uuid: string): string | null {
  const e = cache.get(uuid);
  if (!e) return null;
  if (Date.now() > e.exp) { cache.delete(uuid); return null; }
  return e.id;
}

function setCached(uuid: string, id: string){
  cache.set(uuid, { id, exp: Date.now() + ttlMs });
}

export async function resolveUuidToId(uuid: string): Promise<string | null> {
  try{
    if (!uuid) return null;
    const c = getCached(uuid);
    if (c) return c;
    const id = await resolveDeviceIdByUuid(uuid);
    if (id) setCached(uuid, id);
    return id;
  }catch(e){
    console.warn(`[${SERVICE}] resolveUuidToId error:`, (e as Error).message);
    return null;
  }
}

export function startRouter(): () => void {
  // optional periodic soft refresh: iterate keys and revalidate (best-effort)
  const timer = setInterval(async () => {
    try{
      const keys = Array.from(cache.keys());
      for (const k of keys){
        // touch entries to extend if still valid; skip if expired
        if (!getCached(k)) continue;
        try{
          const id = await resolveDeviceIdByUuid(k);
          if (id) setCached(k, id);
        }catch{}
      }
    }catch{}
  }, ttlMs).unref();
  return () => clearInterval(timer);
}
