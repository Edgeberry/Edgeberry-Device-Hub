// translator-service entrypoint
// Subscribes to device telemetry on devices/{uuid}/messages/events/
// Resolves uuid->deviceId via Core D-Bus Devices1 and republishes to devices/{device_id}/messages/events/

/**
 * Translator Service (MVP)
 * ---------------------------------------------
 * Purpose
 * - Translate device telemetry from UUID-based topics to deviceId-based topics.
 *
 * Responsibilities
 * - Subscribe to `devices/{uuid}/messages/events/` topics
 * - Resolve UUID to deviceId via Core's DevicesService D-Bus interface
 * - Republish messages to `devices/{deviceId}/messages/events/` topics
 *
 * Environment & Dependencies
 * - MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD: broker connection (expect mTLS + ACLs in prod)
 * - PROVISIONING_DB: SQLite database for UUID->deviceId resolution
 * - CACHE_REFRESH_MS: TTL for in-memory UUID->deviceId cache
 *
 * Operational Notes
 * - Uses QoS 1 for message handling to reduce loss
 * - Maintains in-memory cache with TTL to reduce D-Bus calls
 * - Drops messages silently if UUID cannot be resolved to deviceId
 *
 * Security Notes
 * - Avoid logging full payloads; device data may contain sensitive material
 * - Ensure broker ACLs restrict devices to their own telemetry topics
 */
import { SERVICE } from './config.js';
import { startRouter } from './router.js';
import { startMqtt } from './mqtt.js';
import { MqttClient } from 'mqtt';

function registerShutdown(mqttClient: MqttClient, stopRefresher: () => void): void {
  const shutdown = (signal: string) => {
    console.log(`[${SERVICE}] received ${signal}, shutting down...`);
    
    try {
      stopRefresher();
    } catch (error) {
      console.warn(`[${SERVICE}] Error stopping refresher:`, error);
    }
    
    try {
      mqttClient.end(true, {}, () => {
        console.log(`[${SERVICE}] MQTT client closed`);
        process.exit(0);
      });
    } catch (error) {
      console.error(`[${SERVICE}] Error during shutdown:`, error);
      process.exit(1);
    }
    
    // Fallback exit if MQTT close hangs
    setTimeout(() => {
      console.warn(`[${SERVICE}] Force exit after timeout`);
      process.exit(0);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  console.log(`[${SERVICE}] starting...`);
  
  // Start UUID->deviceId cache refresher
  const stopRefresher = startRouter();
  
  // Start MQTT client for telemetry translation
  const mqttClient = startMqtt();
  
  // Register graceful shutdown handlers
  registerShutdown(mqttClient, stopRefresher);
  
  console.log(`[${SERVICE}] translator service initialized`);
}

main().catch((e) => {
  console.error(`[${SERVICE}] startup failed:`, e);
  process.exitCode = 1;
});
