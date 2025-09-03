# Edgeberry Device Hub Client

A comprehensive Node.js client library for connecting to and interacting with the Edgeberry Device Hub. This library provides a high-level interface for device communication, telemetry transmission, direct method handling, and device twin management.

## Features

- **MQTT Communication**: Secure MQTT connections with mTLS support
- **Device Provisioning**: Automated device registration and certificate management
- **Telemetry Transmission**: Efficient data sending with batching capabilities
- **Direct Methods**: Handle remote procedure calls from the Device Hub
- **Device Twin**: Synchronize device state and configuration
- **Virtual Device**: Complete virtual device implementation for testing

## Installation

```bash
npm install
```

## Quick Start

### Basic Usage

```javascript
import EdgeberryDeviceHubClient from './index.js';

const client = new EdgeberryDeviceHubClient({
  deviceId: 'my-device-001',
  host: '127.0.0.1',
  port: 1883
});

await client.connect();

// Send telemetry
client.sendTelemetry({
  temperature: 25.5,
  humidity: 60.2
});

// Handle direct methods
client.on('directMethod', ({ methodName, payload, respond }) => {
  if (methodName === 'identify') {
    respond({ status: 200, payload: { message: 'Device identified' } });
  }
});
```

### Secure Connection with mTLS

```javascript
const secureClient = EdgeberryDeviceHubClient.createSecureClient({
  deviceId: 'secure-device-001',
  host: '127.0.0.1',
  port: 8883,
  caPath: '/path/to/ca.crt',
  certPath: '/path/to/device.crt',
  keyPath: '/path/to/device.key'
});

await secureClient.connect();
```

## Examples

### Run Examples

```bash
# Basic usage example
npm run example:basic

# Advanced telemetry sender
npm run example:telemetry

# Direct methods handling
npm run example:direct-methods

# Complete virtual device with provisioning
npm run example:virtual-device
```

### Virtual Device

The virtual device example demonstrates a complete device implementation including:

- **Device Provisioning**: Automatic certificate generation and registration
- **mTLS Authentication**: Secure connection using device certificates
- **Realistic Telemetry**: Simulated sensor data with natural variations
- **Direct Method Support**: Handle identify, reboot, configuration updates
- **Device Twin Management**: Synchronize device state and configuration
- **Lifecycle Management**: Proper startup, runtime, and shutdown procedures

#### Environment Variables

```bash
# Device identification
DEVICE_ID=my-virtual-device-001
PROV_UUID=unique-provisioning-id

# Connection settings
MQTT_HOST=127.0.0.1
PROV_API_BASE=https://127.0.0.1:8080

# Device metadata
DEVICE_NAME="My Virtual Device"
DEVICE_MODEL=EdgeberryVirtualDevice
FIRMWARE_VERSION=1.2.3

# Telemetry settings
TELEMETRY_INTERVAL=5000

# Certificate output paths (optional)
DEVICE_CERT_OUT=/path/to/device.crt
DEVICE_KEY_OUT=/path/to/device.key
```

#### Running Virtual Device

```bash
# With default settings
npm run example:virtual-device

# With custom configuration
DEVICE_ID=test-device-001 \
PROV_API_BASE=https://devicehub.local:8080 \
TELEMETRY_INTERVAL=3000 \
npm run example:virtual-device
```

## API Reference

### EdgeberryDeviceHubClient

#### Constructor Options

- `deviceId` (string): Unique device identifier
- `host` (string): MQTT broker hostname (default: '127.0.0.1')
- `port` (number): MQTT broker port (default: 1883)
- `protocol` (string): Connection protocol ('mqtt' or 'mqtts')
- `ca`, `cert`, `key` (Buffer): TLS certificates for mTLS
- `rejectUnauthorized` (boolean): Verify server certificates (default: true)

#### Methods

##### `connect()`
Establish connection to the Device Hub.

##### `disconnect()`
Gracefully disconnect from the Device Hub.

##### `sendTelemetry(data)`
Send telemetry data to the Device Hub.

```javascript
client.sendTelemetry({
  temperature: 25.5,
  humidity: 60.2,
  timestamp: new Date().toISOString()
});
```

##### `sendEvent(eventType, data)`
Send an event to the Device Hub.

```javascript
client.sendEvent('alarm', {
  severity: 'high',
  message: 'Temperature threshold exceeded'
});
```

##### `updateTwinReported(properties)`
Update device twin reported properties.

```javascript
client.updateTwinReported({
  firmware: '1.2.3',
  status: 'online',
  lastUpdate: new Date().toISOString()
});
```

#### Events

##### `connected`
Emitted when successfully connected to the Device Hub.

##### `disconnected`
Emitted when disconnected from the Device Hub.

##### `error`
Emitted when a connection or communication error occurs.

##### `directMethod`
Emitted when a direct method is called.

```javascript
client.on('directMethod', ({ methodName, requestId, payload, respond }) => {
  // Handle the method call
  respond({ status: 200, payload: { result: 'success' } });
});
```

##### `twinDesired`
Emitted when device twin desired properties are updated.

```javascript
client.on('twinDesired', (properties) => {
  // Apply desired configuration
  console.log('New desired properties:', properties);
});
```

##### `message`
Emitted for all incoming MQTT messages.

```javascript
client.on('message', ({ topic, payload }) => {
  console.log(`Message on ${topic}:`, payload);
});
```

### Static Methods

#### `EdgeberryDeviceHubClient.createSecureClient(options)`
Create a client instance configured for mTLS authentication.

```javascript
const client = EdgeberryDeviceHubClient.createSecureClient({
  deviceId: 'secure-device',
  host: 'devicehub.example.com',
  port: 8883,
  caPath: '/certs/ca.crt',
  certPath: '/certs/device.crt',
  keyPath: '/certs/device.key'
});
```

## Topic Structure

The client uses the following MQTT topic patterns:

- **Telemetry**: `devices/{deviceId}/telemetry`
- **Events**: `devices/{deviceId}/events`
- **Direct Methods**: `$devicehub/devices/{deviceId}/methods/post`
- **Method Response**: `$devicehub/devices/{deviceId}/methods/res`
- **Twin Desired**: `devices/{deviceId}/twin/desired`
- **Twin Reported**: `devices/{deviceId}/twin/reported`

## Error Handling

The client provides comprehensive error handling:

```javascript
client.on('error', (error) => {
  console.error('Client error:', error.message);
  
  // Implement retry logic or fallback behavior
});

try {
  await client.connect();
} catch (error) {
  console.error('Connection failed:', error.message);
}
```

## Best Practices

1. **Connection Management**: Always handle connection events and implement reconnection logic
2. **Error Handling**: Implement proper error handling for all operations
3. **Resource Cleanup**: Call `disconnect()` when shutting down
4. **Telemetry Batching**: Use reasonable intervals to avoid overwhelming the broker
5. **Certificate Security**: Store certificates securely and rotate them regularly

## Development

### Project Structure

```
edgeberry-device-hub-client/
├── index.js                 # Main client library
├── package.json             # Package configuration
├── README.md               # This documentation
└── examples/               # Usage examples
    ├── basic-usage.js      # Simple client usage
    ├── telemetry-sender.js # Advanced telemetry patterns
    ├── direct-methods.js   # Direct method handling
    └── virtual-device.js   # Complete virtual device
```

### Contributing

1. Follow the existing code style and patterns
2. Add comprehensive error handling
3. Include examples for new features
4. Update documentation for API changes

## License

GPL-3.0-or-later

## Support

For issues and questions, please refer to the main Edgeberry Device Hub documentation or create an issue in the project repository.
