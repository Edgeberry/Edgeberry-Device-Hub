import * as dbus from 'dbus-next';
import { 
  twinGetTwin, 
  twinSetDesired, 
  twinSetReported, 
  twinListDevices 
} from './dbus-twin-client.js';
import { 
  TwinResult, 
  TwinUpdateResult, 
  isTwinResult, 
  isTwinUpdateResult,
  getArrayValue
} from './types/dbus-helpers.js';

// Core is the primary D-Bus surface; expose Twin operations on the Core bus name
const BUS_NAME = 'io.edgeberry.devicehub.Core';
const OBJECT_PATH = '/io/edgeberry/devicehub/TwinService';
const IFACE_NAME = 'io.edgeberry.devicehub.TwinService';

class CoreTwinInterface extends (dbus.interface.Interface as any) {
  constructor() {
    super(IFACE_NAME);
    
    // Register methods with the correct signature format
    this.addMethod('GetTwin', { 
      inSignature: 's', 
      outSignature: 'suss',
      handler: this.getTwin.bind(this)
    });
    
    this.addMethod('SetDesired', { 
      inSignature: 'ss', 
      outSignature: 'bus',
      handler: this.setDesired.bind(this)
    });
    
    this.addMethod('SetReported', { 
      inSignature: 'ss', 
      outSignature: 'bus',
      handler: this.setReported.bind(this)
    });
    
    this.addMethod('ListDevices', { 
      inSignature: '', 
      outSignature: 'as',
      handler: this.listDevices.bind(this)
    });
  }

  // Mirror Twin signatures for GetTwin: (desiredJson, desiredVersion, reportedJson, error)
  private async getTwin(deviceId: string): Promise<TwinResult> {
    try {
      const result = await twinGetTwin(deviceId);
      if (!result || !isTwinResult(result)) {
        throw new Error('Invalid result from twinGetTwin');
      }
      
      // Use type-safe array access
      return [
        getArrayValue(result, 0, ''),
        getArrayValue(result, 1, 0),
        getArrayValue(result, 2, ''),
        getArrayValue(result, 3, '')
      ];
    } catch (e: any) {
      return ['', 0, '', e?.message || 'error'];
    }
  }

  // For SetDesired/SetReported, expose (ok, version, error)
  private async setDesired(deviceId: string, patchJson: string): Promise<TwinUpdateResult> {
    try {
      const result = await twinSetDesired(deviceId, patchJson);
      if (!result || !isTwinUpdateResult(result)) {
        throw new Error('Invalid result from twinSetDesired');
      }
      
      // Use type-safe array access
      return [
        getArrayValue(result, 0, false),
        getArrayValue(result, 1, 0),
        getArrayValue(result, 2, '')
      ];
    } catch (e: any) {
      return [false, 0, e?.message || 'error'];
    }
  }

  private async setReported(deviceId: string, patchJson: string): Promise<TwinUpdateResult> {
    try {
      const result = await twinSetReported(deviceId, patchJson);
      if (!result || !isTwinUpdateResult(result)) {
        throw new Error('Invalid result from twinSetReported');
      }
      
      // Use type-safe array access
      return [
        getArrayValue(result, 0, false),
        getArrayValue(result, 1, 0),
        getArrayValue(result, 2, '')
      ];
    } catch (e: any) {
      return [false, 0, e?.message || 'error'];
    }
  }

  private async listDevices(): Promise<string[]> {
    try {
      return await twinListDevices();
    } catch (e) {
      console.error('ListDevices error:', e);
      return [];
    }
  }
}

export async function startCoreTwinDbusServer(): Promise<void> {
  try {
    const bus = dbus.systemBus();
    try { await bus.requestName(BUS_NAME, 0); } catch {}
    const iface = new CoreTwinInterface();
    bus.export(OBJECT_PATH, iface); 
    console.log('[core-service] D-Bus TwinService exported at', OBJECT_PATH);
  } catch (e) {
    console.error('[core-service] failed to start D-Bus TwinService', e);
  }
}
