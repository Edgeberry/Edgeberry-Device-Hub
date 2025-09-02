import { resolveDeviceNameByUuid } from './dbus.js';
import { SERVICE, CACHE_REFRESH_MS } from './config.js';

// Simple in-memory cache with TTL for UUID -> device name mapping
const ttlMs = Math.max(5_000, CACHE_REFRESH_MS);
const cache = new Map<string, { name: string; exp: number }>();

function getCached(uuid: string): string | null {
  const e = cache.get(uuid);
  if (!e) return null;
  if (Date.now() > e.exp) { cache.delete(uuid); return null; }
  return e.name;
}

function setCached(uuid: string, name: string){
  cache.set(uuid, { name, exp: Date.now() + ttlMs });
}

export async function resolveUuidToName(uuid: string): Promise<string | null> {
  try{
    if (!uuid) return null;
    const c = getCached(uuid);
    if (c) return c;
    const name = await resolveDeviceNameByUuid(uuid);
    if (name) setCached(uuid, name);
    return name;
  }catch(e){
    console.warn(`[${SERVICE}] resolveUuidToName error:`, (e as Error).message);
    return null;
  }
}

export function invalidateCache(uuid?: string): void {
  if (uuid) {
    cache.delete(uuid);
    console.log(`[${SERVICE}] invalidated cache for UUID: ${uuid}`);
  } else {
    cache.clear();
    console.log(`[${SERVICE}] invalidated entire cache`);
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
          const name = await resolveDeviceNameByUuid(k);
          if (name) setCached(k, name);
        }catch{}
      }
    }catch{}
  }, ttlMs).unref();
  return () => clearInterval(timer);
}
