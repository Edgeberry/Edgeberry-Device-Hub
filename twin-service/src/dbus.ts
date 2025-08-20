import * as dbus from 'dbus-next';
import { getTwin, setDoc } from './db.js';
import type { Json } from './types.js';
import fs from 'node:fs';

const BUS_NAME = 'io.edgeberry.devicehub.Twin';
const OBJECT_PATH = '/io/edgeberry/devicehub/Twin';
const IFACE_NAME = 'io.edgeberry.devicehub.Twin1';

// We avoid the high-level Interface API and use the low-level message handler API
// to register D-Bus methods without decorators or subclassing.

export async function startTwinDbusServer(db: any): Promise<void> {
  const bus = dbus.systemBus();
  try { await bus.requestName(BUS_NAME, 0); } catch {}
  registerTwinHandlers(bus, db);
  let version = 'unknown';
  try {
    const pkgJsonPath = new URL('../package.json', import.meta.url);
    const pkgRaw = fs.readFileSync(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    version = pkg.version ?? version;
  } catch {}
  console.log(`[twin-service] v${version} D-Bus ${IFACE_NAME} listening at ${OBJECT_PATH}`);
}

function registerTwinHandlers(bus: dbus.MessageBus, db: any) {
  const { Message } = dbus;

  // Utility to match our interface path/members
  function isTarget(msg: any, member: string): boolean {
    return (
      msg.path === OBJECT_PATH &&
      msg.interface === IFACE_NAME &&
      msg.member === member
    );
  }

  bus.addMethodHandler((msg: any) => {
    // Introspection support so clients can build proxies
    if (
      msg.path === OBJECT_PATH &&
      msg.interface === 'org.freedesktop.DBus.Introspectable' &&
      msg.member === 'Introspect'
    ) {
      const xml = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="${IFACE_NAME}">
    <method name="GetTwin">
      <arg name="deviceId" type="s" direction="in"/>
      <arg name="desiredJson" type="s" direction="out"/>
      <arg name="desiredVersion" type="u" direction="out"/>
      <arg name="reportedJson" type="s" direction="out"/>
      <arg name="error" type="s" direction="out"/>
    </method>
    <method name="SetDesired">
      <arg name="deviceId" type="s" direction="in"/>
      <arg name="patchJson" type="s" direction="in"/>
      <arg name="version" type="u" direction="out"/>
    </method>
    <method name="SetReported">
      <arg name="deviceId" type="s" direction="in"/>
      <arg name="patchJson" type="s" direction="in"/>
      <arg name="version" type="u" direction="out"/>
    </method>
    <method name="ListDevices">
      <arg name="devices" type="as" direction="out"/>
    </method>
  </interface>
</node>`;
      const reply = Message.newMethodReturn(msg, 's', [xml]);
      bus.send(reply);
      return true;
    }
    // GetTwin(s) -> (s,u,s,s)
    if (isTarget(msg, 'GetTwin')) {
      try {
        const [deviceId] = msg.body as [string];
        const twin = getTwin(db, deviceId);
        const desired = JSON.stringify(twin.desired.doc as Json);
        const reported = JSON.stringify(twin.reported.doc as Json);
        const reply = Message.newMethodReturn(msg, 'suss', [
          desired,
          twin.desired.version >>> 0,
          reported,
          ''
        ]);
        bus.send(reply);
      } catch (e: any) {
        const reply = Message.newMethodReturn(msg, 'suss', ['', 0, '', String(e?.message || 'error')]);
        bus.send(reply);
      }
      return true;
    }

    // SetDesired(ss) -> (u)
    if (isTarget(msg, 'SetDesired')) {
      try {
        const [deviceId, patchJson] = msg.body as [string, string];
        const patch = patchJson ? (JSON.parse(patchJson) as Json) : {};
        const { version } = setDoc(db, 'twin_desired', deviceId, patch);
        const reply = Message.newMethodReturn(msg, 'u', [version >>> 0]);
        bus.send(reply);
      } catch {
        const reply = Message.newMethodReturn(msg, 'u', [0]);
        bus.send(reply);
      }
      return true;
    }

    // SetReported(ss) -> (u)
    if (isTarget(msg, 'SetReported')) {
      try {
        const [deviceId, patchJson] = msg.body as [string, string];
        const patch = patchJson ? (JSON.parse(patchJson) as Json) : {};
        const { version } = setDoc(db, 'twin_reported', deviceId, patch);
        const reply = Message.newMethodReturn(msg, 'u', [version >>> 0]);
        bus.send(reply);
      } catch {
        const reply = Message.newMethodReturn(msg, 'u', [0]);
        bus.send(reply);
      }
      return true;
    }

    // ListDevices() -> (as)
    if (isTarget(msg, 'ListDevices')) {
      try {
        const rows = db
          .prepare('SELECT device_id FROM twin_desired UNION SELECT device_id FROM twin_reported')
          .all() as { device_id: string }[];
        const reply = Message.newMethodReturn(msg, 'as', [rows.map((r) => r.device_id)]);
        bus.send(reply);
      } catch {
        const reply = Message.newMethodReturn(msg, 'as', [[] as string[]]);
        bus.send(reply);
      }
      return true;
    }

    // not our method
    return false;
  });
}

