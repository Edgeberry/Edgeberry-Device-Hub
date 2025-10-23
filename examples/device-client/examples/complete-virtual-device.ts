/**
 * Complete Virtual Device Implementation
 * 
 * This example demonstrates a complete virtual device that includes all functionality
 * from the original virtual-device project:
 * - Device provisioning with CSR generation
 * - Bootstrap TLS certificate fetching
 * - Runtime certificate management
 * - Device status publishing with Last Will Testament
 * - Comprehensive environment variable configuration
 * - Certificate validation
 * - Graceful lifecycle management
 * - Telemetry simulation
 * - Direct method handling
 * - Twin property management
 */

import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { EdgeberryDeviceHubClient } from '../device-client';

// Environment variables with defaults
const MQTT_URL = process.env.MQTT_URL || 'mqtts://127.0.0.1:8883';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const CERTS_DIR = process.env.CERTS_DIR || './certs';
const MQTT_TLS_CA = process.env.MQTT_TLS_CA || path.join(CERTS_DIR, 'ca.crt');
const MQTT_TLS_CERT = process.env.MQTT_TLS_CERT || path.join(CERTS_DIR, 'provisioning.crt');
const MQTT_TLS_KEY = process.env.MQTT_TLS_KEY || path.join(CERTS_DIR, 'provisioning.key');
const MQTT_TLS_REJECT_UNAUTHORIZED = (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? 'true') !== 'false';
const DEVICE_ID = process.env.DEVICE_ID || `vd-${Math.random().toString(36).slice(2, 8)}`;
const TELEMETRY_PERIOD_MS = Number(process.env.TELEMETRY_PERIOD_MS || 10000);
const PROV_UUID = process.env.PROV_UUID || process.env.UUID;
const PROV_API_BASE = process.env.PROV_API_BASE || '';
const PROV_API_HEADERS = process.env.PROV_API_HEADERS || '';
const PROV_API_COOKIE = process.env.PROV_API_COOKIE || '';
const ALLOW_SELF_SIGNED = ((process.env.ALLOW_SELF_SIGNED ?? (PROV_API_BASE ? 'true' : 'false')) as string).toLowerCase() === 'true';
const DEVICE_CERT_OUT = process.env.DEVICE_CERT_OUT || '';
const DEVICE_KEY_OUT = process.env.DEVICE_KEY_OUT || '';

// Utility functions
function connackReasonText(code: number): string {
  const v5: Record<number, string> = {
    0: 'Success',
    128: 'Unspecified error',
    129: 'Malformed Packet',
    130: 'Protocol Error',
    131: 'Implementation specific error',
    132: 'Unsupported Protocol Version',
    133: 'Client Identifier not valid',
    134: 'Bad User Name or Password',
    135: 'Not authorized',
    136: 'Server unavailable',
    137: 'Server busy',
    138: 'Banned',
    140: 'Bad authentication method',
    149: 'Packet too large',
    151: 'Quota exceeded',
    153: 'Payload format invalid',
    156: 'Use another server',
    157: 'Server moved',
    159: 'Connection rate exceeded',
  };
  const v3: Record<number, string> = {
    0: 'Connection Accepted',
    1: 'Unacceptable protocol version',
    2: 'Identifier rejected',
    3: 'Server unavailable',
    4: 'Bad user name or password',
    5: 'Not authorized',
  };
  return v5[code] || v3[code] || `Unknown (${code})`;
}

function openssl(args: string[], input?: string): { code: number, out: string, err: string } {
  const res = spawnSync('openssl', args, { input, encoding: 'utf8' });
  return { code: res.status ?? 1, out: res.stdout || '', err: res.stderr || '' };
}

function genKeyAndCsr(deviceId: string): { keyPem: string; csrPem: string } {
  const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-vd-'));
  const keyPath = path.join(tmp, `${deviceId}.key`);
  const csrPath = path.join(tmp, `${deviceId}.csr`);
  let r = openssl(['genrsa', '-out', keyPath, '2048']);
  if (r.code !== 0) throw new Error(`openssl genrsa failed: ${r.err || r.out}`);
  r = openssl(['req', '-new', '-key', keyPath, '-subj', `/CN=${deviceId}`, '-out', csrPath]);
  if (r.code !== 0) throw new Error(`openssl req -new failed: ${r.err || r.out}`);
  const keyPem = readFileSync(keyPath, 'utf8');
  const csrPem = readFileSync(csrPath, 'utf8');
  return { keyPem, csrPem };
}

