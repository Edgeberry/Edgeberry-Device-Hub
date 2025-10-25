import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'eventemitter3';

/**
 * Application client configuration
 */
export interface AppClientConfig {
  host: string;                       // Device Hub hostname (e.g., 'localhost')
  port: number;                       // Application service port (e.g., 8090)
  token: string;                      // API authentication token
  secure?: boolean;                   // Use HTTPS/WSS (default: false)
  timeout?: number;                   // Request timeout in milliseconds
  retryAttempts?: number;             // Number of retry attempts for failed requests
  enableWebSocket?: boolean;          // Enable WebSocket connection for real-time data
}

/**
 * Device information structure
 */
export interface DeviceInfo {
  deviceId: string;
  name: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeen: string;
  model?: string;
  firmware?: string;
  metadata?: Record<string, any>;
}

/**
 * Device telemetry data
 */
export interface TelemetryData {
  deviceId: string;
  timestamp: string;
  data: Record<string, any>;
}

/**
 * Device event data
 */
export interface DeviceEvent {
  deviceId: string;
  eventType: string;
  timestamp: string;
  data: Record<string, any>;
}

/**
 * Device twin state
 */
export interface DeviceTwin {
  deviceId: string;
  desired: Record<string, any>;
  reported: Record<string, any>;
  lastUpdated: string;
}

/**
 * Device query filters
 */
export interface DeviceQuery {
  status?: 'online' | 'offline';
  model?: string;
  lastSeenAfter?: string;
  lastSeenBefore?: string;
  limit?: number;
  offset?: number;
}

/**
 * Telemetry query filters
 */
export interface TelemetryQuery {
  deviceId?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
  aggregation?: 'none' | 'hourly' | 'daily';
}

/**
 * Direct method call request
 */
export interface DirectMethodRequest {
  deviceId: string;
  methodName: string;
  payload?: any;
  timeout?: number;
}

/**
 * Direct method response
 */
export interface DirectMethodResponse {
  status: number;
  payload?: any;
  message?: string;
  requestId: string;
}

/**
 * WebSocket message types
 */
export interface WebSocketMessage {
  type: 'telemetry' | 'event' | 'device-status' | 'twin-update';
  data: any;
  timestamp: string;
}

/**
 * Edgeberry Device Hub Application Client
 * 
 * A TypeScript client for applications to consume data from the Edgeberry Device Hub.
 * Provides REST API access and real-time WebSocket updates for device data.
 */
export class DeviceHubAppClient extends EventEmitter {
  private config: AppClientConfig;
  private httpClient: AxiosInstance;
  private websocket: WebSocket | null = null;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private baseUrl: string;
  private wsUrl: string;

