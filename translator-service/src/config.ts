export const SERVICE = 'translator-service';

// MQTT connection settings (mirrors other services)
export const MQTT_URL: string = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
export const MQTT_USERNAME: string | undefined = process.env.MQTT_USERNAME || undefined;
export const MQTT_PASSWORD: string | undefined = process.env.MQTT_PASSWORD || undefined;
export const MQTT_TLS_CA: string | undefined = process.env.MQTT_TLS_CA || undefined; // e.g., ../config/certs/ca.crt
export const MQTT_TLS_CERT: string | undefined = process.env.MQTT_TLS_CERT || undefined; // e.g., ../config/certs/translator.crt
export const MQTT_TLS_KEY: string | undefined = process.env.MQTT_TLS_KEY || undefined; // e.g., ../config/certs/translator.key
export const MQTT_TLS_REJECT_UNAUTHORIZED: boolean = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';

// Main Device Hub database path (consolidated whitelist and registry)
// Keep defaults consistent with core-service/src/config.ts
const NODE_ENV = process.env.NODE_ENV || 'development';
export const DEVICEHUB_DB: string = process.env.DEVICEHUB_DB || (
  NODE_ENV === 'production'
    ? '/var/lib/edgeberry/devicehub/devicehub.db'
    : new URL('../../core-service/data/devicehub.db', import.meta.url).pathname
);
// Legacy environment variable for backward compatibility
export const PROVISIONING_DB: string = process.env.PROVISIONING_DB || DEVICEHUB_DB;

// Cache refresh interval for uuid->deviceId map
export const CACHE_REFRESH_MS = Number(process.env.CACHE_REFRESH_MS || 30000);
