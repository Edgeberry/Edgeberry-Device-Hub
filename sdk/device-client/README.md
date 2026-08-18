# Edgeberry Device Hub Client

A comprehensive Node.js client library for connecting to and interacting with the Edgeberry Device Hub. This library provides a high-level interface for device communication, telemetry transmission, direct method handling, and device twin management.

This is not just a reference client: it's the actual connection layer used in production by the [Edgeberry Device Software](https://github.com/Edgeberry/Edgeberry-device-software), which imports `EdgeberryDeviceHubClient` (in `src/deviceHub.ts`) to authenticate, provision, and stay connected to the Hub. That project currently depends on `^1.8.0`, one major version behind this package's `2.0.0` — worth checking for breaking changes before bumping it there.

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
# Provisioning identity - PROV_UUID must be whitelisted on the Hub first
PROV_UUID=d6062a92-83f3-4e0f-b42c-04c0b47a3d2a

# Where to fetch the claim certificate (ca.crt / provisioning.crt / .key) from.
# This is the Hub's admin HTTP port (3000 in production, 8080 in dev).
PROV_API_BASE=http://devicehub.example.com:3000

# MQTT broker - full URL, not a bare host
MQTT_URL=mqtts://devicehub.example.com:8883

# Set false when the broker cert is signed by a CA your machine doesn't trust
# (e.g. the Hub's own root CA, or an IP-addressed test Hub)
MQTT_TLS_REJECT_UNAUTHORIZED=true

# Where the fetched claim certificate is written (default ./certs)
CERTS_DIR=./certs

# Telemetry publish period, milliseconds
TELEMETRY_PERIOD_MS=5000

# Certificate output paths (optional; default to the system temp dir)
DEVICE_CERT_OUT=/path/to/device.crt
DEVICE_KEY_OUT=/path/to/device.key
```

> [!NOTE]
> The device's own name is **assigned by the Hub** during provisioning - it is
> not something you choose. `DEVICE_ID` only labels the pre-provisioning
> session; the Hub replaces it with the name it hands back in round 1 of the
> handshake, and that assigned name becomes the device's certificate CN, MQTT
> client id, and topic namespace from then on.

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

All topics are namespaced under `$devicehub` and keyed by `{deviceId}` — the
name the Hub **assigned** during provisioning, which is also the certificate CN
and MQTT client id. Nothing is addressed by hardware UUID after provisioning.

Device publishes:

| Purpose | Topic |
|---|---|
| Telemetry | `$devicehub/devices/{deviceId}/telemetry` |
| Events | `$devicehub/devices/{deviceId}/messages/events` |
| Heartbeat | `$devicehub/devices/{deviceId}/heartbeat` |
| Twin read request | `$devicehub/devices/{deviceId}/twin/get` |
| Twin reported update | `$devicehub/devices/{deviceId}/twin/update` |
| Direct method reply | `$devicehub/devices/{deviceId}/methods/{methodName}/response` |

Device subscribes:

| Purpose | Topic |
|---|---|
| Direct method calls | `$devicehub/devices/{deviceId}/methods/+/request` |
| Cloud-to-device messages | `$devicehub/devices/{deviceId}/messages/devicebound` |
| Twin update accepted | `$devicehub/devices/{deviceId}/twin/update/accepted` |
| Twin update rejected | `$devicehub/devices/{deviceId}/twin/update/rejected` |
| Twin desired delta | `$devicehub/devices/{deviceId}/twin/update/delta` |

Provisioning is the one exception: it runs under the hardware UUID, because no
name has been assigned yet.

| Purpose | Topic |
|---|---|
| Claim / issue request | `$devicehub/devices/{uuid}/provision/request` |
| Accepted | `$devicehub/devices/{uuid}/provision/accepted` |
| Rejected | `$devicehub/devices/{uuid}/provision/rejected` |

The handshake is **two round trips** on the same connection:

1. **Claim** — publish to `provision/request` with no `csrPem`. The Hub assigns
   a fresh name and returns it as `deviceId`.
2. **Issue** — publish again with `csrPem` (CN'd for that assigned name) and
   `deviceId` echoed back. The Hub returns `certPem` and `caChainPem`.

Sending a CSR in the first request is rejected: nothing has been claimed for the
UUID yet, so there is no assigned name for the CSR's CN to match. See
[`examples/complete-virtual-device.ts`](examples/complete-virtual-device.ts) for
a working implementation.

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

MIT — see [LICENSE](LICENSE). Note this differs from the Device Hub server itself, which is AGPL-3.0-or-later.

## Support

For issues and questions, please refer to the main Edgeberry Device Hub documentation or create an issue in the project repository.
