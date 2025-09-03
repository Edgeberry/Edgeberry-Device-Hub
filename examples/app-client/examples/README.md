# Node-RED Edgeberry Device Hub Integration

This directory contains a complete Node-RED node implementation that demonstrates how to use the Edgeberry Device Hub App Client for consuming device data in Node-RED flows.

## Files

- `node-red-node.js` - Main Node-RED node implementation
- `node-red-node.html` - Node-RED editor UI definitions
- `package.json` - Node-RED contrib package configuration

## Installation

### As a Node-RED Contrib Package

1. Install the package in your Node-RED installation:
```bash
npm install node-red-contrib-edgeberry-devicehub
```

2. Restart Node-RED to load the new nodes.

### Local Development

1. Build the app client first:
```bash
cd ../
npm run build
```

2. Link the package locally in your Node-RED installation:
```bash
cd ~/.node-red
npm link /path/to/Edgeberry-Device-Hub/examples/edgeberry-device-hub-app-client/examples
```

## Available Nodes

### Device Hub Config
Configuration node that stores connection details for the Device Hub:
- **Base URL**: Device Hub API endpoint (e.g., `https://devicehub.local:8080`)
- **Authentication**: Username/password or API key

### Device Hub In
Input node that receives data from Device Hub devices:
- **Real-time data**: Telemetry, events, device status, twin updates
- **Historical data**: Query devices, telemetry history, events
- **Device filtering**: Monitor specific devices or all devices
- **WebSocket support**: Live data streaming

### Device Hub Out
Output node that sends commands to Device Hub devices:
- **Direct methods**: Call device methods with responses
- **Twin updates**: Update device twin desired properties
- **Command responses**: Receive method call results

## Usage Examples

### Basic Telemetry Monitoring

1. Add a "Device Hub Config" node and configure your Device Hub connection
2. Add a "Device Hub In" node and select the config
3. Configure to receive "telemetry" data types
4. Connect to a debug node to see incoming telemetry

### Device Control Flow

1. Add an inject node with the following payload:
```json
{
  "action": "callDirectMethod",
  "deviceId": "device001",
  "methodName": "identify",
  "payload": { "duration": 5 }
}
```

2. Connect to a "Device Hub Out" node
3. Connect the output to a debug node to see the response

### Real-time Device Status Dashboard

1. Configure "Device Hub In" for "status" data type with real-time enabled
2. Use a function node to format the data for display
3. Connect to dashboard nodes for visualization

## Message Formats

### Input Node Output Messages

```javascript
// Telemetry message
{
  topic: "telemetry/device001",
  payload: {
    deviceId: "device001",
    timestamp: "2024-01-01T12:00:00Z",
    data: { temperature: 25.5, humidity: 60 }
  },
  deviceId: "device001",
  dataType: "telemetry"
}

// Event message
{
  topic: "event/device001/alert",
  payload: {
    deviceId: "device001",
    eventType: "alert",
    timestamp: "2024-01-01T12:00:00Z",
    data: { message: "Temperature too high" }
  },
  deviceId: "device001",
  dataType: "event"
}
```

### Output Node Input Messages

```javascript
// Direct method call
{
  action: "callDirectMethod",
  deviceId: "device001",
  methodName: "reboot",
  payload: { delay: 5 },
  timeout: 30000
}

// Twin update
{
  action: "updateDeviceTwin",
  deviceId: "device001",
  desired: {
    telemetryInterval: 10000,
    logLevel: "info"
  }
}
```

## Error Handling

The nodes include comprehensive error handling:
- Connection failures are indicated by red status
- Invalid messages generate node errors
- WebSocket disconnections trigger automatic reconnection
- Method call timeouts are handled gracefully

## Security

- All credentials are stored securely by Node-RED
- Supports both API key and username/password authentication
- HTTPS/WSS connections are used for secure communication
- Credentials are not visible in exported flows

## Development

To modify or extend these nodes:

1. Edit `node-red-node.js` for functionality changes
2. Edit `node-red-node.html` for UI changes
3. Test locally using the development installation method
4. Update version in `package.json` before publishing

## Publishing

To publish as an npm package:

```bash
npm publish
```

The package will be available as `node-red-contrib-edgeberry-devicehub` on npm.
