/* Fleet Hub API client */
async function jsonOrMessage(res: Response){
  try{ return await res.json(); }catch(err:any){ return { message: err?.toString?.() || 'Invalid JSON' }; }
}
const base = () => window.location.origin + '/api';

// Health/config/version/status
export async function getHealth(){ return jsonOrMessage(await fetch(base()+"/health", { credentials:'include' })); }
export async function getStatus(){ return jsonOrMessage(await fetch(base()+"/status", { credentials:'include' })); }
export async function getVersion(){ return jsonOrMessage(await fetch(base()+"/version", { credentials:'include' })); }
export async function getPublicConfig(){ return jsonOrMessage(await fetch(base()+"/config/public", { credentials:'include' })); }

// Core-service unified services status
export async function getServices(){ return jsonOrMessage(await fetch(base()+"/services", { credentials:'include' })); }
export async function getMetrics(){
  try{
    return await jsonOrMessage(await fetch(base()+"/metrics", { credentials:'include' }));
  }catch{
    return {} as any;
  }
}
export async function getServiceLogs(unit: string, lines: number = 200){
  const url = base()+`/logs?unit=${encodeURIComponent(unit)}&lines=${encodeURIComponent(lines)}`;
  return jsonOrMessage(await fetch(url, { credentials:'include' }));
}
export async function startService(unit: string){
  const url = base()+`/services/${encodeURIComponent(unit)}/start`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function stopService(unit: string){
  const url = base()+`/services/${encodeURIComponent(unit)}/stop`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function restartService(unit: string){
  const url = base()+`/services/${encodeURIComponent(unit)}/restart`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

// Devices registry
export async function getDevices(){ return jsonOrMessage(await fetch(base()+"/devices", { credentials:'include' })); }
export async function getDevice(id: string){ return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(id)}`, { credentials:'include' })); }
export async function getDeviceEvents(id: string){ return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(id)}/events`, { credentials:'include' })); }
export async function createDevice(body: any){
  const res = await fetch(base()+"/devices", { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body||{}) });
  return jsonOrMessage(res);
}
export async function createProvisionToken(id: string, hours?: number){
  const res = await fetch(base()+`/devices/${encodeURIComponent(id)}/provision-token`+ (hours?`?hours=${encodeURIComponent(hours)}`:''), { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include' });
  return jsonOrMessage(res);
}
