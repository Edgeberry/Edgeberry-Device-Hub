![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_hub.png)

Node-RED node for integrating with Edgeberry Device Hub.

## Overview

This package provides a **Device** node that represents a specific device connected to your Device Hub. The node enables bidirectional communication:
- **Receives** all messages from the device (telemetry, events, status, twin updates)
- **Sends** commands and updates to the device (direct methods, twin updates)

## Architecture

```
┌──────────────────┐
│  Device Hub      │  ← Configuration Node
│  Config          │     (Host, Port, Token)
│  localhost:8090  │
└──────────────────┘
         ↓
    ┌─────────────────┐
    │  Device Node    │  ← Flow Node
    │  EDGB-A096      │     (1 input, 1 output)
    └─────────────────┘
         │
         ├──► Telemetry
         ├──► Events  
         ├──► Status
         └──► Twin Updates
```

## Installation

### From NPM

```bash
cd ~/.node-red
npm install @edgeberry/devicehub-node-red-contrib
```

Restart Node-RED to load the nodes.

### Local Development

1. Build the app-client library:
```bash
cd examples/app-client
npm install
npm run build
```

2. Build the Node-RED package:
```bash
cd examples
npm install
npm run build
```

3. Link to your Node-RED installation:
```bash
cd ~/.node-red
npm install /path/to/Edgeberry-Device-Hub/examples/app-client/examples
```

4. Restart Node-RED

## Configuration

### Device Hub Config Node

Create a reusable configuration for connecting to Device Hub:

1. **Host**: Device Hub hostname or IP (e.g., `localhost`, `192.168.1.100`)
2. **Port**: Application service port (default: `8090`)
3. **Use HTTPS**: Enable for secure connections
4. **Access Token**: API token from Device Hub

#### Getting an Access Token

1. Open Device Hub UI
2. Go to **Settings → API Tokens**
3. Click **Create Token**
4. Copy the token and paste it in the config node

### Device Node

Configure the device node:

1. **Device Hub**: Select your Device Hub config node
2. **Device**: Device name from Device Hub (e.g., `EDGB-A096`)
3. **Name** (optional): Custom display name for the node

## Usage

### Basic Flow

```
┌─────────┐     ┌──────────┐     ┌───────┐
│ Inject  │────►│  Device  │────►│ Debug │
└─────────┘     │ EDGB-A096│     └───────┘
                └──────────┘
```

### Sending Commands to Device

**Call Identify Method:**
```json
{
  "action": "method",
  "methodName": "identify",
  "payload": { "duration": 5 }
}
```

**Call Reboot Method:**
```json
{
  "action": "method",
  "methodName": "reboot",
  "payload": { "delay": 10 }
}
```

**Update Device Twin:**
```json
{
  "action": "twin",
  "desired": {
    "telemetryInterval": 10000,
    "logLevel": "debug"
  }
}
```

### Receiving Device Messages

The device node automatically outputs all messages from the configured device. Use a **switch** node to route different message types:

**Filter by `msg.messageType`:**
- `telemetry` - Device sensor data
- `event` - Device events (alerts, notifications)
- `status` - Online/offline status changes
- `twin` - Twin property updates
- `method-response` - Response from direct method calls
- `error` - Error messages

### Advanced: Message Routing

```
┌──────────┐     ┌────────┐     ┌─────────────┐
│  Device  │────►│ Switch │────►│ Telemetry   │
│EDGB-A096 │     │  Node  │  ├─►│ Events      │
└──────────┘     └────────┘  ├─►│ Status      │
                              └─►│ Method Resp │
```

Configure switch node to route on `msg.messageType`:
- `== telemetry` → Output 1
- `== event` → Output 2
- `== status` → Output 3
- `== method-response` → Output 4

### Example: Dashboard Integration

Extract temperature from telemetry and display on gauge:

```javascript
// Function node
if (msg.messageType === 'telemetry') {
    return {
        payload: msg.payload.data.temperature,
        topic: 'Temperature'
    };
}
```

## Connection Status

The device node displays real-time connection status:

- 🟡 **Yellow ring "connecting"** - Establishing connection to Device Hub
- 🟢 **Green dot "connected: EDGB-A096"** - Connected and WebSocket active
- 🔴 **Red ring "disconnected"** - Lost connection to Device Hub
- 🔴 **Red ring "no config"** - Device Hub config node not selected
- 🔴 **Red ring "no token"** - Access token missing

## Message Format

### Output Messages

All output messages include:

```javascript
{
  topic: "telemetry/EDGB-A096",        // Message topic
  payload: { /* message data */ },      // Message payload
  deviceName: "EDGB-A096",             // Device name
  messageType: "telemetry"             // Message type
}
```

**Topic patterns:**
- Telemetry: `telemetry/EDGB-A096`
- Events: `event/EDGB-A096/alert`
- Status: `status/EDGB-A096`
- Twin: `twin/EDGB-A096`
- Method Response: `method-response/EDGB-A096/identify`

## Troubleshooting

### Node shows "no token"
- Ensure you've created an API token in Device Hub
- Check that the token is correctly entered in the Device Hub config node

### Node shows "disconnected"
- Verify Device Hub is running
- Check host and port settings in config node
- Ensure the application service is accessible
- Check firewall settings

### No messages received
- Verify the device name matches exactly (case-sensitive)
- Check that the device is online in Device Hub
- Ensure WebSocket connections are allowed

### Method calls timeout
- Verify the device supports the method
- Check device is online and responding
- Increase timeout value if needed (default: 30 seconds)

## Development

### Building

```bash
npm run build
```

Compiles JavaScript and copies HTML to `dist/`:
- `dist/node-red-device-node.js` - Compiled JavaScript
- `dist/node-red-device-node.html` - Node UI definition

### Project Structure

```
examples/app-client/examples/
├── node-red-device-node.js    # Node implementation
├── node-red-device-node.html  # Node UI definition
├── package.json               # Package configuration
├── tsconfig.json             # TypeScript configuration
└── dist/                     # Built output (generated)
```

## Publishing

The package is published automatically via GitHub Actions when a new release is created.

**Manual publishing:**
```bash
npm publish --access public
```

**NPM Package:** `@edgeberry/devicehub-node-red-contrib`

## Support

- **Documentation:** https://github.com/Edgeberry/Edgeberry-Device-Hub
- **Issues:** https://github.com/Edgeberry/Edgeberry-Device-Hub/issues
- **License:** GPL-3.0-or-later

## Example Flows

### Monitor Multiple Devices

```
┌──────────┐
│  Device  │────► Temperature Dashboard
│EDGB-A096 │
└──────────┘

┌──────────┐
│  Device  │────► Humidity Dashboard  
│EDGB-B123 │
└──────────┘
```

### Alert on High Temperature

```
┌──────────┐   ┌──────────┐   ┌────────┐
│  Device  │──►│ Function │──►│ Email  │
│EDGB-A096 │   │ (filter) │   │  Alert │
└──────────┘   └──────────┘   └────────┘
```

Function node:
```javascript
if (msg.messageType === 'telemetry' && 
    msg.payload.data.temperature > 30) {
    msg.payload = `Alert: High temperature ${msg.payload.data.temperature}°C`;
    return msg;
}
```