async function fetchProvisioningFile(base: string, filename: 'ca.crt' | 'provisioning.crt' | 'provisioning.key'): Promise<string> {
  const primary = `${base.replace(/\/$/, '')}/api/provisioning/certs/${filename}`;
  const fallback = `${base.replace(/\/$/, '')}/provisioning/certs/${filename}`;
  try {
    const r = await fetch(primary, { credentials: 'include' as RequestCredentials });
    if (r.ok) return await r.text();
    if (r.status === 401) {
      const r2 = await fetch(fallback);
      if (r2.ok) return await r2.text();
      throw new Error(`HTTP ${r2.status} for ${fallback}`);
    }
    throw new Error(`HTTP ${r.status} for ${primary}`);
  } catch (e) {
    try {
      const r2 = await fetch(fallback);
      if (r2.ok) return await r2.text();
      throw new Error(`HTTP ${r2.status} for ${fallback}`);
    } catch (e2) {
      throw e2;
    }
  }
}

async function loadBootstrapTls(): Promise<{ ca?: Buffer; cert?: Buffer; key?: Buffer }> {
  if (!PROV_API_BASE) {
    // Load from local files if no API base provided
    const ca = existsSync(MQTT_TLS_CA) ? readFileSync(MQTT_TLS_CA) : undefined;
    const cert = existsSync(MQTT_TLS_CERT) ? readFileSync(MQTT_TLS_CERT) : undefined;
    const key = existsSync(MQTT_TLS_KEY) ? readFileSync(MQTT_TLS_KEY) : undefined;
    return { ca, cert, key };
  }

  // Build headers from env
  let hdrs: Record<string, string> = {};
  if (PROV_API_HEADERS) {
    try { hdrs = { ...hdrs, ...JSON.parse(PROV_API_HEADERS) }; } catch {}
  }
  if (PROV_API_COOKIE) hdrs['Cookie'] = PROV_API_COOKIE;

  // Fetch bootstrap provisioning certs
  const caTxt = await fetchProvisioningFile(PROV_API_BASE, 'ca.crt');
  const certTxt = await fetchProvisioningFile(PROV_API_BASE, 'provisioning.crt');
  const keyTxt = await fetchProvisioningFile(PROV_API_BASE, 'provisioning.key');

  // Basic validation to avoid HTML fallback or proxy pages
  const isPem = (s: string) => /-----BEGIN [A-Z ]+-----/.test(s);
  if (!isPem(caTxt)) throw new Error('Invalid CA file received (not PEM)');
  if (!isPem(certTxt)) throw new Error('Invalid provisioning.crt received (not PEM)');
  if (!isPem(keyTxt)) throw new Error('Invalid provisioning.key received (not PEM)');

  return { ca: Buffer.from(caTxt), cert: Buffer.from(certTxt), key: Buffer.from(keyTxt) };
}

class CompleteVirtualDevice {
  private client: MqttClient | null = null;
  private runtimeClient: MqttClient | null = null;
  private provisioned = false;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private runtimeDeviceId: string;
  private deviceKeyPath?: string;

  constructor() {
    this.runtimeDeviceId = String(PROV_UUID || DEVICE_ID);
  }

