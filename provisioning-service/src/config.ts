// Service configuration and typed environment access
export const SERVICE = 'provisioning-service';

export const MQTT_URL: string = process.env.MQTT_URL || 'mqtts://localhost:8883';
export const MQTT_USERNAME: string | undefined = process.env.MQTT_USERNAME || undefined;
export const MQTT_PASSWORD: string | undefined = process.env.MQTT_PASSWORD || undefined;
// Optional TLS files; if set, clients will pass these to MQTT
export const MQTT_TLS_CA: string | undefined = process.env.MQTT_TLS_CA || undefined; // e.g., ../config/certs/ca.crt
export const MQTT_TLS_CERT: string | undefined = process.env.MQTT_TLS_CERT || undefined; // e.g., ../config/certs/provisioning.crt
export const MQTT_TLS_KEY: string | undefined = process.env.MQTT_TLS_KEY || undefined; // e.g., ../config/certs/provisioning.key
export const MQTT_TLS_REJECT_UNAUTHORIZED: boolean = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';
export const DB_PATH: string = process.env.PROVISIONING_DB || 'provisioning.db';
// If true, incoming provision requests must include a UUID that exists in uuid_whitelist, matches device_id, and not yet used
export const ENFORCE_WHITELIST: boolean = (process.env.ENFORCE_WHITELIST || 'false').toLowerCase() === 'true';
