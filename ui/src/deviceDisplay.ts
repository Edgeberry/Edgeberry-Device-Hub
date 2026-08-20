/**
 * The two things that actually identify a device to a person: its Hardware ID
 * (the uuid - the hardware endpoint, read from the board, permanent) and its
 * Role (the admin-assigned software endpoint - what it's for, survives
 * reprovisioning and hardware swaps). The raw MQTT name is neither of
 * these - it's an internal wire detail (a random string rotated on every
 * reprovision) with nothing meaningful to show a person, so it has no place
 * in either.
 *
 * "Hardware ID", not "Device ID", because the application-facing API already
 * uses `deviceId` for something else entirely - the role, falling back to the
 * MQTT name - so the old label named the uuid after a field that never holds
 * it. It also matches what the device itself calls the value
 * (`edgeberry --hardware-id`, read from /proc/device-tree/hat/uuid).
 */
export function roleLabelFor(device: { role?: string|null }): string {
  return device.role || 'Unassigned';
}
