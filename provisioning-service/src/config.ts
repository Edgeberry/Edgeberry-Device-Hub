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
// Root CA used to sign device certificates from CSRs (override via env in production)
export const CA_CRT_PATH: string = process.env.CA_CRT_PATH || 'config/certs/ca.crt';
export const CA_KEY_PATH: string = process.env.CA_KEY_PATH || 'config/certs/ca.key';
export const CERT_DAYS: number = Number(process.env.CERT_DAYS || '825');
// Persist provisioning database under system data dir in production by default
// Fresh installs MUST NOT seed the whitelist; file will be created on first run if absent
const NODE_ENV = process.env.NODE_ENV || 'development';
export const DB_PATH: string = process.env.PROVISIONING_DB || (
  NODE_ENV === 'production'
    ? '/var/lib/edgeberry/devicehub/provisioning.db'
    // Align with core-service default dev path: core-service/data/provisioning.db
    : new URL('../../core-service/data/provisioning.db', import.meta.url).pathname
);
// If true, incoming provision requests must include a UUID that exists in uuid_whitelist, matches device_id, and not yet used
export const ENFORCE_WHITELIST: boolean = (process.env.ENFORCE_WHITELIST || 'false').toLowerCase() === 'true';

