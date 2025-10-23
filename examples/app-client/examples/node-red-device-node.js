/**
 * Node-RED Device Node for Edgeberry Device Hub
 * 
 * This node represents a single device connected to Device Hub.
 * - Inputs: Commands/messages to send to the device
 * - Outputs: Telemetry, events, and status updates from the device
 */

const DeviceHubAppClient = require('@edgeberry/devicehub-app-client').default;

module.exports = function(RED) {
    "use strict";

    /**
     * Device Hub Configuration Node
     * Stores connection settings for Device Hub
     */
    function DeviceHubConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.host = config.host;
        this.port = config.port;
        this.secure = config.secure;
        
        // Build baseUrl from host and port
        const protocol = this.secure ? 'https' : 'http';
        this.baseUrl = `${protocol}://${this.host}:${this.port}`;
    }

    /**
     * Device Node - Represents a specific device on Device Hub
     */
    function DeviceHubDeviceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Get Device Hub configuration
        const hubConfig = RED.nodes.getNode(config.hub);
        if (!hubConfig) {
            node.error("No Device Hub configuration found");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        // Configuration
        node.deviceName = config.deviceName;
        node.hubConfig = hubConfig;

        if (!node.deviceName) {
            node.error("Device name is required");
            node.status({fill: "red", shape: "ring", text: "no device name"});
            return;
        }

        if (!hubConfig.credentials || !hubConfig.credentials.token) {
            node.error("Access token is required in Device Hub config");
            node.status({fill: "red", shape: "ring", text: "no token"});
            return;
        }

        let client = null;

        // Initialize connection to Device Hub
        async function initializeClient() {
            try {
                client = new DeviceHubAppClient({
                    host: hubConfig.host,
                    port: parseInt(hubConfig.port),
                    secure: hubConfig.secure || false,
                    token: hubConfig.credentials.token,
                    enableWebSocket: true
                });

                node.status({fill: "yellow", shape: "ring", text: "connecting..."});

                // Set up event listeners BEFORE connecting to avoid race condition
                setupDeviceListeners();

                // WebSocket connected event
                client.on('connected', () => {
                    node.status({fill: "green", shape: "dot", text: `connected: ${node.deviceName}`});
                });

                client.on('disconnected', () => {
                    node.status({fill: "red", shape: "ring", text: "disconnected"});
                });

                client.on('error', (error) => {
                    node.error(`Device Hub error: ${error.message}`);
                    node.status({fill: "red", shape: "ring", text: "error"});
                });

                // Subscribe once WebSocket is fully connected
                client.on('websocket-connected', () => {
                    // Small delay to ensure connection is fully established
                    setTimeout(() => {
                        node.log(`Subscribing to telemetry for device: ${node.deviceName}`);
                        client.startTelemetryStream([node.deviceName]);
                    }, 100);
                });

                // Now connect (subscription will happen in websocket-connected event)
                await client.connect();

            } catch (error) {
                node.error(`Failed to connect to Device Hub: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "connection failed"});
            }
        }

        // Set up listeners for device messages
        // Note: application-service already filters messages based on our subscription,
        // so we receive only messages for this device
        function setupDeviceListeners() {
            // Telemetry data
            client.on('telemetry', (data) => {
                node.send({
                    topic: `telemetry/${node.deviceName}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'telemetry'
                });
            });

            // Device events
            client.on('event', (data) => {
                node.send({
                    topic: `event/${node.deviceName}/${data.eventType || 'unknown'}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'event'
                });
            });

            // Device status changes
            client.on('status', (data) => {
                node.send({
                    topic: `status/${node.deviceName}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'status'
                });
                
                // Update node status indicator
                const statusText = data.status === 'online' ? 'online' : 'offline';
                const statusColor = data.status === 'online' ? 'green' : 'yellow';
                node.status({fill: statusColor, shape: "dot", text: `${node.deviceName}: ${statusText}`});
            });

            // Twin updates
            client.on('twin', (data) => {
                node.send({
                    topic: `twin/${node.deviceName}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'twin'
                });
            });
        }

        // Handle input messages (commands to device)
        node.on('input', async function(msg) {
            if (!client || !client.isConnected()) {
                node.error("Not connected to Device Hub");
                return;
            }

            try {
                const action = msg.action || msg.topic;
                
                switch (action) {
                    case 'callDirectMethod':
                    case 'method':
                        if (!msg.methodName) {
                            node.error("methodName required for direct method call");
                            return;
                        }
                        
                        const response = await client.callDeviceMethod(
                            node.deviceName,
                            msg.methodName,
                            msg.payload
                        );
                        
                        node.send({
                            topic: `method-response/${node.deviceName}/${msg.methodName}`,
                            payload: response,
                            deviceName: node.deviceName,
                            methodName: msg.methodName,
                            messageType: 'method-response'
                        });
                        break;

                    case 'updateTwin':
                    case 'twin':
                        if (!msg.desired && !msg.payload.desired) {
                            node.error("desired properties required for twin update");
                            return;
                        }
                        
                        const desired = msg.desired || msg.payload.desired;
                        await client.updateDeviceTwin(node.deviceName, desired);
                        
                        node.send({
                            topic: `twin-updated/${node.deviceName}`,
                            payload: { success: true, desired: desired },
                            deviceName: node.deviceName,
                            messageType: 'twin-update-confirm'
                        });
                        break;

                    default:
                        node.warn(`Unknown action: ${action}. Use 'method' or 'twin'.`);
                }
            } catch (error) {
                node.error(`Failed to execute action: ${error.message}`);
                node.send({
                    topic: 'error',
                    payload: { error: error.message, action: msg.action },
                    deviceName: node.deviceName,
                    messageType: 'error'
                });
            }
        });

        // Initialize on startup
        node.status({fill: "yellow", shape: "ring", text: "connecting"});
        initializeClient();

        // Cleanup on close
        node.on('close', async function() {
            if (client) {
                await client.disconnect();
            }
        });
    }

    // Register the nodes
    RED.nodes.registerType("devicehub-config", DeviceHubConfigNode, {
        credentials: {
            token: { type: "password" }
        }
    });
    
    RED.nodes.registerType("devicehub-device", DeviceHubDeviceNode);
};
