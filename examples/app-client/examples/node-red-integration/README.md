# Node-RED Integration Example

This example demonstrates how to integrate Node-RED with the Edgeberry Device Hub using the `@edgeberry/devicehub-app-client` npm package.

## Prerequisites

1. Edgeberry Device Hub running with `application-service` on port 8090
2. Node-RED installed
3. API token created via Device Hub UI (Settings → API Token Management)
4. `@edgeberry/devicehub-app-client` npm package installed in Node-RED

## Installation

1. Install the app-client package in Node-RED:
   ```bash
   cd ~/.node-red
   npm install @edgeberry/devicehub-app-client
   ```
2. Import the example flow (`device-hub-flow.json`) into Node-RED
3. Configure the API token and Device Hub host/port in the environment variables
4. Deploy the flow

## Features

### App Client Integration
- **Device Discovery**: List all devices using `client.getDevices()`
- **Real-time Telemetry**: Stream telemetry using `client.startTelemetryStream()`
- **Device Methods**: Invoke methods using `client.callDeviceMethod()`
- **Device Selection**: Subscribe to specific devices
- **Dashboard Visualization**: Real-time gauges, charts, and status indicators

## Configuration

Configure the following environment variables in the Node-RED flow:

- **API_TOKEN**: Your Device Hub API token
- **DEVICEHUB_HOST**: Device Hub hostname (default: localhost)
- **DEVICEHUB_PORT**: Application service port (default: 8090)

### App Client Initialization
```javascript
const { DeviceHubAppClient } = require('@edgeberry/devicehub-app-client');

const client = new DeviceHubAppClient({
    host: 'localhost',
    port: 8090,
    token: 'YOUR_API_TOKEN'
});
```

## Example Flows

### 1. Device Discovery Flow
Discovers all devices and displays them in a dashboard.

### 2. Telemetry Dashboard
Real-time telemetry visualization with:
- Temperature gauges
- Humidity charts
- Device status indicators
- Event log

### 3. Device Control Panel
- Send commands to devices
- Update device configurations
- Monitor device responses

## Usage

1. **Get Device List**:
   ```javascript
   const client = global.deviceHubClient;
   client.getDevices()
     .then(devices => {
       msg.payload = devices;
       node.send(msg);
     })
     .catch(error => {
       node.error('Failed to get devices: ' + error.message);
     });
   ```

2. **Start Telemetry Stream**:
   ```javascript
   const client = global.deviceHubClient;
   client.startTelemetryStream(['*'], (data) => {
     const msg = {
       payload: data,
       topic: 'telemetry'
     };
     node.send(msg);
   });
   ```

3. **Invoke Device Method**:
   ```javascript
   const client = global.deviceHubClient;
   client.callDeviceMethod(deviceId, methodName, payload)
     .then(response => {
       msg.payload = response;
       node.send(msg);
     })
     .catch(error => {
       node.error('Method call failed: ' + error.message);
     });
   ```

## Troubleshooting

- **Client not initialized**: Ensure `@edgeberry/devicehub-app-client` is installed
- **401 Unauthorized**: Check API token is valid and active
- **Connection errors**: Verify Device Hub host/port configuration
- **No telemetry data**: Verify devices are online and publishing telemetry
- **Method calls fail**: Check device supports the requested method

## Flow Structure

The example flow includes:

1. **Device Discovery**: Automatically fetches device list every 30 seconds
2. **Telemetry Streaming**: Starts real-time telemetry stream on flow startup
3. **Dashboard Visualization**: Temperature/humidity gauges and charts
4. **Device Control**: Example method invocation (identify command)
5. **Device Selection**: Click devices in table to subscribe to specific telemetry

## Security Notes

- Store API tokens securely using Node-RED environment variables
- Use HTTPS in production environments
- Rotate tokens periodically
- Monitor token usage in Device Hub UI
- The app-client handles secure WebSocket connections automatically