  async start(): Promise<void> {
    console.log('[virtual-device] Starting complete virtual device...');
    
    const fetched = await loadBootstrapTls();
    
    // Validate we have the necessary certificates
    if (!fetched.ca || !fetched.cert || !fetched.key) {
      console.error('[virtual-device] ERROR: TLS materials missing. Set PROV_API_BASE or ensure cert files exist.');
      process.exit(1);
    }

    // Validate cert/key pair if fetched from API
    if (PROV_API_BASE) {
      try {
        const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-vd-pair-'));
        const cPath = path.join(tmp, 'api.crt');
        const kPath = path.join(tmp, 'api.key');
        writeFileSync(cPath, fetched.cert);
        writeFileSync(kPath, fetched.key);
        const modC = openssl(['x509', '-noout', '-modulus', '-in', cPath]);
        const modK = openssl(['rsa', '-noout', '-modulus', '-in', kPath]);
        if (modC.code !== 0 || modK.code !== 0 || modC.out.trim() !== modK.out.trim()) {
          console.error('[virtual-device] ERROR: fetched provisioning cert/key do not match');
          process.exit(1);
        }
      } catch (e) {
        console.error('[virtual-device] ERROR: failed to validate provisioning cert/key pair', (e as Error)?.message || e);
        process.exit(1);
      }
    }

    console.log('[virtual-device] TLS source:', PROV_API_BASE ? 'api' : 'local files');

    await this.startProvisioning(fetched.ca, fetched.cert, fetched.key);
  }

  private async startProvisioning(ca: Buffer, cert: Buffer, key: Buffer): Promise<void> {
    if (!PROV_UUID) {
      console.error('[virtual-device] ERROR: PROV_UUID is required for provisioning');
      process.exit(1);
    }

    const insecure = ALLOW_SELF_SIGNED || !ca;
    const buildOpts = (insecureFlag: boolean): IClientOptions => ({
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      protocolVersion: 5,
      reconnectPeriod: 2000,
      clean: true,
      clientId: String(PROV_UUID),
      ca: insecureFlag ? undefined : ca,
      cert,
      key,
      rejectUnauthorized: insecureFlag ? false : MQTT_TLS_REJECT_UNAUTHORIZED,
    });

    this.client = connect(MQTT_URL, buildOpts(insecure));

    // Provisioning topics
    const provReqTopic = `$devicehub/devices/${PROV_UUID}/provision/request`;
    const provAccTopic = `$devicehub/devices/${PROV_UUID}/provision/accepted`;
    const provRejTopic = `$devicehub/devices/${PROV_UUID}/provision/rejected`;

    this.client.on('connect', () => {
      console.log(`[virtual-device] CONNECT accepted → ${MQTT_URL} clientId=${this.client?.options.clientId}`);
      
      // Subscribe to provisioning responses
      this.client?.subscribe([provAccTopic, provRejTopic], { qos: 1 }, (err) => {
        if (err) {
          console.error('[virtual-device] subscribe error', err);
          return;
        }

        // Generate device key + CSR
        let keyPem: string, csrPem: string;
        try {
          ({ keyPem, csrPem } = genKeyAndCsr(String(PROV_UUID)));
        } catch (e: any) {
          console.error('[virtual-device] CSR generation failed', e?.message || e);
          return;
        }

        // Save device key for runtime use
        const keyPath = DEVICE_KEY_OUT || path.join(tmpdir(), `${String(PROV_UUID)}.key`);
        writeFileSync(keyPath, keyPem);
        console.log(`[virtual-device] saved device key to ${keyPath}`);
        this.deviceKeyPath = keyPath;

        const provisionPayload: any = {
          csrPem,
          name: `Virtual Device ${this.runtimeDeviceId}`,
          token: process.env.DEVICE_TOKEN || undefined,
          meta: { 
            model: 'simulator', 
            firmware: '1.0.0', 
            startedAt: new Date().toISOString(),
            telemetryInterval: TELEMETRY_PERIOD_MS
          },
        };
        if (PROV_UUID) provisionPayload.uuid = PROV_UUID;

        console.log(`[virtual-device] -> ${provReqTopic} payload: csrPem(len=${csrPem.length}) uuid=${PROV_UUID ? 'set' : 'unset'}`);
        this.client?.publish(provReqTopic, JSON.stringify(provisionPayload), { qos: 1 });
      });
    });

    this.client.on('message', (topic, payload) => {
      if (topic === provAccTopic) {
        this.handleProvisioningAccepted(payload);
      } else if (topic === provRejTopic) {
        console.error(`[virtual-device] <- rejected: ${payload.toString()}`);
      }
    });

    this.client.on('error', (err: any) => {
      console.error('[virtual-device] CONNECT rejected/error', err?.message || err);
    });

    this.client.on('close', () => {
      console.log('[virtual-device] provisioning connection closed');
    });

    // Inspect CONNACK
    this.client.on('packetreceive', (packet: any) => {
      if (packet && packet.cmd === 'connack') {
        const reason = typeof packet.reasonCode !== 'undefined' ? packet.reasonCode : packet.returnCode;
        const sp = packet.sessionPresent;
        if (reason === 0) {
          console.log(`[virtual-device] CONNACK accepted (reasonCode=0 ${connackReasonText(0)}, sessionPresent=${sp})`);
        } else {
          console.error(`[virtual-device] CONNACK rejected (reasonCode=${reason} ${connackReasonText(reason)}, sessionPresent=${sp})`);
        }
      }
    });
  }

