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
export async function batchUploadWhitelist(uuids: string[]){
  const res = await fetch(base()+'/admin/uuid-whitelist/batch', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ uuids }),
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
// --- Roles: a persistent, admin-chosen label pointing at a device's uuid.
// Replaces the old device rename/replace endpoints - a role survives both
// reprovisioning (which rotates a device's raw MQTT name) and hardware
// swaps (by repointing the role at a different uuid), which raw device
// identity never could.
/**
 * List all roles, each with its current device's name/online status
 */
export async function getRoles(){ return jsonOrMessage(await fetch(base()+"/roles", { credentials:'include' })); }
/**
 * Set (or clear) a device's role. A device holds at most one role, so this
 * is the only operation needed: pass a name to label the device with it
 * (unplugging it from whatever device held that name before, if any), or
 * an empty string/null to clear it.
 * @param uuid device uuid
 * @param role role name, or null/empty to clear
 */
export async function setDeviceRole(uuid: string, role: string|null){
  const res = await fetch(base()+`/devices/${encodeURIComponent(uuid)}/role`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ role: role || '' }) });
  return jsonOrMessage(res);
}

// --- Groups: free-form tags on a device's *application id* (its role), not on
// the hardware. A device can carry any number; several devices share one.
// Because they hang off the application id, they follow a hardware swap
// automatically - which is what makes an ownership tag like `user-<id>` safe
// to rely on across a device replacement.
/**
 * List every group in use, with device counts
 */
export async function getGroups(){ return jsonOrMessage(await fetch(base()+"/groups", { credentials:'include' })); }
/**
 * Replace the groups on this device's application id. Pass a single string or
 * an array; an empty array clears them. The device must already have a role -
 * there is no application id to tag otherwise.
 */
export async function setDeviceGroups(uuid: string, groups: string[]|string){
  const res = await fetch(base()+`/devices/${encodeURIComponent(uuid)}/groups`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ groups }) });
  return jsonOrMessage(res);
}

// --- Provisioning claim-certificate HTTP fetch switch. Off is an opt-in
// hardening step for operators who install the claim cert on devices
// out-of-band instead of letting them download it over HTTP.
export async function getProvisioningCertFetchEnabled(){
  return jsonOrMessage(await fetch(base()+"/settings/provisioning/cert-fetch", { credentials:'include' }));
}
export async function setProvisioningCertFetchEnabled(enabled: boolean){
  const res = await fetch(base()+"/settings/provisioning/cert-fetch", { method:'PUT', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ enabled }) });
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
