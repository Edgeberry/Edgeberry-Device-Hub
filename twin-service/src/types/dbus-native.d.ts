declare module 'dbus-native' {
  export interface DBusConnection {
    getService(serviceName: string): DBusService;
    systemBus(): DBusConnection;
    sessionBus(): DBusConnection;
  }

  export interface DBusService {
    createObject(objectPath: string): DBusObject;
    getInterface(objectPath: string, interfaceName: string): DBusInterface;
  }

  export interface DBusObject {
    createInterface(interfaceName: string): DBusInterface;
  }

  export interface DBusInterface {
    addMethod(methodName: string, signature: MethodSignature, handler: MethodHandler): void;
    [methodName: string]: any;
  }

  export interface MethodSignature {
    in: string[];
    out: string[];
  }

  export type MethodHandler = (...args: any[]) => void;

  export function systemBus(): DBusConnection;
  export function sessionBus(): DBusConnection;
  export function createClient(options?: any): DBusConnection;
}
