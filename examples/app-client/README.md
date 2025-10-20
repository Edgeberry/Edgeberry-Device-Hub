# Edgeberry Device Hub App Client

A TypeScript Node.js client library for consuming data from Edgeberry Device Hub's Application Service.

## Features

- **REST API Integration**: Device management, telemetry queries, method invocation
- **WebSocket Streaming**: Real-time telemetry and event streaming
- **Token Authentication**: Secure API access with token-based authentication
- **TypeScript Support**: Full type definitions for better development experience
- **Event-Driven**: EventEmitter-based architecture for handling real-time data

## Installation

```bash
npm install @edgeberry/devicehub-app-client
```

## Quick Start

### TypeScript/ESM

```typescript
import DeviceHubAppClient from '@edgeberry/devicehub-app-client';

const client = new DeviceHubAppClient({
  host: 'localhost',
  port: 8090,
  token: 'your-api-token'
});

// Connect to Device Hub
await client.connect();

// Get all devices
const devices = await client.getDevices();
console.log('Devices:', devices);

// Start telemetry streaming
client.startTelemetryStream(['*'], (data) => {
  console.log('Telemetry:', data);
});

// Call device method
const response = await client.callDeviceMethod('device-id', 'identify', { duration: 5 });
console.log('Method response:', response);
```

### CommonJS (Node.js)

```javascript
const DeviceHubAppClient = require('@edgeberry/devicehub-app-client').default;

const client = new DeviceHubAppClient({
  host: 'localhost',
  port: 8090,
  token: 'your-api-token'
});

// Connect and use
client.connect().then(() => {
  client.getDevices().then(devices => {
    console.log('Devices:', devices);
  });
});
```

## API Reference

### Constructor Options

```typescript
interface AppClientOptions {
  host: string;          // Device Hub hostname
  port: number;          // Application service port (default: 8090)
  token: string;         // API authentication token
  secure?: boolean;      // Use HTTPS/WSS (default: false)
}
```

### Methods

#### `getDevices(): Promise<Device[]>`
Retrieve list of all devices.

#### `getDevice(deviceId: string): Promise<Device>`
Get specific device details.

#### `callDeviceMethod(deviceId: string, methodName: string, payload?: any): Promise<any>`
Invoke a method on a specific device.

#### `startTelemetryStream(deviceIds: string[], callback: (data: TelemetryData) => void): void`
Start streaming telemetry data from specified devices. Use `['*']` for all devices.

#### `stopTelemetryStream(): void`
Stop the telemetry stream.

#### `subscribeToDevice(deviceId: string): void`
Subscribe to telemetry from a specific device.

#### `unsubscribeFromDevice(deviceId: string): void`
Unsubscribe from a specific device.

## Examples

See the `examples/` directory for complete integration examples:

- **[Node-RED Integration](examples/node-red-integration/)**: Complete Node-RED flow demonstrating device discovery, telemetry streaming, and method invocation
- **[Basic Usage](examples/basic/)**: Simple TypeScript examples
- **[Dashboard Integration](examples/dashboard/)**: Web dashboard integration patterns

## Error Handling

```typescript
try {
  const devices = await client.getDevices();
} catch (error) {
  if (error.status === 401) {
    console.error('Invalid or expired API token');
  } else {
    console.error('API error:', error.message);
  }
}
```

## Events

The client extends EventEmitter and emits the following events:

- `connected`: WebSocket connection established
- `disconnected`: WebSocket connection lost
- `error`: Connection or API errors
- `telemetry`: Real-time telemetry data (alternative to callback)

```typescript
client.on('connected', () => console.log('Connected to Device Hub'));
client.on('telemetry', (data) => console.log('Telemetry:', data));
client.on('error', (error) => console.error('Client error:', error));
```

## TypeScript Types

```typescript
interface Device {
  deviceId: string;
  name: string;
  status: 'online' | 'offline';
  lastSeen: string | null;
  model?: string;
  firmware?: string;
  metadata: Record<string, any>;
  createdAt: string;
}

interface TelemetryData {
  deviceId: string;
  timestamp: string;
  data: Record<string, any>;
}
```

## Security

- Store API tokens securely using environment variables
- Use HTTPS/WSS in production environments
- Rotate tokens periodically through the Device Hub UI
- Monitor token usage and access logs

## License

MIT
