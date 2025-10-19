/**
 * Device Hub API client
 *
 * Thin wrapper around `fetch` for the core-service API. All requests include
 * `credentials: 'include'` so the HttpOnly JWT cookie is sent automatically.
 *
 * Conventions:
 * - Each function returns JSON (or an `{ message }` object) for easy rendering.
 * - Endpoints are grouped by feature area (health, services, devices).
 */
// Parse JSON response; if parsing fails, return a simple message object.
// This keeps UI rendering paths simple without throwing on non-JSON bodies.
async function jsonOrMessage(res: Response){
  try{ return await res.json(); }catch(err:any){ return { message: err?.toString?.() || 'Invalid JSON' }; }
}
// Compute API base relative to current origin. Core-service mounts APIs at `/api/*`.
// All requests below use `credentials: 'include'` so the HttpOnly JWT cookie is sent.
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
// Metrics endpoint may not be implemented in all builds; return empty object if unreachable.
export async function getMetrics(){
  try{
    return await jsonOrMessage(await fetch(base()+"/metrics", { credentials:'include' }));
  }catch{
    return {} as any;
  }
}
/**
 * Get metrics history samples for the past `hours` (default 24)
 */
export async function getMetricsHistory(hours: number = 24){
  try{
    const url = base()+`/metrics/history?hours=${encodeURIComponent(hours)}`;
    return await jsonOrMessage(await fetch(url, { credentials:'include' }));
  }catch{
    return { hours, samples: [] } as any;
  }
}
/**
 * Get recent service logs
 * @param unit systemd unit name
 * @param lines number of lines to fetch (default 200)
 */
// Fetch last N log lines for a systemd unit. The backend validates `unit`.
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

// --- Diagnostics ---
/**
 * Run device-side MQTT sanity test via core-service
 * Body fields are optional; defaults are used by backend when omitted.
 */
export async function runMqttSanityTest(body?: {
  deviceId?: string;
  mqttUrl?: string;
  ca?: string;
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
  timeoutSec?: number;
}){
  const res = await fetch(base()+"/diagnostics/mqtt-test", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {})
  });
  return jsonOrMessage(res);
}

// --- Devices registry (future expansion) ---
/**
 * List devices
 */
export async function getDevices(){ return jsonOrMessage(await fetch(base()+"/devices", { credentials:'include' })); }
/**
 * Get a single device by uuid
 * @param uuid device uuid
 */
export async function getDevice(uuid: string){ return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(uuid)}`, { credentials:'include' })); }
/**
 * Get device events
 * @param uuid device uuid
 */
export async function getDeviceEvents(uuid: string){ return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(uuid)}/events`, { credentials:'include' })); }
/**
 * Create a device (future)
 * @param body device data
 */
// Create a device record (placeholder for future expansion)
export async function createDevice(body: any){
  const res = await fetch(base()+"/devices", { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body||{}) });
  return jsonOrMessage(res);
}
/**
 * Decommission a device (remove from provisioning DB)
 */
export async function decommissionDevice(uuid: string){
  const res = await fetch(base()+`/devices/${encodeURIComponent(uuid)}`, { method:'DELETE', credentials:'include' });
  return jsonOrMessage(res);
}
/**
 * Remove all whitelist entries for a device
 */
export async function deleteWhitelistByDevice(deviceUuid: string){
  const res = await fetch(base()+`/admin/uuid-whitelist/by-device/${encodeURIComponent(deviceUuid)}`, { method:'DELETE', credentials:'include' });
  return jsonOrMessage(res);
}

/**
 * Batch upload UUIDs to whitelist from array
 */
export async function batchUploadWhitelist(uuids: string[], hardwareVersion: string, manufacturer: string){
  const res = await fetch(base()+'/admin/uuid-whitelist/batch', { 
    method:'POST', 
    headers:{'content-type':'application/json'}, 
    body: JSON.stringify({ uuids, hardware_version: hardwareVersion, manufacturer }), 
    credentials:'include' 
  });
  return jsonOrMessage(res);
}
/**
 * Issue a short-lived provision token for a device
 * @param uuid device uuid
 * @param hours token lifetime (optional)
 */
// Ask backend to mint a short-lived provision token for device bootstrap.
// If `hours` is omitted, backend chooses a default TTL.
export async function createProvisionToken(uuid: string, hours?: number){
  const res = await fetch(base()+`/devices/${encodeURIComponent(uuid)}/provision-token`+ (hours?`?hours=${encodeURIComponent(hours)}`:''), { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include' });
  return jsonOrMessage(res);
}
/**
 * Update device name
 * @param uuid device uuid
 * @param name new device name
 */
export async function updateDevice(uuid: string, name: string){
  const res = await fetch(base()+`/devices/${encodeURIComponent(uuid)}`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ name }) });
  return jsonOrMessage(res);
}
/**
 * Replace device with another device
 * @param uuid device uuid to replace
 * @param targetUuid uuid of device to replace with
 */
export async function replaceDevice(uuid: string, targetUuid: string){
  const res = await fetch(base()+`/devices/${encodeURIComponent(uuid)}/replace`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ targetUuid }) });
  return jsonOrMessage(res);
}

/**
 * Run comprehensive system sanity check
 */
export async function runSystemSanityCheck(){
  const res = await fetch(base()+'/system/sanity-check', { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

/**
 * Reboot the system
 */
export async function rebootSystem(){
  const res = await fetch(base()+'/system/reboot', { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

/**
 * Shutdown the system
 */
export async function shutdownSystem(){
  const res = await fetch(base()+'/system/shutdown', { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

/**
 * Refresh JWT token to extend session
 */
export async function refreshAuthToken(){
  const res = await fetch(base()+'/auth/refresh', { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
