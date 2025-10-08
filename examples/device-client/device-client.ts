import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { EventEmitter } from 'events';

// Utility functions for provisioning
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
  const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-device-'));
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

/**
 * Connection parameters for Device Hub client
 */
export interface HubConnectionParameters {
  hostName: string;                 // MQTT broker host
  deviceId: string;                 // Unique device ID
  authenticationType: string;       // X.509 authentication
  certificate: string;              // X.509 client certificate (PEM)
  privateKey: string;               // X.509 private key (PEM)
  rootCertificate?: string;         // Optional root CA (PEM)
}

/**
 * Provisioning parameters for Device Hub client
 */
export interface HubProvisioningParameters {
  hostName: string;                 // MQTT broker host for provisioning
  clientId: string;                 // Client ID for provisioning (UUID)
  authenticationType: string;       // X.509 authentication
  certificate: string;              // Provisioning certificate (PEM)
  privateKey: string;               // Provisioning private key (PEM)
  rootCertificate?: string;         // Optional root CA (PEM)
  apiBaseUrl?: string;              // API base URL for fetching certificates
  apiHeaders?: Record<string, string>; // Optional API headers
  deviceToken?: string;             // Optional device token
  allowSelfSigned?: boolean;        // Allow self-signed certificates
}

/**
 * Client status information
 */
export interface HubClientStatus {
  connecting?: boolean;
  connected?: boolean;
  provisioning?: boolean;
  provisioned?: boolean;
}

/**
 * Message structure for sending data
 */
export interface Message {
  data: string;
  properties?: MessageProperty[];
}

/**
 * Message property key-value pair
 */
export interface MessageProperty {
  key: string;
  value: string;
}

/**
 * Direct method registration
 */
export interface DirectMethod {
  name: string;
  function: Function;
}

/**
 * Direct method response handler
 */
export class DirectMethodResponse {
  private statuscode: number = 200;
  private callback: Function | null = null;
  private requestId: string = '';

  constructor(requestId: string, callback: Function) {
    this.callback = callback;
    this.requestId = requestId;
  }

  public send(payload: any): void {
    if (typeof this.callback === 'function') {
      if (this.statuscode === 200) {
        this.callback({ status: this.statuscode, payload: payload, requestId: this.requestId });
      } else {
        this.callback({ status: this.statuscode, message: payload.message, requestId: this.requestId });
      }
    }
  }

  public status(status: number): DirectMethodResponse {
    this.statuscode = status;
    return this;
  }
}

/**
 * Client options for EdgeberryDeviceHubClient
 */
export interface EdgeberryClientOptions {
  deviceId: string;
  host?: string;
  port?: number;
  
  // Certificate options (for mTLS)
  ca?: Buffer | string;
  cert?: Buffer | string;
  key?: Buffer | string;
  
  // Certificate file paths
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  
  // Provisioning options
  provisioningUuid?: string;
  provisioningApiBase?: string;
  provisioningApiHeaders?: Record<string, string>;
  provisioningApiCookie?: string;
  deviceToken?: string;
  allowSelfSigned?: boolean;
  
  // Output paths for generated certificates
  deviceCertOut?: string;
  deviceKeyOut?: string;
  
  // Connection options
  keepalive?: number;
  connectTimeout?: number;
  reconnectPeriod?: number;
  rejectUnauthorized?: boolean;
  telemetryInterval?: number;
}

/**
 * Telemetry data structure
 */
export interface TelemetryData {
  [key: string]: any;
  timestamp?: string;
  deviceId?: string;
}

/**
 * Event data structure
 */
export interface EventData {
  [key: string]: any;
  timestamp?: string;
  deviceId?: string;
}

/**
 * Twin properties structure
 */
export interface TwinProperties {
  [key: string]: any;
}

/**
 * Direct method call structure
 */
export interface DirectMethodCall {
  methodName: string;
  requestId: string;
  payload: any;
  respond: (response: { status: number; payload?: any }) => void;
}

/**
 * Edgeberry Device Hub Client
 * 
 * A TypeScript client for connecting to and interacting with the Edgeberry Device Hub.
 * Always uses mTLS on port 8883 for secure communication.
 */
