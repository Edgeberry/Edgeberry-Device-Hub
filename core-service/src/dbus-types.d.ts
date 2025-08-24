// Type definitions for dbus-next interfaces
declare module 'dbus-next' {
  export interface DBusInterface {
    [key: string]: any;
  }

  export interface MethodOptions {
    inSignature: string;
    outSignature: string;
    handle: (...args: any[]) => any;
  }

  export interface InterfaceConstructor {
    new (name: string): DBusInterface;
  }

  export namespace interface {
    const Interface: InterfaceConstructor;
  }

  export interface ProxyObject {
    getInterface(ifaceName: string): any;
  }

  export interface DBusConnection {
    requestName(name: string, flags: number): Promise<void>;
    export(path: string, iface: DBusInterface): void;
    getProxyObject(name: string, path: string): Promise<ProxyObject>;
  }

  export function systemBus(): DBusConnection;
}

export { DBusInterface } from 'dbus-next';
