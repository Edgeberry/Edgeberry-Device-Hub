export const SERVICE = 'twin-service';
export const MQTT_URL: string = process.env.MQTT_URL || 'mqtts://localhost:8883';
export const MQTT_USERNAME: string | undefined = process.env.MQTT_USERNAME || undefined;
export const MQTT_PASSWORD: string | undefined = process.env.MQTT_PASSWORD || undefined;
export const MQTT_TLS_CA: string | undefined = process.env.MQTT_TLS_CA || undefined; // e.g., ../config/certs/ca.crt
export const MQTT_TLS_CERT: string | undefined = process.env.MQTT_TLS_CERT || undefined; // e.g., ../config/certs/twin.crt
export const MQTT_TLS_KEY: string | undefined = process.env.MQTT_TLS_KEY || undefined; // e.g., ../config/certs/twin.key
export const MQTT_TLS_REJECT_UNAUTHORIZED: boolean = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';
export const DB_PATH: string = process.env.TWIN_DB || 'twin.db';
