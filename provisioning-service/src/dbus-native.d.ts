// Type definitions for dbus-native interfaces
declare module 'dbus-native' {
  export interface DBusConnection {
    on(event: string, handler: Function): void;
    message(msg: any): void;
    removeListener(event: string, handler: Function): void;
    getService(serviceName: string): DBusService;
  }

  export interface DBusService {
    getInterface(path: string, name: string, callback: (err: any, iface: any) => void): void;
  }

  export const messageType: {
    methodCall: number;
    methodReturn: number;
    error: number;
    signal: number;
  };

  export function systemBus(): DBusConnection;
  export function createConnection(options?: any): DBusConnection;
}
