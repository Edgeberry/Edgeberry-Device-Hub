import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const SERVICE = 'core-service';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT: number = Number(process.env.PORT || (NODE_ENV === 'production' ? 80 : 8080));

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
// SQLite DBs owned by worker services (MVP direct-read from core-service)
// Persist provisioning DB under system data dir by default so whitelist survives reinstalls
export const PROVISIONING_DB: string = process.env.PROVISIONING_DB || (
  NODE_ENV === 'production'
    ? '/var/lib/edgeberry/devicehub/provisioning.db'
    : path.resolve(process.cwd(), 'data', 'provisioning.db')
);
export const REGISTRY_DB: string = process.env.REGISTRY_DB || (
  NODE_ENV === 'production'
    ? '/var/lib/edgeberry/devicehub/registry.db'
    : path.resolve(process.cwd(), 'data', 'registry.db')
);
// Consider a device online if we've seen an event within this window (seconds)
export const ONLINE_THRESHOLD_SECONDS: number = Number(process.env.ONLINE_THRESHOLD_SECONDS || 15);

export const DEFAULT_LOG_UNITS: string[] = [
  'devicehub-core.service',
  'devicehub-provisioning.service',
  'devicehub-twin.service',
  // Infra dependencies
  'dbus.service',
  'mosquitto.service',
];

// Provisioning HTTP cert API (migrated to core-service)
// Allow overriding provisioning cert/key paths via env for compatibility
export const PROVISIONING_CERT_PATH: string = process.env.PROVISIONING_CERT_PATH || path.join(CERTS_DIR, 'provisioning.crt');
export const PROVISIONING_KEY_PATH: string = process.env.PROVISIONING_KEY_PATH || path.join(CERTS_DIR, 'provisioning.key');
// Explicit flag to allow serving provisioning cert/key over HTTP (development-only)
export const PROVISIONING_HTTP_ENABLE_CERT_API: boolean = (process.env.PROVISIONING_HTTP_ENABLE_CERT_API || '').toLowerCase() === 'true';

