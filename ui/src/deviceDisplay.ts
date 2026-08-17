/**
 * The two things that actually identify a device to a person: its Device ID
 * (the uuid - the hardware endpoint, read from the board, permanent) and its
 * Role (the admin-assigned software endpoint - what it's for, survives
 * reprovisioning and hardware swaps). The raw MQTT name is neither of
 * these - it's an internal wire detail (a random string rotated on every
 * reprovision) with nothing meaningful to show a person, so it has no place
 * in either.
 */
export function roleLabelFor(device: { role?: string|null }): string {
  return device.role || 'Unassigned';
}
