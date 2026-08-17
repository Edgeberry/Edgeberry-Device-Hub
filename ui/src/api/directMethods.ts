/**
 * Direct methods that actually round-trip to a device over MQTT (via
 * core-service's sendDirectMethod). Everything else that used to live here
 * (reboot, shutdown, application restart/stop, connection/provisioning
 * get/update-params, reconnect, reprovision) only ever hit canned-response
 * stubs in core-service that never touched a real device - removed together
 * with those stub routes rather than left as dead-looking-real UI.
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
