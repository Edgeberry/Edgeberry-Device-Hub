declare module 'dbus-native' {
  export interface DBusConnection {
    getService(serviceName: string): DBusService;
    requestName(serviceName: string, flags: number, callback: (err: any, retCode: number) => void): void;
    exportInterface(serviceObject: any, objectPath: string, interfaceDesc: any): void;
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
