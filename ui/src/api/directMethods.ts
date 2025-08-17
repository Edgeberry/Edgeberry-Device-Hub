/**
 * Frontend direct methods API for Device Hub
 *
 * For now, these hit core-service REST stubs which can later be wired to MQTT/cloud.
 */

async function jsonOrMessage(res: Response){
  try{ return await res.json(); }catch(err:any){ return { message: err?.toString?.() || 'Invalid JSON' }; }
}
const base = () => window.location.origin + '/api';

export async function direct_identifySystem(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/identify`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

export async function direct_restartSystem(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/reboot`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

export async function direct_shutdownSystem(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/shutdown`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

// Application
export async function direct_restartApplication(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/application/restart`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function direct_stopApplication(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/application/stop`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function direct_getApplicationInfo(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/application/info`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function direct_updateSystemApplication(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/application/update`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

// System info/network
export async function direct_getSystemApplicationInfo(deviceId: string){
  // Map to system/info stub for now
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/system/info`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function direct_getSystemNetworkInfo(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/system/network`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

// Connection
export async function direct_getConnectionParameters(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/connection/get-params`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function direct_updateConnectionParameters(deviceId: string, parameters: any){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/connection/update-params`;
  const res = await fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters }) });
  return jsonOrMessage(res);
}
export async function direct_reconnect(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/connection/reconnect`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}

// Provisioning
export async function direct_getProvisioningParameters(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/provisioning/get-params`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
export async function direct_updateProvisioningParameters(deviceId: string, parameters: any){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/provisioning/update-params`;
  const res = await fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters }) });
  return jsonOrMessage(res);
}
export async function direct_reprovision(deviceId: string){
  const url = base()+`/devices/${encodeURIComponent(deviceId)}/actions/provisioning/reprovision`;
  const res = await fetch(url, { method:'POST', credentials:'include' });
  return jsonOrMessage(res);
}
