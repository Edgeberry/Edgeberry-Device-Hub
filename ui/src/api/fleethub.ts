/*
 * Fleet Hub MVP API client
 */

async function jsonOrMessage(res: Response){
  try{
    const data = await res.json();
    return data;
  }catch(err:any){
    return { message: err?.toString?.() || 'Invalid JSON' };
  }
}

const base = () => window.location.origin + '/api';

// Health/config/version/status
export async function getHealth(){
  return jsonOrMessage(await fetch(base()+"/health", { credentials:'include' }));
}
export async function getStatus(){
  return jsonOrMessage(await fetch(base()+"/status", { credentials:'include' }));
}
export async function getVersion(){
  return jsonOrMessage(await fetch(base()+"/version", { credentials:'include' }));
}
export async function getPublicConfig(){
  return jsonOrMessage(await fetch(base()+"/config/public", { credentials:'include' }));
}

// Devices registry
export async function getDevices(){
  return jsonOrMessage(await fetch(base()+"/devices", { credentials:'include' }));
}
export async function getDevice(id: string){
  return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(id)}`, { credentials:'include' }));
}
export async function getDeviceEvents(id: string){
  return jsonOrMessage(await fetch(base()+`/devices/${encodeURIComponent(id)}/events`, { credentials:'include' }));
}

export async function createDevice(body: any){
  const res = await fetch(base()+"/devices", {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    credentials:'include',
    body: JSON.stringify(body||{})
  });
  return jsonOrMessage(res);
}

export async function createProvisionToken(id: string, hours?: number){
  const res = await fetch(base()+`/devices/${encodeURIComponent(id)}/provision-token`+ (hours?`?hours=${encodeURIComponent(hours)}`:''), {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    credentials:'include'
  });
  return jsonOrMessage(res);
}
