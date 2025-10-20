![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_hub.png)

# Edgeberry Device Hub - Node-RED Integration

Official Node-RED nodes for integrating with Edgeberry Device Hub.

## Overview

This package provides a **Device** node that represents a specific device connected to your Device Hub. The node enables bidirectional communication with real-time WebSocket updates.

## Features

✅ **Real-time telemetry streaming** - Receive device sensor data via WebSocket  
✅ **Device events** - Get alerts and notifications from devices  
✅ **Device status** - Monitor online/offline status changes  
✅ **Direct methods** - Call device methods (identify, reboot, custom)  
✅ **Twin updates** - Update device twin desired properties  
✅ **Connection status** - Visual indicators for connection state


## Installation

Install via Node-RED Palette Manager or command line:

```bash
cd ~/.node-red
npm install @edgeberry/devicehub-node-red-contrib
```

Restart Node-RED after installation.

## Configuration

### 1. Create Device Hub Config Node

Add a configuration node with your Device Hub connection details:

- **Host**: Device Hub hostname or IP (e.g., `localhost`, `192.168.1.100`)
- **Port**: Application service port (default: `8090`)
- **Use HTTPS**: Enable for secure connections
- **Access Token**: API token from Device Hub

### 2. Get Access Token

1. Open Device Hub UI
2. Navigate to **Settings → API Tokens**
3. Click **Create Token**
4. Copy the generated token (shown only once)
5. Paste in the config node

### 3. Add Device Node

Configure the device node:

- **Device Hub**: Select your config node
- **Device**: Enter exact device name (e.g., `EDGB-A096`)

## Usage

### Input Messages

Send commands to the device via the input:

**Direct Method Call:**
```json
{
  "action": "method",
  "methodName": "identify",
  "payload": { "duration": 5 }
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

### Output Messages

The node outputs all messages from the configured device:

```json
{
  "topic": "telemetry/EDGB-A096",
  "payload": { /* message data */ },
  "deviceName": "EDGB-A096",
  "messageType": "telemetry"
}
```

**Message Types:**
- `telemetry` - Sensor data and measurements
- `event` - Device events and alerts
- `status` - Online/offline status changes
- `twin` - Twin property updates
- `method-response` - Direct method responses

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
