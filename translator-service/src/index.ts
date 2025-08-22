// translator-service entrypoint
// Subscribes to device telemetry on devices/{uuid}/messages/events/
// Resolves uuid->deviceId via Core D-Bus Devices1 and republishes to devices/{device_id}/messages/events/

import { SERVICE } from './config.js';
import { startRouter } from './router.js';
import { startMqtt } from './mqtt.js';

console.log(`[${SERVICE}] starting`);

const stopRefresher = startRouter();
const mqtt = startMqtt();

function shutdown(signal: string){
  console.log(`[${SERVICE}] received ${signal}, shutting down...`);
  try{ stopRefresher(); }catch{}
  try{ mqtt.end(true, {}, () => process.exit(0)); }catch{ process.exit(0); }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
