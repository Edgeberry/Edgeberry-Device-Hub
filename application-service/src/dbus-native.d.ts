declare module 'dbus-native' {
  export interface DBusConnection {
    connection: any;
    message(msg: any): void;
    end(): void;
    on(event: string, callback: Function): void;
  }

  export interface DBusInterface {
    addMethod(name: string, opts: { in: string; out: string }, handler: Function): void;
    addSignal(name: string, opts: { types: string }): void;
    addProperty(name: string, opts: { type: string; getter: Function; setter?: Function }): void;
    update(): void;
  }

  export interface DBusObject {
    createInterface(name: string): DBusInterface;
  }

  export interface DBusService {
    createObject(path: string): DBusObject;
    disconnect(): void;
  }

  export interface MessageBus {
    connection: DBusConnection;
    invoke(msg: any, callback: (err: any, res: any) => void): void;
    getService(name: string): DBusService;
    exportInterface(obj: any, path: string, iface: DBusInterface): void;
  }

  export function systemBus(): MessageBus;
  export function sessionBus(): MessageBus;
  export function createConnection(callback: (conn: DBusConnection) => void): void;
  export function createClient(options: any): any;
}
