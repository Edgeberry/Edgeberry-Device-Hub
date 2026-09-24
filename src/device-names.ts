/**
 * Device identity: names, and what they are for.
 *
 * ---------------------------------------------------------------------------
 * A device carries THREE identifiers. They are not interchangeable, and most
 * confusion about this codebase starts with treating them as one thing.
 *
 *   uuid   The physical board, burned into the HAT EEPROM. It is a one-time
 *          CLAIM TOKEN, not an identity: it authenticates the provisioning
 *          handshake and is then deliberately never used on the wire again.
 *          That is the entire reason provisioning is two round trips (see
 *          services/provisioning/). Keys the registry: devicehub.db.
 *
 *   name   The device's ongoing identity on the wire. Assigned by the Hub at
 *          provisioning and never mutated afterwards - it is the MQTT clientId,
 *          the CN of the device's certificate, and the key its twin is stored
 *          under. This file decides what a valid one looks like.
 *
 *   role   The application identity: an admin-chosen label pointing at a uuid
 *          (device_roles). The only one that moves - a hardware swap repoints a
 *          role at a different device, and neither device row is touched. The
 *          application id and its groups follow the role; telemetry and twin
 *          history do not, because they belong to the hardware that produced
 *          them.
 *
 * Because device rows are never mutated or deleted, uuid <-> name is 1:1 and
 * stable for the life of the board. Keying the twin by name therefore still
 * means "keyed by the hardware".
 *
 * ---------------------------------------------------------------------------
 * Which store is keyed by what, and why it is not a mistake:
 *
 *   devicehub.db  registry, certificates, whitelist, roles   keyed by UUID
 *   twin.db       twin documents, connection events          keyed by NAME
 *
 * The twin sub-service reads the device out of the MQTT topic
 * ($devicehub/devices/{name}/twin/update) and has nothing else to go on, so
 * name-keying is what lets it record a twin update without touching the
 * registry at all. Re-keying the twin by uuid would put a registry lookup on
 * every twin message - on the single synchronous thread that also serves HTTP
 * and MQTT. Do not do it.
 *
 * The cost is that any read crossing from one store to the other resolves
 * first (`SELECT name FROM devices WHERE uuid = ?`). That is a join, not a
 * seam: both keys are stable per board.
 *
 * The registry still owns the device's LIFECYCLE even though the twin is
 * stored apart from it - decommissioning deletes the twin documents, the
 * connection events, the role and its groups. See twin-store.ts.
 *
 * ---------------------------------------------------------------------------
 * Device naming conventions:
 * - Default format: EDGB-<first 4 UUID chars>
 * - Allowed characters: alphanumeric, hyphens, underscores
 * - Length: 4-32 characters
 * - Must start with alphanumeric character
 * - Case insensitive but preserved
 */

const FORBIDDEN_CHARS_REGEX = /[^a-zA-Z0-9\-_]/;
const VALID_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-_]{3,31}$/;

/** Prefix for every MQTT connection the Hub opens on its own behalf. Used to
 *  build those clientIds *and* to recognise them again, so the two cannot
 *  drift apart. */
export const INTERNAL_MQTT_CLIENT_PREFIX = 'devicehub-';
/** All clientId prefixes belonging to the Hub rather than to a device: the
 *  core connection, the application sub-service, and mqtt.js's own generated
 *  ids (used by the twin and provisioning sub-services, which do not set one). */
export const INTERNAL_MQTT_CLIENT_PREFIXES = [
  INTERNAL_MQTT_CLIENT_PREFIX,
  'application-service-',
  'mqttjs_',
];

/**
 * Whether an MQTT clientId is a device's ongoing identity - the single place
 * that question is answered, so the twin sub-service (deciding what to record)
 * and twin-store (deciding what to keep) can never disagree about it.
 *
 * Three exclusions, each deliberate:
 *  - a bare hardware UUID is a device's *provisioning* clientId, a one-time
 *    claim token rather than the identity anything else uses;
 *  - the Hub's own backend connections are not devices at all;
 *  - anything that is not a well-formed device name.
 */
export function isDeviceClientId(clientId: string): boolean {
  if (!clientId) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return false;
  const lower = clientId.toLowerCase();
  if (INTERNAL_MQTT_CLIENT_PREFIXES.some(prefix => lower.startsWith(prefix))) return false;
  return VALID_NAME_REGEX.test(clientId);
}

export interface DeviceNameValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Generate default device name from UUID
 * Format: EDGB-<first 4 UUID chars>
 */
export function generateDefaultDeviceName(uuid: string): string {
  if (!uuid || uuid.length < 4) {
    throw new Error('UUID must be at least 4 characters long');
  }
  
  // Take first 4 characters of UUID (excluding hyphens)
  const cleanUuid = uuid.replace(/-/g, '').toUpperCase();
  const prefix = cleanUuid.substring(0, 4);
  
  return `EDGB-${prefix}`;
}

/**
 * Validate device name according to naming conventions
 */
export function validateDeviceName(name: string): DeviceNameValidationResult {
  if (!name) {
    return { valid: false, error: 'Device name cannot be empty' };
  }
  
  if (name.length < 4 || name.length > 32) {
    return { valid: false, error: 'Device name must be between 4 and 32 characters' };
  }
  
  if (!VALID_NAME_REGEX.test(name)) {
    if (FORBIDDEN_CHARS_REGEX.test(name)) {
      return { 
        valid: false, 
        error: 'Device name contains forbidden characters. Only alphanumeric, hyphens, and underscores are allowed',
        sanitized: sanitizeDeviceName(name)
      };
    }
    
    if (!/^[a-zA-Z0-9]/.test(name)) {
      return { 
        valid: false, 
        error: 'Device name must start with an alphanumeric character',
        sanitized: sanitizeDeviceName(name)
      };
    }
  }
  
  return { valid: true };
}

/**
 * Sanitize device name by removing forbidden characters
 */
export function sanitizeDeviceName(name: string): string {
  if (!name) return '';
  
  // Remove forbidden characters
  let sanitized = name.replace(FORBIDDEN_CHARS_REGEX, '');
  
  // Ensure it starts with alphanumeric
  sanitized = sanitized.replace(/^[^a-zA-Z0-9]+/, '');
  
  // Truncate to max length
  if (sanitized.length > 32) {
    sanitized = sanitized.substring(0, 32);
  }
  
  // Ensure minimum length by padding with default if needed
  if (sanitized.length < 4) {
    sanitized = `EDGB-${sanitized}`.substring(0, 32);
  }
  
  return sanitized;
}

/**
 * Check if device name is using the default format
 */
export function isDefaultDeviceName(name: string, uuid: string): boolean {
  const defaultName = generateDefaultDeviceName(uuid);
  return name === defaultName;
}

/**
 * Normalize device name for comparison (case insensitive)
 */
export function normalizeDeviceName(name: string): string {
  return name.toLowerCase();
}
