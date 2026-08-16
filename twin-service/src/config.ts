export const SERVICE = 'twin-service';
export const MQTT_URL: string = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
export const MQTT_USERNAME: string | undefined = process.env.MQTT_USERNAME || undefined;
export const MQTT_PASSWORD: string | undefined = process.env.MQTT_PASSWORD || undefined;
export const MQTT_TLS_CA: string | undefined = process.env.MQTT_TLS_CA || undefined; // e.g., ../config/certs/ca.crt
export const MQTT_TLS_CERT: string | undefined = process.env.MQTT_TLS_CERT || undefined; // e.g., ../config/certs/twin.crt
export const MQTT_TLS_KEY: string | undefined = process.env.MQTT_TLS_KEY || undefined; // e.g., ../config/certs/twin.key
export const MQTT_TLS_REJECT_UNAUTHORIZED: boolean = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';
// Bare relative default ('twin.db') resolved to whatever the process's cwd
// happened to be - core-service reads device status from this same file via
// a *different*, already-absolute default (/var/lib/edgeberry/devicehub/twin.db),
// so the two silently diverged: every status this service ever recorded was
// going into a database core-service never looked at. Match core-service's
// default here so they agree even if TWIN_DB is never set explicitly.
const NODE_ENV = process.env.NODE_ENV || 'development';
export const DB_PATH: string = process.env.TWIN_DB || (
  NODE_ENV === 'production'
    ? '/var/lib/edgeberry/devicehub/twin.db'
    : 'twin.db'
);
// Main Device Hub database path (consolidated)
export const DEVICEHUB_DB: string = process.env.DEVICEHUB_DB || 'devicehub.db';
// Legacy environment variable for backward compatibility
export const REGISTRY_DB: string = process.env.REGISTRY_DB || DEVICEHUB_DB;