export class EdgeberryDeviceHubClient extends EventEmitter {
  private options: EdgeberryClientOptions;
  private client: MqttClient | null = null;
  private connected: boolean = false;
  private deviceId: string;
  private provisioningUuid?: string;
  private topics: Record<string, string>;
  private reconnectAttempts: number = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private telemetryInterval: NodeJS.Timeout | null = null;
  private directMethods: DirectMethod[] = [];
  private provisioned: boolean = false;
  private runtimeClient: MqttClient | null = null;

  constructor(options: EdgeberryClientOptions) {
    super();
    
    this.options = {
      // Default to mTLS on port 8883
      host: options.host || '127.0.0.1',
      port: 8883, // Always use 8883 for mTLS
      
      // Connection options
      keepalive: options.keepalive || 240,
      connectTimeout: options.connectTimeout || 30000,
      reconnectPeriod: options.reconnectPeriod || 2000,
      rejectUnauthorized: options.rejectUnauthorized !== false,
      
      ...options
    };
    
    this.deviceId = this.options.deviceId;
    
    // Topic patterns following Device Hub conventions
    this.topics = {
      telemetry: `devices/${this.deviceId}/telemetry`,
      events: `$devicehub/devices/${this.deviceId}/messages/events`,
      directMethods: `$devicehub/devices/${this.deviceId}/methods/post`,
      directMethodsResponse: `edgeberry/things/${this.deviceId}/methods/response`,
      twin: `$devicehub/devices/${this.deviceId}/twin`,
      twinGet: `$devicehub/devices/${this.deviceId}/twin/get`,
      twinUpdate: `$devicehub/devices/${this.deviceId}/twin/update`,
      twinUpdateAccepted: `$devicehub/devices/${this.deviceId}/twin/update/accepted`,
      twinUpdateRejected: `$devicehub/devices/${this.deviceId}/twin/update/rejected`,
      twinUpdateDelta: `$devicehub/devices/${this.deviceId}/twin/update/delta`,
      heartbeat: `$devicehub/devices/${this.deviceId}/heartbeat`
    };
  }

  /**
   * Load certificates from file paths
   */
  private loadCertificates(): { ca?: Buffer; cert?: Buffer; key?: Buffer } {
    const certs: { ca?: Buffer; cert?: Buffer; key?: Buffer } = {};

    // Load from buffers/strings first
    if (this.options.ca) {
      certs.ca = Buffer.isBuffer(this.options.ca) ? this.options.ca : Buffer.from(this.options.ca);
    }
    if (this.options.cert) {
      certs.cert = Buffer.isBuffer(this.options.cert) ? this.options.cert : Buffer.from(this.options.cert);
    }
    if (this.options.key) {
      certs.key = Buffer.isBuffer(this.options.key) ? this.options.key : Buffer.from(this.options.key);
    }

    // Load from file paths if not already loaded
    if (!certs.ca && this.options.caPath) {
      certs.ca = readFileSync(this.options.caPath);
    }
    if (!certs.cert && this.options.certPath) {
      certs.cert = readFileSync(this.options.certPath);
    }
    if (!certs.key && this.options.keyPath) {
      certs.key = readFileSync(this.options.keyPath);
    }

    return certs;
  }

  /**
   * Connect to the Device Hub using mTLS
   */
  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const certs = this.loadCertificates();
        
        // Validate required certificates for mTLS
        if (!certs.cert || !certs.key) {
          throw new Error('mTLS requires both client certificate and private key');
        }

        const mqttOptions: IClientOptions = {
          host: this.options.host,
          port: this.options.port,
          protocol: 'mqtts', // Always use secure MQTT
          keepalive: this.options.keepalive,
          connectTimeout: this.options.connectTimeout,
          reconnectPeriod: this.options.reconnectPeriod,
          clean: false, // Persistent session
          clientId: this.deviceId,
          
          // mTLS configuration
          ca: certs.ca,
          cert: certs.cert,
          key: certs.key,
          rejectUnauthorized: this.options.rejectUnauthorized
        };

        this.client = connect(mqttOptions);

