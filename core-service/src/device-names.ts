// Device name validation and generation utilities

/**
 * Device naming conventions:
 * - Default format: EDGB-<first 4 UUID chars>
 * - Allowed characters: alphanumeric, hyphens, underscores
 * - Length: 4-32 characters
 * - Must start with alphanumeric character
 * - Case insensitive but preserved
 */

const FORBIDDEN_CHARS_REGEX = /[^a-zA-Z0-9\-_]/;
const VALID_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-_]{3,31}$/;

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
