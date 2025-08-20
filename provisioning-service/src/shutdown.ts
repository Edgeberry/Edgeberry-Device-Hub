import type { MqttClient } from 'mqtt';
import { SERVICE } from './config.js';

export function registerShutdown(client: MqttClient){
  const shutdown = () => {
    console.log(`[${SERVICE}] shutting down...`);
    try { client.end(true); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
