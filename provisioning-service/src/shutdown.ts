import type { MqttClient } from 'mqtt';
import { SERVICE } from './config.js';

export function registerShutdown(db: any, client: MqttClient){
  const shutdown = () => {
    console.log(`[${SERVICE}] shutting down...`);
    try { client.end(true); } catch {}
    try { (db as any).close?.(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
