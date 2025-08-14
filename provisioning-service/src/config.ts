// Service configuration and typed environment access
export const SERVICE = 'provisioning-service';

export const MQTT_URL: string = process.env.MQTT_URL || 'mqtt://localhost:1883';
export const MQTT_USERNAME: string | undefined = process.env.MQTT_USERNAME || undefined;
export const MQTT_PASSWORD: string | undefined = process.env.MQTT_PASSWORD || undefined;
export const DB_PATH: string = process.env.PROVISIONING_DB || 'provisioning.db';
