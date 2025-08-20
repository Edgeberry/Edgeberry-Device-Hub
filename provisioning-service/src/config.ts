// Service configuration and typed environment access
export const SERVICE = 'provisioning-service';

export const MQTT_URL: string = process.env.MQTT_URL || 'mqtts://127.0.0.1:8883';
export const MQTT_USERNAME: string | undefined = process.env.MQTT_USERNAME || undefined;
export const MQTT_PASSWORD: string | undefined = process.env.MQTT_PASSWORD || undefined;
// Optional TLS files; if set, clients will pass these to MQTT
// Default to repo-level config/certs paths resolved relative to this file
export const MQTT_TLS_CA: string | undefined = process.env.MQTT_TLS_CA || new URL('../../config/certs/ca.crt', import.meta.url).pathname;
export const MQTT_TLS_CERT: string | undefined = process.env.MQTT_TLS_CERT || new URL('../../config/certs/provisioning.crt', import.meta.url).pathname;
export const MQTT_TLS_KEY: string | undefined = process.env.MQTT_TLS_KEY || new URL('../../config/certs/provisioning.key', import.meta.url).pathname;
export const MQTT_TLS_REJECT_UNAUTHORIZED: boolean = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';
// Root CA used to sign device certificates from CSRs (override via env in production)
// Default to repo-level config/certs paths resolved relative to this file
export const CA_CRT_PATH: string = process.env.CA_CRT_PATH || new URL('../../config/certs/ca.crt', import.meta.url).pathname;
export const CA_KEY_PATH: string = process.env.CA_KEY_PATH || new URL('../../config/certs/ca.key', import.meta.url).pathname;
export const CERT_DAYS: number = Number(process.env.CERT_DAYS || '825');
// Persist provisioning database under system data dir in production by default
// Fresh installs MUST NOT seed the whitelist; file will be created on first run if absent
const NODE_ENV = process.env.NODE_ENV || 'development';
export const DB_PATH: string = process.env.PROVISIONING_DB || (
  NODE_ENV === 'production'
    ? '/var/lib/edgeberry/devicehub/provisioning.db'
    : new URL('../../provisioning.db', import.meta.url).pathname
);

// Lightweight HTTP server configuration
export const HTTP_PORT: number = Number(process.env.HTTP_PORT || 8081);
// Explicit flag to allow serving provisioning cert/key over HTTP (development only)
export const HTTP_ENABLE_CERT_API: boolean = (process.env.HTTP_ENABLE_CERT_API || '').toLowerCase() === 'true';

// If true, incoming provision requests must include a UUID that exists in uuid_whitelist, matches device_id, and not yet used
export const ENFORCE_WHITELIST: boolean = (process.env.ENFORCE_WHITELIST || 'false').toLowerCase() === 'true';