  constructor(config: AppClientConfig) {
    super();
    
    this.config = {
      secure: false,
      timeout: 30000,
      retryAttempts: 3,
      enableWebSocket: true,
      ...config
    };

    // Build URLs
    const protocol = this.config.secure ? 'https' : 'http';
    const wsProtocol = this.config.secure ? 'wss' : 'ws';
    this.baseUrl = `${protocol}://${this.config.host}:${this.config.port}`;
    this.wsUrl = `${wsProtocol}://${this.config.host}:${this.config.port}/ws?token=${this.config.token}`;

    // Create HTTP client with authentication
    const axiosConfig: AxiosRequestConfig = {
      baseURL: this.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.token}`
      }
    };

    this.httpClient = axios.create(axiosConfig);
    
    // Add response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('HTTP request failed:', error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Initialize the client and establish connections
   */
  async connect(): Promise<void> {
    try {
      // Test HTTP connection
      await this.httpClient.get('/health');
      console.log('Connected to Device Hub API');

      // Establish WebSocket connection if enabled
      if (this.config.enableWebSocket) {
        await this.connectWebSocket();
      }

      this.connected = true;
      this.emit('connected');
    } catch (error) {
      console.error('Failed to connect to Device Hub:', error);
      throw error;
    }
  }

  /**
   * Establish WebSocket connection for real-time updates
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(this.wsUrl);

      this.websocket.on('open', () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.connected = true;
        this.emit('websocket-connected');
        resolve();
      });

      this.websocket.on('message', (data: string) => {
        try {
          const message: WebSocketMessage = JSON.parse(data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      this.websocket.on('close', () => {
        console.log('WebSocket disconnected');
        this.connected = false;
        this.emit('websocket-disconnected');
        this.scheduleWebSocketReconnect();
      });

      this.websocket.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.emit('websocket-error', error);
        reject(error);
      });
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(message: any): void {
    // Handle application-service WebSocket message format
    if (message.type === 'message') {
      const { topic, deviceId, data } = message;
      
      switch (topic) {
        case 'telemetry':
          this.emit('telemetry', {
            deviceId,
            timestamp: new Date().toISOString(),
            data
          } as TelemetryData);
          break;
        case 'status':
          this.emit('status', {
            deviceId,
            status: data.online ? 'online' : 'offline'
          });
          break;
        case 'events':
          this.emit('event', {
            deviceId,
            eventType: data.eventType || 'device-event',
            timestamp: new Date().toISOString(),
            data
          } as DeviceEvent);
          break;
        case 'twin':
          this.emit('twin', {
            deviceId,
            data
          });
          break;
        default:
          this.emit('message', message);
      }
    } else if (message.type === 'connected') {
      this.emit('connected');
    } else if (message.type === 'methodResponse') {
      this.emit(`method-response-${message.requestId}`, message);
    } else if (message.type === 'messageResponse') {
      this.emit(`message-response-${message.messageId}`, message);
    } else {
      this.emit('message', message);
    }
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  private scheduleWebSocketReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max WebSocket reconnection attempts reached');
      return;
    }

    const delay = Math.pow(2, this.reconnectAttempts) * 1000;
    this.reconnectAttempts++;

    setTimeout(() => {
      console.log(`Attempting WebSocket reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.connectWebSocket().catch(() => {
        // Will retry again due to close event
      });
    }, delay);
  }

  /**
   * Get all devices with optional filtering
   */
  async getDevices(query?: DeviceQuery): Promise<DeviceInfo[]> {
    try {
      const response = await this.httpClient.get('/api/devices', { params: query });
      return response.data;
    } catch (error) {
      console.error('Failed to get devices:', error);
      throw error;
    }
  }

  /**
   * Get specific device information
   */
  async getDevice(deviceId: string): Promise<DeviceInfo> {
    try {
      const response = await this.httpClient.get(`/api/devices/${deviceId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to get device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Get device telemetry data
   */
  async getTelemetry(query: TelemetryQuery): Promise<TelemetryData[]> {
    try {
      const response = await this.httpClient.get('/api/telemetry', { params: query });
      return response.data;
    } catch (error) {
      console.error('Failed to get telemetry:', error);
      throw error;
    }
  }

  /**
   * Get device events
   */
  async getDeviceEvents(deviceId: string, startTime?: string, endTime?: string): Promise<DeviceEvent[]> {
    try {
      const params: any = {};
      if (startTime) params.startTime = startTime;
      if (endTime) params.endTime = endTime;

      const response = await this.httpClient.get(`/api/devices/${deviceId}/events`, { params });
      return response.data;
    } catch (error) {
      console.error(`Failed to get events for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Get device twin state
   */
  async getDeviceTwin(deviceId: string): Promise<DeviceTwin> {
    try {
      const response = await this.httpClient.get(`/api/devices/${deviceId}/twin`);
      return response.data;
    } catch (error) {
      console.error(`Failed to get twin for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Update device twin desired properties
   */
  async updateDeviceTwin(deviceId: string, desired: Record<string, any>): Promise<void> {
    try {
      await this.httpClient.patch(`/api/devices/${deviceId}/twin`, { desired });
    } catch (error) {
      console.error(`Failed to update twin for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Call a direct method on a device
   */
  async callDirectMethod(request: DirectMethodRequest): Promise<DirectMethodResponse> {
    try {
      const response = await this.httpClient.post(
        `/api/devices/${request.deviceId}/methods/${request.methodName}`,
        { payload: request.payload },
        { timeout: request.timeout || this.config.timeout }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to call method ${request.methodName} on device ${request.deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Start telemetry streaming for specific devices
   */
  startTelemetryStream(deviceIds: string[], callback?: (data: TelemetryData) => void): void {
    if (callback) {
      this.on('telemetry', callback);
    }
    
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'subscribe',
        topics: ['telemetry'],
        devices: deviceIds
      }));
    } else {
      console.warn('WebSocket not connected, cannot start telemetry stream');
    }
  }

  /**
   * Stop telemetry streaming
   */
  stopTelemetryStream(): void {
    this.removeAllListeners('telemetry');
  }

  /**
   * Subscribe to specific device
   */
  subscribeToDevice(deviceId: string): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'subscribe',
        topics: ['telemetry', 'status'],
        devices: [deviceId]
      }));
    } else {
      console.warn('WebSocket not connected, cannot subscribe to device');
    }
  }

  /**
   * Unsubscribe from specific device
   */
  unsubscribeFromDevice(deviceId: string): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'unsubscribe',
        topics: ['telemetry', 'status'],
        devices: [deviceId]
      }));
    } else {
      console.warn('WebSocket not connected, cannot unsubscribe from device');
    }
  }

  /**
   * Call device method via WebSocket
   */
  async callDeviceMethod(deviceId: string, methodName: string, payload?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const requestId = `method-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const timeout = setTimeout(() => {
        this.off(`method-response-${requestId}`, responseHandler);
        reject(new Error('Method call timeout'));
      }, 30000);

      const responseHandler = (response: any) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      };

      this.once(`method-response-${requestId}`, responseHandler);

      this.websocket.send(JSON.stringify({
        type: 'callMethod',
        requestId,
        deviceId,
        methodName,
        payload: payload || {}
      }));
    });
  }

  /**
   * Send a cloud-to-device message
   */
  async sendMessageToDevice(deviceId: string, payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const timeout = setTimeout(() => {
        this.off(`message-response-${messageId}`, responseHandler);
        reject(new Error('Message send timeout'));
      }, 10000);

      const responseHandler = (response: any) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      };

      this.once(`message-response-${messageId}`, responseHandler);

      this.websocket.send(JSON.stringify({
        type: 'sendMessage',
        messageId,
        deviceId,
        payload
      }));
    });
  }

  /**
   * Get device statistics and metrics
   */
  async getDeviceStats(): Promise<any> {
    try {
      const response = await this.httpClient.get('/api/stats/devices');
      return response.data;
    } catch (error) {
      console.error('Failed to get device statistics:', error);
      throw error;
    }
  }

  /**
   * Get system health information
   */
  async getSystemHealth(): Promise<any> {
    try {
      const response = await this.httpClient.get('/health');
      return response.data;
    } catch (error) {
      console.error('Failed to get system health:', error);
      throw error;
    }
  }

  /**
   * Disconnect from the Device Hub
   */
  async disconnect(): Promise<void> {
    this.connected = false;

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    this.emit('disconnected');
    console.log('Disconnected from Device Hub');
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    // Check both the connection flag and actual WebSocket state
    if (!this.connected) {
      return false;
    }
    
    // If WebSocket is enabled, verify it's actually connected
    if (this.config.enableWebSocket && this.websocket) {
      return this.websocket.readyState === WebSocket.OPEN;
    }
    
    return true;
  }

  /**
   * Get current configuration
   */
  getConfig(): AppClientConfig {
    return { ...this.config };
  }
}

export default DeviceHubAppClient;
