declare module 'dbus-native' {
  export interface DBusConnection {
    requestName(name: string, flags: number, callback?: (err: any, retCode: number) => void): void;
    exportInterface(serviceObject: any, objectPath: string, descriptor: InterfaceDescriptor): any;
    getService(serviceName: string): DBusService;
    getObject(serviceName: string, objectPath: string, callback: (err: any, obj: any) => void): void;
    getInterface(serviceName: string, objectPath: string, interfaceName: string, callback: (err: any, iface: any) => void): void;
  }

  export interface InterfaceDescriptor {
    name: string;
    methods: { [methodName: string]: [string, string] };
    signals?: { [signalName: string]: [string, string[]] };
    properties?: { [propName: string]: [string, string] };
  }

  export interface DBusService {
    createObject(objectPath: string): DBusObject;
    getInterface(objectPath: string, interfaceName: string, callback: (err: any, iface: DBusInterface) => void): void;
  }

  export interface DBusObject {
    createInterface(interfaceName: string): DBusInterface;
  }

  export interface DBusInterface {
    addMethod(methodName: string, opts: { inSignature: string; outSignature: string }, handler: (...args: any[]) => any): void;
    [methodName: string]: any;
  }

  export function systemBus(): DBusConnection;
  export function sessionBus(): DBusConnection;

  export const messageType: {
    methodCall: number;
    methodReturn: number;
    error: number;
    signal: number;
  };

  export type MethodHandler = (...args: any[]) => void;

  export function createClient(options?: any): DBusConnection;
}