  private handleProvisioningAccepted(payload: Buffer): void {
    const msg = JSON.parse(payload.toString() || '{}');
    console.log(`[virtual-device] <- accepted: keys(certPem:${msg.certPem ? 'yes' : 'no'} caChainPem:${msg.caChainPem ? 'yes' : 'no'})`);
    
    if (this.provisioned) return;
    if (!msg.certPem) {
      console.error('[virtual-device] missing certPem in accepted payload');
      return;
    }

    this.provisioned = true;

    // Update runtime device id from server response
    if (msg.deviceId && typeof msg.deviceId === 'string') {
      this.runtimeDeviceId = String(msg.deviceId);
    }

    // Persist cert
    const certPath = DEVICE_CERT_OUT || path.join(tmpdir(), `${this.runtimeDeviceId}.crt`);
    writeFileSync(certPath, msg.certPem);

    // Save CA chain
    let caPath: string | undefined;
    if (msg.caChainPem) {
      caPath = path.join(tmpdir(), `${this.runtimeDeviceId}-ca.crt`);
      writeFileSync(caPath, msg.caChainPem);
      console.log(`[virtual-device] saved CA chain to ${caPath}`);
    }

    // End bootstrap session and start runtime
    try { this.client?.end(true); } catch {}
    this.startRuntime(this.runtimeDeviceId, certPath, this.deviceKeyPath, caPath);
  }

