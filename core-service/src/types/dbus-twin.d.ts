declare module './dbus-twin-client.js' {
  export function twinGetTwin(deviceId: string): Promise<[string, number, string, string] | null>;
  export function twinSetDesired(deviceId: string, patchJson: string): Promise<[boolean, number, string] | null>;
  export function twinSetReported(deviceId: string, patchJson: string): Promise<[boolean, number, string] | null>;
  export function twinListDevices(): Promise<string[]>;
}
