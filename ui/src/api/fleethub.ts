/**
 * Fleet Hub API client
 *
 * Thin wrapper around `fetch` for the core-service API. All requests include
 * `credentials: 'include'` so the HttpOnly JWT cookie is sent automatically.
 *
 * Conventions:
 * - Each function returns JSON (or an `{ message }` object) for easy rendering.
 * - Endpoints are grouped by feature area (health, services, devices).
 */
async function jsonOrMessage(res: Response){
  try{ return await res.json(); }catch(err:any){ return { message: err?.toString?.() || 'Invalid JSON' }; }
}
const base = () => window.location.origin + '/api';

// --- Health/config/version/status ---
/**
 * Get overall health summary
 */
export async function getHealth(){ return jsonOrMessage(await fetch(base()+"/health", { credentials:'include' })); }
/**
 * Get overall system status
 */
export async function getStatus(){ return jsonOrMessage(await fetch(base()+"/status", { credentials:'include' })); }
/**
 * Get service version info
 */
export async function getVersion(){ return jsonOrMessage(await fetch(base()+"/version", { credentials:'include' })); }
/**
 * Get public UI/config metadata
 */
export async function getPublicConfig(){ return jsonOrMessage(await fetch(base()+"/config/public", { credentials:'include' })); }

// --- Core-service services and logs ---
/**
 * List managed service units and their status
 */
export async function getServices(){ return jsonOrMessage(await fetch(base()+"/services", { credentials:'include' })); }
/**
 * Get metrics (if available)
 */
export async function getMetrics(){
  try{
    return await jsonOrMessage(await fetch(base()+"/metrics", { credentials:'include' }));
  }catch{
    return {} as any;
  }
}
/**
 * Get recent service logs
 * @param unit systemd unit name
 * @param lines number of lines to fetch (default 200)
 */
export async function getServiceLogs(unit: string, lines: number = 200){
  const url = base()+`/logs?unit=${encodeURIComponent(unit)}&lines=${encodeURIComponent(lines)}`;
  return jsonOrMessage(await fetch(url, { credentials:'include' }));
}
/**
 * Start service unit
 * @param unit systemd unit name
 */
export async function startService(unit: string){
  const url = base()+`/services/${encodeURIComponent(unit)}/start`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
/**
 * Stop service unit
 * @param unit systemd unit name
 */
export async function stopService(unit: string){
  const url = base()+`/services/${encodeURIComponent(unit)}/stop`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
/**
 * Restart service unit
 * @param unit systemd unit name
 */
export async function restartService(unit: string){
  const url = base()+`/services/${encodeURIComponent(unit)}/restart`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

// --- Devices registry (future expansion) ---
/**
 * List devices
 */
export async function getDevices(){ return jsonOrMessage(await fetch(base()+"/devices", { credentials:'include' })); }
/**
 * Get a single device by id
 * @param id device id
 */
export async function getDevice(id: string){ return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(id)}`, { credentials:'include' })); }
/**
 * Get device events
 * @param id device id
 */
export async function getDeviceEvents(id: string){ return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(id)}/events`, { credentials:'include' })); }
/**
 * Create a device (future)
 * @param body device data
 */
export async function createDevice(body: any){
  const res = await fetch(base()+"/devices", { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body||{}) });
  return jsonOrMessage(res);
}
/**
 * Issue a short-lived provision token for a device
 * @param id device id
 * @param hours token lifetime (optional)
 */
export async function createProvisionToken(id: string, hours?: number){
  const res = await fetch(base()+`/devices/${encodeURIComponent(id)}/provision-token`+ (hours?`?hours=${encodeURIComponent(hours)}`:''), { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include' });
  return jsonOrMessage(res);
}
