import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'eventemitter3';

/**
 * Application client configuration
 */
export interface AppClientConfig {
  baseUrl: string;                    // Device Hub API base URL (e.g., 'https://devicehub.local:8080')
  apiKey?: string;                    // Optional API key for authentication
  username?: string;                  // Username for basic auth
  password?: string;                  // Password for basic auth
  timeout?: number;                   // Request timeout in milliseconds
  retryAttempts?: number;             // Number of retry attempts for failed requests
  websocketUrl?: string;              // WebSocket URL for real-time updates
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
export class EdgeberryDeviceHubAppClient extends EventEmitter {
  private config: AppClientConfig;
  private httpClient: AxiosInstance;
  private websocket: WebSocket | null = null;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor(config: AppClientConfig) {
    super();
    
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      enableWebSocket: true,
      ...config
    };

    // Create HTTP client with authentication
    const axiosConfig: AxiosRequestConfig = {
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // Add authentication headers
    if (this.config.apiKey) {
      axiosConfig.headers!['Authorization'] = `Bearer ${this.config.apiKey}`;
    } else if (this.config.username && this.config.password) {
      axiosConfig.auth = {
        username: this.config.username,
        password: this.config.password
      };
    }

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
      await this.httpClient.get('/api/health');
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
      const wsUrl = this.config.websocketUrl || 
        this.config.baseUrl.replace(/^http/, 'ws') + '/ws';

      this.websocket = new WebSocket(wsUrl);

      this.websocket.on('open', () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
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
  private handleWebSocketMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'telemetry':
        this.emit('telemetry', message.data as TelemetryData);
        break;
      case 'event':
        this.emit('device-event', message.data as DeviceEvent);
        break;
      case 'device-status':
        this.emit('device-status', message.data);
        break;
      case 'twin-update':
        this.emit('twin-update', message.data as DeviceTwin);
        break;
      default:
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
   * Subscribe to real-time telemetry for specific devices
   */
  subscribeToTelemetry(deviceIds: string[]): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'subscribe',
        topic: 'telemetry',
        deviceIds
      }));
    } else {
      console.warn('WebSocket not connected, cannot subscribe to telemetry');
    }
  }

  /**
   * Subscribe to device status updates
   */
  subscribeToDeviceStatus(deviceIds?: string[]): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'subscribe',
        topic: 'device-status',
        deviceIds
      }));
    } else {
      console.warn('WebSocket not connected, cannot subscribe to device status');
    }
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
      const response = await this.httpClient.get('/api/health');
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
    return this.connected;
  }

  /**
   * Get current configuration
   */
  getConfig(): AppClientConfig {
    return { ...this.config };
  }
}

export default EdgeberryDeviceHubAppClient;
