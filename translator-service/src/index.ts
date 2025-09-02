// translator-service entrypoint
// Subscribes to device telemetry on devices/{uuid}/messages/events/
// Resolves uuid->deviceName via Core D-Bus DevicesService and republishes to $devicehub/devicedata/{device_name}/

/**
 * Translator Service (MVP)
 * ---------------------------------------------
 * Purpose
 * - Translate device telemetry from UUID-based topics to device name-based topics.
 *
 * Responsibilities
 * - Subscribe to `devices/{uuid}/messages/events/` topics
 * - Resolve UUID to device name via Core's DevicesService D-Bus interface
 * - Republish messages to `$devicehub/devicedata/{device_name}/` topics
 * - Monitor device registry changes for name/UUID updates
 *
 * Environment & Dependencies
 * - MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD: broker connection (expect mTLS + ACLs in prod)
 * - DEVICEHUB_DB: SQLite database for UUID->device name resolution via D-Bus
 * - CACHE_REFRESH_MS: TTL for in-memory UUID->device name cache
 *
 * Operational Notes
 * - Uses QoS 1 for message handling to reduce loss
 * - Maintains in-memory cache with TTL to reduce D-Bus calls
 * - Drops messages silently if UUID cannot be resolved to device name
 * - Invalidates cache when device names or UUIDs change
 *
 * Security Notes
 * - Avoid logging full payloads; device data may contain sensitive material
 * - Ensure broker ACLs restrict devices to their own telemetry topics
 */
import { SERVICE } from './config.js';
import { startRouter } from './router.js';
import { startMqtt } from './mqtt.js';
import { startDeviceMonitor } from './monitor.js';
import { MqttClient } from 'mqtt';

function registerShutdown(mqttClient: MqttClient, stopRefresher: () => void, stopMonitor: () => void): void {
  const shutdown = (signal: string) => {
    console.log(`[${SERVICE}] received ${signal}, shutting down...`);
    
    try {
      stopMonitor();
    } catch (error) {
      console.warn(`[${SERVICE}] Error stopping device monitor:`, error);
    }
    
    try {
      stopRefresher();
    } catch (error) {
      console.warn(`[${SERVICE}] Error stopping refresher:`, error);
    }
    
    try {
      mqttClient.end();
    } catch (error) {
      console.warn(`[${SERVICE}] Error closing MQTT client:`, error);
    }
    
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  console.log(`[${SERVICE}] starting...`);
  
  const stopRefresher = startRouter();
  const stopMonitor = startDeviceMonitor();
  const mqttClient = startMqtt();
  
  registerShutdown(mqttClient, stopRefresher, stopMonitor);
  
  console.log(`[${SERVICE}] translator service initialized`);
}

main().catch((e) => {
  console.error(`[${SERVICE}] startup failed:`, e);
  process.exitCode = 1;
});