        this.client.on('connect', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log(`Connected to Device Hub as ${this.deviceId}`);
          
          this.setupSubscriptions();
          this.startHeartbeat();
          
          this.emit('connected');
          resolve();
        });

        this.client.on('error', (error) => {
          console.error('MQTT connection error:', error);
          this.emit('error', error);
          if (!this.connected) {
            reject(error);
          } else {
            this.scheduleReconnect();
          }
        });

        this.client.on('close', () => {
          this.connected = false;
          console.log('Disconnected from Device Hub');
          this.stopHeartbeat();
          this.emit('disconnected');
          this.scheduleReconnect();
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Set up MQTT subscriptions
   */
  private setupSubscriptions(): void {
    if (!this.client) return;

    // Subscribe to direct methods
    this.client.subscribe(this.topics.directMethods, { qos: 0 }, (err) => {
      if (err) {
        console.error('Failed to subscribe to direct methods:', err);
      } else {
        console.log('Subscribed to direct methods');
      }
    });

    // Subscribe to twin updates
    this.client.subscribe([
      this.topics.twinUpdateAccepted,
      this.topics.twinUpdateRejected,
      this.topics.twinUpdateDelta
    ], { qos: 1 }, (err) => {
      if (err) {
        console.error('Failed to subscribe to twin updates:', err);
      } else {
        console.log('Subscribed to twin updates');
      }
    });
  }

  /**
   * Handle incoming MQTT messages
   */
  private handleMessage(topic: string, message: Buffer): void {
    try {
      const payload = JSON.parse(message.toString());
      
      if (topic === this.topics.directMethods) {
        this.handleDirectMethod(payload);
      } else if (topic === this.topics.twinUpdateAccepted || topic === this.topics.twinUpdateRejected) {
        this.handleTwinUpdateResponse(topic, payload);
      } else if (topic === this.topics.twinUpdateDelta) {
        this.handleTwinDelta(payload);
      }
      
      this.emit('message', { topic, payload });
    } catch (error) {
      console.error('Error parsing message:', error);
      this.emit('message', { topic, payload: message.toString() });
    }
  }

  /**
   * Handle direct method calls
   */
  private handleDirectMethod(payload: any): void {
    console.log('Received direct method:', payload);
    
    const { name: methodName, requestId } = payload;
    
    // Find registered method
    const directMethod = this.directMethods.find(m => m.name === methodName);
    
    if (!directMethod) {
      // Method not found
      this.respondToDirectMethod(requestId, { status: 404, message: 'Method not found' });
      return;
    }

    // Create response handler
    const respond = (response: { status: number; payload?: any }) => {
      this.respondToDirectMethod(requestId, response);
    };

    // Emit event for application to handle
    this.emit('directMethod', {
      methodName,
      requestId,
      payload: payload.payload || {},
      respond
    });

    // Also call registered method if available
    try {
      directMethod.function(payload, new DirectMethodResponse(requestId, (response: any) => {
        this.respondToDirectMethod(requestId, response);
      }));
    } catch (error) {
      console.error('Error executing direct method:', error);
      this.respondToDirectMethod(requestId, { status: 500, message: 'Internal error' });
    }
  }

  /**
   * Respond to a direct method call
   */
  private respondToDirectMethod(requestId: string, response: any): void {
    if (!this.client) return;

    const responseTopic = `${this.topics.directMethodsResponse}/${requestId}`;
    this.client.publish(responseTopic, JSON.stringify(response), { qos: 0, retain: true });
    console.log('Sent direct method response:', response);
  }

  /**
   * Handle twin update responses
   */
  private handleTwinUpdateResponse(topic: string, payload: any): void {
    console.log('Twin update response:', { topic, payload });
    this.emit('twin', { topic, body: payload });
  }

  /**
   * Handle twin delta (desired property changes)
   */
  private handleTwinDelta(payload: any): void {
    console.log('Received twin delta:', payload);
    this.emit('twinDesired', payload);
    this.emit('twin-delta', { topic: this.topics.twinUpdateDelta, body: payload });
  }

  /**
   * Send telemetry data
   */
  public sendTelemetry(data: TelemetryData): void {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to Device Hub');
    }

    const telemetryMessage = {
      deviceId: this.deviceId,
      timestamp: new Date().toISOString(),
      ...data
    };

    this.client.publish(this.topics.telemetry, JSON.stringify(telemetryMessage));
    console.log('Sent telemetry:', telemetryMessage);
  }

  /**
   * Send an event
   */
  public sendEvent(eventType: string, data: EventData): void {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to Device Hub');
    }

    const eventMessage = {
      data: JSON.stringify({
        eventType,
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        ...data
      })
    };

    this.client.publish(this.topics.events, JSON.stringify(eventMessage), { qos: 1 });
    console.log('Sent event:', eventMessage);
  }

  /**
   * Send a generic message (for compatibility)
   */
  public sendMessage(message: Message): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('No connection'));
      }

      const msg: any = { data: message.data };
      if (message.properties && message.properties.length > 0) {
        message.properties.forEach((p) => (msg[p.key] = p.value));
      }

      this.client.publish(this.topics.events, JSON.stringify(msg), { qos: 1 }, (err) => {
        err ? reject(err) : resolve(true);
      });
    });
  }

  /**
   * Update reported twin properties
   */
  public updateTwinReported(properties: TwinProperties): void {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to Device Hub');
    }

    const twinMessage = {
      reported: properties
    };

    this.client.publish(this.topics.twinUpdate, JSON.stringify(twinMessage), { qos: 1 });
    console.log('Updated twin reported properties:', twinMessage);
  }

  /**
   * Update device state (alias for updateTwinReported for single key-value)
   */
  public updateState(key: string, value: string | number | boolean | object): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('No connection'));
      }

      const reported: any = {};
      reported[key] = value;
      const body = { reported };

      this.client.publish(this.topics.twinUpdate, JSON.stringify(body), { qos: 1 }, (err) => {
        err ? reject(err) : resolve(true);
      });
    });
  }

  /**
   * Get current twin state
   */
  public getTwin(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('No connection'));
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Twin get request timeout'));
      }, 10000);

      const onMessage = (topic: string, payload: Buffer) => {
        if (topic !== this.topics.twinUpdateAccepted) return;
        try {
          const body = JSON.parse(payload.toString('utf8'));
          cleanup();
          resolve(body);
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      const cleanup = () => {
        if (!this.client) return;
        clearTimeout(timeout);
        this.client.removeListener('message', onMessage);
      };

      this.client.on('message', onMessage);
      this.client.publish(this.topics.twinGet, '', { qos: 1 }, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Register a direct method handler
   */
  public registerDirectMethod(name: string, method: Function): void {
    this.directMethods.push({ name, function: method });
  }

  /**
   * Send heartbeat to maintain device online status
   */
  public sendHeartbeat(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('No connection'));
      }

      this.client.publish(
        this.topics.heartbeat,
        JSON.stringify({ timestamp: Date.now() }),
        { qos: 0 },
        (err) => (err ? reject(err) : resolve(true))
      );
    });
  }

  /**
   * Start automatic heartbeat
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat().catch(() => {
        // Heartbeat failed, but don't emit error as it's not critical
      });
    }, 30000); // Send heartbeat every 30 seconds
  }

  /**
   * Stop automatic heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.connected) return; // Don't reconnect if already connected

    const maxDelayMs = 30000;
    const baseDelayMs = 1000;
    const jitterMs = 250;
    const attempt = Math.min(this.reconnectAttempts + 1, 10);
    const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * jitterMs);
    
    this.reconnectAttempts = attempt;
    
    setTimeout(() => {
      this.connect().catch(() => {
        // Swallow error; next disconnect/error schedules again
      });
    }, delay);
  }

  /**
   * Publish to an arbitrary MQTT topic
   */
  public publish(topic: string, payload: any, qos: 0 | 1 | 2 = 1, retain: boolean = false): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('No client'));
      }

      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.client.publish(topic, body, { qos, retain }, (err) => {
        err ? reject(err) : resolve(true);
      });
    });
  }

  /**
   * Get client connection status
   */
  public getClientStatus(): HubClientStatus {
    return {
      connected: this.connected,
      connecting: false, // Could be enhanced to track connecting state
      provisioning: false,
      provisioned: true // Assume provisioned if we have certificates
    };
  }

  /**
   * Disconnect from the Device Hub
   */
  public async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      this.stopHeartbeat();
      
      if (this.client) {
        this.client.end(() => {
          this.client = null;
          this.connected = false;
          console.log('Disconnected from Device Hub');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Create a client with mTLS authentication from file paths
   */
  public static createSecureClient(options: EdgeberryClientOptions): EdgeberryDeviceHubClient {
    return new EdgeberryDeviceHubClient({
      ...options,
      port: 8883 // Always use 8883 for mTLS
    });
  }
}

export default EdgeberryDeviceHubClient;
