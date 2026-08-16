/**
 * Shared device display-name precedence: a device's role (persistent,
 * admin-assigned - survives reprovisioning and hardware swaps) if it has
 * one, else its raw MQTT name (rotates on every reprovision), else a
 * fallback derived from its uuid.
 */
export function displayNameFor(device: { role?: string|null, name?: string|null, uuid: string }): string {
  return device.role || device.name || `EDGB-${device.uuid.substring(0, 4).toUpperCase()}`;
}
