import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const SERVICE = 'core-service';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT: number = Number(process.env.PORT || (NODE_ENV === 'production' ? 3000 : 8080));

export const ADMIN_USER: string = process.env.ADMIN_USER || 'admin';
export const ADMIN_PASSWORD: string = process.env.ADMIN_PASSWORD || 'admin'; // change in prod

export const SESSION_COOKIE = 'fh_session';
export const JWT_SECRET: string = process.env.JWT_SECRET || 'dev-change-me';
export const JWT_TTL_SECONDS: number = Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 24);

export const CERTS_DIR: string = process.env.CERTS_DIR || path.resolve(process.cwd(), 'data', 'certs');
export const ROOT_DIR: string = path.join(CERTS_DIR, 'root');
export const PROV_DIR: string = path.join(CERTS_DIR, 'provisioning');
export const CA_KEY: string = path.join(ROOT_DIR, 'ca.key');
export const CA_CRT: string = path.join(ROOT_DIR, 'ca.crt');

// Resolve UI_DIST to the freshly built UI bundled alongside the service by default.
// Works in both repo (core-service/dist relative to ../../ui/build) and combined artifact staging.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CANDIDATE_UI_DIST = path.resolve(__dirname, '../../ui/build');
export const UI_DIST: string = process.env.UI_DIST || (fs.existsSync(CANDIDATE_UI_DIST) ? CANDIDATE_UI_DIST : '/opt/Edgeberry/devicehub/ui/build');
// Main SQLite database for Device Hub (consolidates registry and whitelist)
export const DEVICEHUB_DB: string = process.env.DEVICEHUB_DB || (
  NODE_ENV === 'production'
    ? '/var/lib/edgeberry/devicehub/devicehub.db'
    : path.resolve(process.cwd(), 'data', 'devicehub.db')
);

// Where the live Certificate Revocation List is published. Distinct from
// CERTS_DIR (the CA's own key/cert - read-only inputs for signing): this is an
// *output* the broker needs to pick up, so in production it points at the
// persistent dir that scripts/sync-certs.sh (triggered by the
// edgeberry-cert-sync.path unit watching this directory) already mirrors into
// /etc/mosquitto/certs and reloads Mosquitto for - the same pipeline
// ca.crt/server.crt/server.key already ride.
export const PERSISTENT_CERTS_DIR: string = process.env.PERSISTENT_CERTS_DIR || (
  NODE_ENV === 'production' ? '/var/lib/edgeberry/devicehub/certs' : CERTS_DIR
);
export const CRL_PATH: string = path.join(PERSISTENT_CERTS_DIR, 'crl.pem');
// Deliberately NOT in PERSISTENT_CERTS_DIR: that directory is watched by
// edgeberry-cert-sync.path, and writing crlnumber there as a separate step
// from crl.pem would let the watcher fire on the *first* file write and race
// sync-certs.sh against the second - CRL_PATH is written via a same-directory
// temp-file + atomic rename specifically so it is the only visible change.
export const CRL_NUMBER_PATH: string = path.join(CERTS_DIR, 'crlnumber');

// Legacy environment variables for backward compatibility
export const REGISTRY_DB: string = process.env.REGISTRY_DB || DEVICEHUB_DB;
export const PROVISIONING_DB: string = process.env.PROVISIONING_DB || DEVICEHUB_DB;
// Consider a device online if we've seen an event within this window (seconds)
export const ONLINE_THRESHOLD_SECONDS: number = Number(process.env.ONLINE_THRESHOLD_SECONDS || 15);

export const DEFAULT_LOG_UNITS: string[] = [
  'devicehub-core.service',
  'devicehub-provisioning.service',
  'devicehub-twin.service',
  'devicehub-application.service',
  // Infra dependencies
  'dbus.service',
  'mosquitto.service',
];

// Provisioning HTTP cert API (migrated to core-service)
// Allow overriding provisioning cert/key paths via env for compatibility
export const PROVISIONING_CERT_PATH: string = process.env.PROVISIONING_CERT_PATH || path.join(CERTS_DIR, 'provisioning.crt');
export const PROVISIONING_KEY_PATH: string = process.env.PROVISIONING_KEY_PATH || path.join(CERTS_DIR, 'provisioning.key');
// MVP: Always enable serving provisioning cert/key over HTTP
export const PROVISIONING_HTTP_ENABLE_CERT_API: boolean = true;

// MQTT configuration for telemetry capture
export const MQTT_URL: string = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
export const MQTT_USERNAME: string | undefined = process.env.MQTT_USERNAME;
export const MQTT_PASSWORD: string | undefined = process.env.MQTT_PASSWORD;
export const MQTT_TLS_CA: string | undefined = process.env.MQTT_TLS_CA;
export const MQTT_TLS_CERT: string | undefined = process.env.MQTT_TLS_CERT;
export const MQTT_TLS_KEY: string | undefined = process.env.MQTT_TLS_KEY;
export const MQTT_TLS_REJECT_UNAUTHORIZED: boolean = process.env.MQTT_TLS_REJECT_UNAUTHORIZED !== 'false';

