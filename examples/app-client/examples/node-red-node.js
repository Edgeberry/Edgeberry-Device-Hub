/**
 * Node-RED node implementation using the Edgeberry Device Hub App Client
 * 
 * This is an example implementation showing how to use the app client
 * in a Node-RED environment to consume device data from the Device Hub.
 */

const EdgeberryDeviceHubAppClient = require('../dist/app-client.js').default;

module.exports = function(RED) {
    "use strict";

    /**
     * Device Hub Input Node
     * Receives telemetry data, events, and status updates from devices
     */
    function DeviceHubInputNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Get the Device Hub configuration
        const hubConfig = RED.nodes.getNode(config.hub);
        if (!hubConfig) {
            node.error("No Device Hub configuration found");
            return;
        }

        // Configuration from node
        node.deviceIds = config.deviceIds ? config.deviceIds.split(',').map(id => id.trim()) : [];
        node.dataTypes = config.dataTypes || ['telemetry', 'events', 'status'];
        node.realtime = config.realtime !== false;

        let client = null;

        // Initialize client
        async function initializeClient() {
            try {
                client = new EdgeberryDeviceHubAppClient({
                    host: hubConfig.host,
                    port: parseInt(hubConfig.port),
                    secure: hubConfig.secure || false,
                    token: hubConfig.credentials?.apiKey || '',
                    enableWebSocket: node.realtime
                });

                await client.connect();
                node.status({fill: "green", shape: "dot", text: "connected"});

                // Set up event listeners for real-time data
                if (node.realtime) {
                    if (node.dataTypes.includes('telemetry')) {
                        client.on('telemetry', (data) => {
                            if (node.deviceIds.length === 0 || node.deviceIds.includes(data.deviceId)) {
                                node.send({
                                    topic: `telemetry/${data.deviceId}`,
                                    payload: data,
                                    deviceId: data.deviceId,
                                    dataType: 'telemetry'
                                });
                            }
                        });

                        // Subscribe to telemetry for specified devices
                        if (node.deviceIds.length > 0) {
                            client.subscribeToTelemetry(node.deviceIds);
                        }
                    }

                    if (node.dataTypes.includes('events')) {
                        client.on('device-event', (data) => {
                            if (node.deviceIds.length === 0 || node.deviceIds.includes(data.deviceId)) {
                                node.send({
                                    topic: `event/${data.deviceId}/${data.eventType}`,
                                    payload: data,
                                    deviceId: data.deviceId,
                                    dataType: 'event'
                                });
                            }
                        });
                    }

                    if (node.dataTypes.includes('status')) {
                        client.on('device-status', (data) => {
                            if (node.deviceIds.length === 0 || node.deviceIds.includes(data.deviceId)) {
                                node.send({
                                    topic: `status/${data.deviceId}`,
                                    payload: data,
                                    deviceId: data.deviceId,
                                    dataType: 'status'
                                });
                            }
                        });

                        // Subscribe to device status updates
                        client.subscribeToDeviceStatus(node.deviceIds.length > 0 ? node.deviceIds : undefined);
                    }

                    if (node.dataTypes.includes('twin')) {
                        client.on('twin-update', (data) => {
                            if (node.deviceIds.length === 0 || node.deviceIds.includes(data.deviceId)) {
                                node.send({
                                    topic: `twin/${data.deviceId}`,
                                    payload: data,
                                    deviceId: data.deviceId,
                                    dataType: 'twin'
                                });
                            }
                        });
                    }
                }

                client.on('disconnected', () => {
                    node.status({fill: "red", shape: "ring", text: "disconnected"});
                });

                client.on('websocket-error', (error) => {
                    node.warn(`WebSocket error: ${error.message}`);
                });

            } catch (error) {
                node.error(`Failed to connect to Device Hub: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "connection failed"});
            }
        }

        // Handle input messages for polling data
        node.on('input', async function(msg) {
            if (!client || !client.isConnected()) {
                node.error("Device Hub client not connected");
                return;
            }

            try {
                const action = msg.action || msg.topic;
                
                switch (action) {
                    case 'getDevices':
                        const devices = await client.getDevices(msg.query);
                        node.send({
                            topic: 'devices',
                            payload: devices,
                            dataType: 'devices'
                        });
                        break;

                    case 'getTelemetry':
                        const telemetry = await client.getTelemetry(msg.query || {
                            deviceId: msg.deviceId,
                            startTime: msg.startTime,
                            endTime: msg.endTime,
                            limit: msg.limit
                        });
                        node.send({
                            topic: 'telemetry',
                            payload: telemetry,
                            dataType: 'telemetry'
                        });
                        break;

                    case 'getDeviceEvents':
                        if (!msg.deviceId) {
                            node.error("deviceId required for getDeviceEvents");
                            return;
                        }
                        const events = await client.getDeviceEvents(msg.deviceId, msg.startTime, msg.endTime);
                        node.send({
                            topic: `events/${msg.deviceId}`,
                            payload: events,
                            deviceId: msg.deviceId,
                            dataType: 'events'
                        });
                        break;

                    case 'getDeviceTwin':
                        if (!msg.deviceId) {
                            node.error("deviceId required for getDeviceTwin");
                            return;
                        }
                        const twin = await client.getDeviceTwin(msg.deviceId);
                        node.send({
                            topic: `twin/${msg.deviceId}`,
                            payload: twin,
                            deviceId: msg.deviceId,
                            dataType: 'twin'
                        });
                        break;

                    case 'getStats':
                        const stats = await client.getDeviceStats();
                        node.send({
                            topic: 'stats',
                            payload: stats,
                            dataType: 'stats'
                        });
                        break;

                    default:
                        node.warn(`Unknown action: ${action}`);
                }
            } catch (error) {
                node.error(`Failed to execute action: ${error.message}`);
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

    /**
     * Device Hub Output Node
     * Sends commands and updates to devices
     */
    function DeviceHubOutputNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Get the Device Hub configuration
        const hubConfig = RED.nodes.getNode(config.hub);
        if (!hubConfig) {
            node.error("No Device Hub configuration found");
            return;
        }

        // Store configured device ID
        node.configuredDeviceId = config.deviceId;

        let client = null;

        // Initialize client
        async function initializeClient() {
            try {
                client = new EdgeberryDeviceHubAppClient({
                    host: hubConfig.host,
                    port: parseInt(hubConfig.port),
                    secure: hubConfig.secure || false,
                    token: hubConfig.credentials?.apiKey || '',
                    enableWebSocket: false // Output node doesn't need WebSocket
                });

                await client.connect();
                node.status({fill: "green", shape: "dot", text: "connected"});

                client.on('disconnected', () => {
                    node.status({fill: "red", shape: "ring", text: "disconnected"});
                });

            } catch (error) {
                node.error(`Failed to connect to Device Hub: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "connection failed"});
            }
        }

        // Handle input messages for sending commands
        node.on('input', async function(msg) {
            if (!client || !client.isConnected()) {
                node.error("Device Hub client not connected");
                return;
            }

            try {
                const action = msg.action || msg.topic;
                
                // Use msg.deviceId or fall back to configured deviceId
                const deviceId = msg.deviceId || node.configuredDeviceId;
                
                switch (action) {
                    case 'callDirectMethod':
                        if (!deviceId || !msg.methodName) {
                            node.error("deviceId and methodName required for callDirectMethod");
                            return;
                        }
                        const response = await client.callDirectMethod({
                            deviceId: deviceId,
                            methodName: msg.methodName,
                            payload: msg.payload,
                            timeout: msg.timeout
                        });
                        
                        // Send response back
                        node.send({
                            topic: `method-response/${deviceId}/${msg.methodName}`,
                            payload: response,
                            deviceId: deviceId,
                            methodName: msg.methodName
                        });
                        break;

                    case 'updateDeviceTwin':
                        if (!deviceId || !msg.desired) {
                            node.error("deviceId and desired properties required for updateDeviceTwin");
                            return;
                        }
                        await client.updateDeviceTwin(deviceId, msg.desired);
                        
                        // Send confirmation
                        node.send({
                            topic: `twin-updated/${deviceId}`,
                            payload: { success: true, desired: msg.desired },
                            deviceId: deviceId
                        });
                        break;

                    default:
                        node.warn(`Unknown action: ${action}`);
                }
            } catch (error) {
                node.error(`Failed to execute action: ${error.message}`);
                
                // Send error response
                node.send({
                    topic: 'error',
                    payload: { error: error.message, action: msg.action },
                    error: true
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

    /**
     * Device Hub Configuration Node
     * Stores connection settings for Device Hub
     */
    function DeviceHubConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        this.host = n.host;
        this.port = n.port;
        this.secure = n.secure;
        
        // Build baseUrl from host and port
        const protocol = this.secure ? 'https' : 'http';
        this.baseUrl = `${protocol}://${this.host}:${this.port}`;
        
        // Credentials are stored separately by Node-RED
        if (this.credentials) {
            this.username = this.credentials.username;
            this.password = this.credentials.password;
            this.apiKey = this.credentials.apiKey;
        }
    }

    // Register the nodes
    RED.nodes.registerType("devicehub-in", DeviceHubInputNode);
    RED.nodes.registerType("devicehub-out", DeviceHubOutputNode);
    RED.nodes.registerType("devicehub-config", DeviceHubConfigNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" },
            apiKey: { type: "password" }
        }
    });
};
