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
npm install @edgeberry/devicehub-device-client
```

Or for development:

```bash
npm install
```

## Quick Start

### Basic Usage

```javascript
const { EdgeberryDeviceHubClient } = require('@edgeberry/devicehub-device-client');

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
const { EdgeberryDeviceHubClient } = require('@edgeberry/devicehub-device-client');

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
# Virtual device implementation
npm run example:virtual-device

# Complete virtual device with full provisioning
npm run example:complete-virtual-device
```

### Available Examples

#### 1. Virtual Device (`examples/virtual-device.js`)

A streamlined virtual device implementation that demonstrates:

- **Basic Device Connection**: Connect to Device Hub using mTLS
- **Telemetry Transmission**: Send simulated sensor data
- **Direct Method Handling**: Respond to remote commands
- **Device Twin Management**: Synchronize device state and configuration
- **Lifecycle Management**: Proper startup, runtime, and shutdown procedures

#### 2. Complete Virtual Device (`examples/complete-virtual-device.ts`)

A comprehensive virtual device implementation that includes all functionality from the original virtual-device project:

- **Device Provisioning**: Automatic certificate generation with CSR
- **Bootstrap TLS**: Certificate fetching and validation
- **Runtime Certificate Management**: Dynamic certificate handling
- **Device Status Publishing**: Last Will Testament support
- **Comprehensive Configuration**: Full environment variable support
- **Certificate Validation**: Proper certificate chain validation
- **Graceful Lifecycle Management**: Complete startup and shutdown procedures

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

#### Running Examples

```bash
# Run the basic virtual device
npm run example:virtual-device

# Run the complete virtual device with default settings
npm run example:complete-virtual-device

# Run with custom configuration
DEVICE_ID=test-device-001 \
PROV_API_BASE=https://devicehub.local:8080 \
TELEMETRY_INTERVAL=3000 \
npm run example:complete-virtual-device
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
const { EdgeberryDeviceHubClient } = require('@edgeberry/devicehub-device-client');

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

## Reconnection Behavior

The client includes robust reconnection logic with exponential backoff:

- **Automatic Reconnection**: The client automatically attempts to reconnect when the connection is lost
- **Exponential Backoff**: Reconnection delays increase exponentially (1s, 2s, 4s, 8s, etc.) up to a maximum of 30 seconds
- **Jitter**: Random jitter is added to prevent thundering herd problems
- **Connection Limits**: Maximum of 10 reconnection attempts before giving up
- **State Management**: Reconnection attempts are reset on successful connection

```javascript
const { EdgeberryDeviceHubClient } = require('@edgeberry/devicehub-device-client');

const client = new EdgeberryDeviceHubClient({
  deviceId: 'my-device-001',
  host: '127.0.0.1',
  port: 8883
});

// Handle reconnection events
client.on('reconnecting', () => {
  console.log('Attempting to reconnect...');
});

client.on('connected', () => {
  console.log('Successfully connected/reconnected');
});

client.on('error', (error) => {
  console.error('Connection error:', error.message);
});
```

## Best Practices

1. **Connection Management**: Always handle connection events and implement reconnection logic
2. **Error Handling**: Implement proper error handling for all operations
3. **Resource Cleanup**: Call `disconnect()` when shutting down
4. **Telemetry Batching**: Use reasonable intervals to avoid overwhelming the broker
5. **Certificate Security**: Store certificates securely and rotate them regularly
6. **Reconnection Monitoring**: Monitor reconnection events and implement alerting for persistent connection issues

## Development

### Project Structure

```
edgeberry-device-hub-client/
├── device-client.ts         # Main client library (TypeScript)
├── package.json             # Package configuration
├── README.md               # This documentation
├── tsconfig.json           # TypeScript configuration
└── examples/               # Usage examples
    ├── virtual-device.js   # Basic virtual device implementation
    └── complete-virtual-device.ts # Full-featured virtual device
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
