// Device registry monitoring for translator service
// Monitors device name and UUID changes via D-Bus signals or periodic polling

import { invalidateCache } from './router.js';
import { SERVICE, CACHE_REFRESH_MS } from './config.js';
import { dbusResolveDeviceNameByUuid } from './dbus.js';

interface DeviceRecord {
  uuid: string;
  name: string;
  lastChecked: number;
}

// Track known devices to detect changes
const knownDevices = new Map<string, DeviceRecord>();
const POLL_INTERVAL_MS = Math.max(30_000, CACHE_REFRESH_MS * 2); // Poll every 30s or 2x cache refresh

/**
 * Monitor device registry for changes in device names or UUIDs
 * Uses periodic polling since D-Bus signals for device changes aren't implemented yet
 */
export function startDeviceMonitor(): () => void {
  console.log(`[${SERVICE}] Starting device registry monitor (polling every ${POLL_INTERVAL_MS}ms)`);
  
  const timer = setInterval(async () => {
    await checkForDeviceChanges();
  }, POLL_INTERVAL_MS);
  
  // Initial check
  setTimeout(() => checkForDeviceChanges(), 1000);
  
  return () => {
    clearInterval(timer);
    console.log(`[${SERVICE}] Device registry monitor stopped`);
  };
}

async function checkForDeviceChanges(): Promise<void> {
  try {
    // Get current device list from cache keys and check for changes
    const cachedUuids = Array.from(knownDevices.keys());
    
    for (const uuid of cachedUuids) {
      try {
        const result = await dbusResolveDeviceNameByUuid(uuid);
        const currentName = result.ok ? result.deviceName : null;
        const known = knownDevices.get(uuid);
        
        if (!known) {
          // New device discovered
          if (currentName) {
            knownDevices.set(uuid, {
              uuid,
              name: currentName,
              lastChecked: Date.now()
            });
            console.log(`[${SERVICE}] New device discovered: ${uuid} -> ${currentName}`);
          }
        } else if (currentName && currentName !== known.name) {
          // Device name changed
          console.log(`[${SERVICE}] Device name changed: ${uuid} (${known.name} -> ${currentName})`);
          knownDevices.set(uuid, {
            uuid,
            name: currentName,
            lastChecked: Date.now()
          });
          // Invalidate cache for this UUID so it gets refreshed
          invalidateCache(uuid);
        } else if (!currentName && known) {
          // Device removed or no longer accessible
          console.log(`[${SERVICE}] Device removed or inaccessible: ${uuid} (was ${known.name})`);
          knownDevices.delete(uuid);
          invalidateCache(uuid);
        } else if (known) {
          // No change, just update last checked time
          known.lastChecked = Date.now();
        }
      } catch (error) {
        console.warn(`[${SERVICE}] Error checking device ${uuid}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    // Clean up old entries (devices not seen for a while)
    const now = Date.now();
    const staleThreshold = POLL_INTERVAL_MS * 5; // 5 poll cycles
    
    for (const [uuid, device] of knownDevices.entries()) {
      if (now - device.lastChecked > staleThreshold) {
        console.log(`[${SERVICE}] Removing stale device record: ${uuid} (${device.name})`);
        knownDevices.delete(uuid);
        invalidateCache(uuid);
      }
    }
    
  } catch (error) {
    console.error(`[${SERVICE}] Error in device change monitoring:`, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Register a device UUID for monitoring
 * Called when we first encounter a UUID in telemetry
 */
export function registerDeviceForMonitoring(uuid: string, name: string): void {
  if (!knownDevices.has(uuid)) {
    knownDevices.set(uuid, {
      uuid,
      name,
      lastChecked: Date.now()
    });
    console.log(`[${SERVICE}] Registered device for monitoring: ${uuid} -> ${name}`);
  }
}