  private startRuntime(deviceId: string, deviceCertPath?: string, deviceKeyPath?: string, caPath?: string): void {
    console.log(`[virtual-device] Starting runtime session for device: ${deviceId}`);

    const ca = caPath ? readFileSync(caPath) : (MQTT_TLS_CA && existsSync(MQTT_TLS_CA) ? readFileSync(MQTT_TLS_CA) : undefined);
    const cert = deviceCertPath ? readFileSync(deviceCertPath) : (MQTT_TLS_CERT ? readFileSync(MQTT_TLS_CERT) : undefined);
    const key = deviceKeyPath ? readFileSync(deviceKeyPath) : (MQTT_TLS_KEY ? readFileSync(MQTT_TLS_KEY) : undefined);

    const opts: IClientOptions = {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      protocolVersion: 5,
      reconnectPeriod: 3000,
      clean: true,
      clientId: deviceId,
      ca,
      cert,
      key,
      rejectUnauthorized: MQTT_TLS_REJECT_UNAUTHORIZED,
      will: {
        topic: `$devicehub/devices/${deviceId}/status`,
        payload: JSON.stringify({ status: 'offline', ts: Date.now() }),
        qos: 1,
        retain: true
      }
    };

    this.runtimeClient = connect(MQTT_URL, opts);

    this.runtimeClient.on('connect', () => {
      console.log(`[virtual-device] runtime CONNACK accepted with device cert → ${MQTT_URL}`);

      // Publish online status
      const onlinePayload = { status: 'online', ts: Date.now() };
      this.runtimeClient?.publish(`$devicehub/devices/${deviceId}/status`, JSON.stringify(onlinePayload), { qos: 1, retain: true });
      console.log(`[virtual-device] -> $devicehub/devices/${deviceId}/status`, onlinePayload);

      // Subscribe to direct methods (using application-service topic pattern)
      this.runtimeClient?.subscribe(`$devicehub/devices/${deviceId}/methods/+/request`, { qos: 0 }, (err) => {
        if (err) {
          console.error('[virtual-device] Failed to subscribe to direct methods:', err);
        } else {
          console.log('[virtual-device] Subscribed to direct methods');
        }
      });

      // Subscribe to twin updates
      this.runtimeClient?.subscribe([
        `$devicehub/devices/${deviceId}/twin/update/accepted`,
        `$devicehub/devices/${deviceId}/twin/update/rejected`,
        `$devicehub/devices/${deviceId}/twin/update/delta`
      ], { qos: 1 }, (err) => {
        if (err) {
          console.error('[virtual-device] Failed to subscribe to twin updates:', err);
        } else {
          console.log('[virtual-device] Subscribed to twin updates');
        }
      });

      // Start telemetry
      this.startTelemetry(deviceId);
    });

    this.runtimeClient.on('message', (topic, payload) => {
      this.handleRuntimeMessage(deviceId, topic, payload);
    });

    this.runtimeClient.on('error', (e) => {
      console.error('[virtual-device] runtime error', e);
    });

    // Inspect runtime CONNACK
    this.runtimeClient.on('packetreceive', (packet: any) => {
      if (packet && packet.cmd === 'connack') {
        const reason = typeof packet.reasonCode !== 'undefined' ? packet.reasonCode : packet.returnCode;
        const sp = packet.sessionPresent;
        if (reason === 0) {
          console.log(`[virtual-device] runtime CONNACK accepted (reasonCode=0 ${connackReasonText(0)}, sessionPresent=${sp})`);
        } else {
          console.error(`[virtual-device] runtime CONNACK rejected (reasonCode=${reason} ${connackReasonText(reason)}, sessionPresent=${sp})`);
        }
      }
    });

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('[virtual-device] shutting down...');
      if (this.telemetryTimer) {
        clearInterval(this.telemetryTimer);
        this.telemetryTimer = null;
      }
      
      // Publish offline status before disconnecting
      const offlinePayload = { status: 'offline', ts: Date.now() };
      this.runtimeClient?.publish(`$devicehub/devices/${deviceId}/status`, JSON.stringify(offlinePayload), { qos: 1, retain: true }, () => {
        this.runtimeClient?.end();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  private handleRuntimeMessage(deviceId: string, topic: string, payload: Buffer): void {
    try {
      const message = JSON.parse(payload.toString());
      
      // Check if it's a method request (matches pattern: $devicehub/devices/{deviceId}/methods/{methodName}/request)
      const methodRequestPattern = new RegExp(`^\$devicehub\/devices\/${deviceId}\/methods\/([^/]+)\/request$`);
      const methodMatch = topic.match(methodRequestPattern);
      
      if (methodMatch) {
        const methodName = methodMatch[1];
        this.handleDirectMethod(deviceId, methodName, message);
      } else if (topic.includes('/twin/update/')) {
        this.handleTwinUpdate(deviceId, topic, message);
      }
    } catch (error) {
      console.error('[virtual-device] Error parsing runtime message:', error);
    }
  }

  private handleDirectMethod(deviceId: string, methodName: string, payload: any): void {
    console.log('[virtual-device] Received direct method:', methodName, payload);
    
    const { requestId } = payload;
    let response: any = { status: 200, payload: {} };

    // Handle common direct methods
    switch (methodName) {
      case 'identify':
        console.log('[virtual-device] IDENTIFY method called - device is identifying!');
        response.payload = { message: 'Device identified successfully', duration: payload.payload?.duration || 5 };
        break;
        
      case 'reboot':
        console.log('[virtual-device] REBOOT method called - simulating reboot...');
        response.payload = { message: 'Reboot initiated', delay: payload.payload?.delay || 0 };
        break;
        
      case 'diagnostics':
        response.payload = {
          message: 'Diagnostics completed',
          results: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version,
            deviceId: deviceId,
            telemetryInterval: TELEMETRY_PERIOD_MS
          }
        };
        break;
        
      case 'updateFirmware':
        console.log('[virtual-device] FIRMWARE UPDATE method called - simulating update...');
        response.payload = { 
          message: 'Firmware update initiated', 
          version: payload.payload?.version || '1.0.1',
          progress: 0
        };
        break;
        
      default:
        response = { status: 404, message: `Method '${methodName}' not implemented` };
    }

    // Send response (using application-service topic pattern)
    const responseTopic = `$devicehub/devices/${deviceId}/methods/${methodName}/response`;
    const responsePayload = {
      requestId,
      status: response.status,
      payload: response.payload,
      message: response.message
    };
    this.runtimeClient?.publish(responseTopic, JSON.stringify(responsePayload), { qos: 0 });
    console.log('[virtual-device] Sent direct method response to:', responseTopic, responsePayload);
  }

  private handleTwinUpdate(deviceId: string, topic: string, payload: any): void {
    console.log('[virtual-device] Twin update:', { topic, payload });
    
    if (topic.includes('/delta')) {
      // Handle desired property changes
      console.log('[virtual-device] Received twin delta (desired properties changed):', payload);
      
      // Simulate processing desired properties and updating reported properties
      const reported: any = {};
      if (payload.telemetryInterval) {
        reported.telemetryInterval = payload.telemetryInterval;
        console.log(`[virtual-device] Updated telemetry interval to ${payload.telemetryInterval}ms`);
      }
      
      // Update reported properties
      if (Object.keys(reported).length > 0) {
        const twinMessage = { reported };
        this.runtimeClient?.publish(`$devicehub/devices/${deviceId}/twin/update`, JSON.stringify(twinMessage), { qos: 1 });
        console.log('[virtual-device] Updated twin reported properties:', twinMessage);
      }
    }
  }

  private startTelemetry(deviceId: string): void {
    console.log(`[virtual-device] Starting telemetry with interval ${TELEMETRY_PERIOD_MS}ms`);
    
    let sequenceNumber = 0;
    
    const sendTelemetry = () => {
      const telemetryData = {
        deviceId: deviceId,
        timestamp: new Date().toISOString(),
        sequenceNumber: ++sequenceNumber,
        temperature: 20 + Math.random() * 10, // 20-30°C
        humidity: 40 + Math.random() * 20,    // 40-60%
        pressure: 1000 + Math.random() * 50,  // 1000-1050 hPa
        batteryLevel: Math.max(0, 100 - (sequenceNumber * 0.1)), // Slowly decreasing
        signalStrength: -50 - Math.random() * 30, // -50 to -80 dBm
        cpuUsage: Math.random() * 100,
        memoryUsage: 30 + Math.random() * 40,
        uptime: process.uptime()
      };

      this.runtimeClient?.publish(`$devicehub/devices/${deviceId}/telemetry`, JSON.stringify(telemetryData));
      console.log(`[virtual-device] -> telemetry seq=${sequenceNumber} temp=${telemetryData.temperature.toFixed(1)}°C`);
    };

    // Send initial telemetry
    sendTelemetry();
    
    // Set up periodic telemetry
    this.telemetryTimer = setInterval(sendTelemetry, TELEMETRY_PERIOD_MS);
  }
}

// Main execution
async function main() {
  console.log('[virtual-device] Complete Virtual Device starting...');
  console.log('[virtual-device] Configuration:');
  console.log(`  MQTT_URL: ${MQTT_URL}`);
  console.log(`  DEVICE_ID: ${DEVICE_ID}`);
  console.log(`  PROV_UUID: ${PROV_UUID}`);
  console.log(`  TELEMETRY_PERIOD_MS: ${TELEMETRY_PERIOD_MS}`);
  console.log(`  PROV_API_BASE: ${PROV_API_BASE || 'not set (using local files)'}`);
  console.log(`  ALLOW_SELF_SIGNED: ${ALLOW_SELF_SIGNED}`);

  const device = new CompleteVirtualDevice();
  
  try {
    await device.start();
  } catch (error) {
    console.error('[virtual-device] Failed to start:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[virtual-device] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the device
main().catch((error) => {
  console.error('[virtual-device] Fatal error:', error);
  process.exit(1);
});
