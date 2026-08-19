/**
 * Node-RED Device Node for Edgeberry Device Hub
 * 
 * This node represents a single device connected to Device Hub.
 * - Inputs: Commands/messages to send to the device
 * - Outputs: Telemetry, events, and status updates from the device
 */

const DeviceHubAppClient = require('@edgeberry/devicehub-app-client').default;
const { deviceStatus } = require('./status');

module.exports = function(RED) {
    "use strict";

    /**
     * Device Hub Configuration Node
     *
     * Owns the single connection to a Device Hub, shared by every device node
     * that references it.
     *
     * This used to hold settings only, and each device node opened a connection
     * of its own. That made the socket count scale with the *flow* rather than
     * the fleet: a device appearing in three nodes meant three sockets watching
     * it, three authentications, three reconnect loops and three copies of every
     * status poll. The hub already addresses this - its subscription model is a
     * set of devices per connection - so the fan-out belongs here, on one
     * socket, with device nodes as subscribers to it.
     */
    function DeviceHubConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name;
        node.host = config.host;
        node.port = config.port;
        node.secure = config.secure;

        // Build baseUrl from host and port
        const protocol = node.secure ? 'https' : 'http';
        node.baseUrl = `${protocol}://${node.host}:${node.port}`;

        // deviceId -> Set of subscriber callbacks. A device may legitimately
        // appear in several nodes, so each id maps to many subscribers.
        const subscribers = new Map();
        let client = null;
        let hubState = 'idle';      // 'idle' | 'connecting' | 'up' | 'down'
        let pollTimer = null;
        // deviceId -> 'online' | 'offline' | 'absent' | 'unknown'
        //
        // 'absent' and 'unknown' are deliberately not the same thing. 'unknown'
        // means we have not asked yet; 'absent' means we asked, the hub
        // answered, and it has no device by that name. Collapsing the two hid a
        // mistyped Device field behind a badge that looked merely uninitialised.
        const deviceState = new Map();

        // Device online status is derived from heartbeats the device sends every
        // 30s, so it is never fresher than that. One poll now covers every
        // device on this hub rather than one poll per node.
        const STATUS_POLL_MS = 15000;

        node.getHubState = () => hubState;
        node.getDeviceState = (deviceId) => deviceState.get(deviceId) || 'unknown';
        node.getClient = () => client;

        function notify(deviceId) {
            const set = subscribers.get(deviceId);
            if (set) for (const sub of set) sub.onStateChange();
        }

        function notifyAll() {
            for (const set of subscribers.values()) {
                for (const sub of set) sub.onStateChange();
            }
        }

        function setHubState(next) {
            if (hubState === next) return;
            hubState = next;
            // What we knew about each device was only true while we could see it.
            if (next !== 'up') deviceState.clear();
            notifyAll();
        }

        function setDeviceState(deviceId, next) {
            if (deviceState.get(deviceId) === next) return;
            deviceState.set(deviceId, next);
            // Said once, on the transition, rather than on every poll - and once
            // for the hub rather than once per node referencing the device.
            if (next === 'absent') {
                node.warn(`No device named "${deviceId}" on this hub - check the Device field for a typo`);
            }
            if (hubState === 'up') notify(deviceId);
        }

        function readStatusValue(value) {
            if (value === 'online' || value === true) return 'online';
            if (value === 'offline' || value === false) return 'offline';
            return null;
        }

        function deliver(kind, data) {
            const deviceId = data && (data.deviceId || data.device_id);
            if (!deviceId) return;
            // Anything arriving from a device is proof it is alive.
            if (kind === 'status') {
                const reported = readStatusValue(data.status);
                if (reported) setDeviceState(deviceId, reported);
            } else {
                setDeviceState(deviceId, 'online');
            }
            const set = subscribers.get(deviceId);
            if (set) for (const sub of set) sub.onMessage(kind, data);
        }

        // The hub replaces the device set on each subscribe rather than adding
        // to it, so the whole union goes out every time it changes - and again
        // after any reconnect, since a new socket carries no subscriptions.
        function pushSubscription() {
            if (!client || hubState !== 'up') return;
            const ids = Array.from(subscribers.keys());
            if (ids.length === 0) return;
            client.subscribeToDevices(ids);
            node.log(`Subscribed to ${ids.length} device(s): ${ids.join(', ')}`);
        }

        /**
         * Ask the hub about every device this connection cares about, in one
         * request. This is the only thing that reports a device going *offline*:
         * silence from a dead device is not an event anyone can push.
         */
        async function refreshDeviceStates() {
            if (!client || hubState !== 'up' || subscribers.size === 0) return;
            try {
                const devices = await client.getDevices();
                const seen = new Set();
                for (const info of devices || []) {
                    // A node may name a device by role or by raw name; accept both.
                    for (const id of [info.deviceId, info.deviceName, info.role]) {
                        if (id && subscribers.has(id)) {
                            setDeviceState(id, readStatusValue(info.status) || 'unknown');
                            seen.add(id);
                        }
                    }
                }
                // Subscribed to something the hub does not list: it does not exist.
                for (const id of subscribers.keys()) {
                    if (!seen.has(id)) setDeviceState(id, 'absent');
                }
            } catch (error) {
                // Failing to ask says nothing about the devices - only that the
                // question did not get through.
                node.debug(`Could not refresh device states: ${error.message}`);
            }
        }

        function startPolling() {
            if (pollTimer) return;
            pollTimer = setInterval(refreshDeviceStates, STATUS_POLL_MS);
        }

        function stopPolling() {
            if (!pollTimer) return;
            clearInterval(pollTimer);
            pollTimer = null;
        }

        function connect() {
            if (client) return;

            if (!node.credentials || !node.credentials.token) {
                node.error('Access token is required in Device Hub config');
                setHubState('down');
                return;
            }

            client = new DeviceHubAppClient({
                host: node.host,
                port: parseInt(node.port),
                secure: node.secure || false,
                token: node.credentials.token,
                enableWebSocket: true
            });

            setHubState('connecting');

            client.on('telemetry', (data) => deliver('telemetry', data));
            client.on('event',     (data) => deliver('event', data));
            client.on('status',    (data) => deliver('status', data));
            client.on('twin',      (data) => deliver('twin', data));

            client.on('websocket-connected', () => {
                setHubState('up');
                pushSubscription();
                refreshDeviceStates();
                startPolling();
            });

            client.on('websocket-disconnected', () => {
                stopPolling();
                setHubState('down');
            });

            // 'websocket-error', not 'error': the client emits no bare 'error'
            // event, so a listener on that name could never fire.
            client.on('websocket-error', (error) => {
                node.warn(`Device Hub connection error: ${error && error.message ? error.message : error}`);
                stopPolling();
                setHubState('down');
            });

            client.on('disconnected', () => {
                stopPolling();
                setHubState('down');
            });

            client.connect().catch((error) => {
                node.error(`Failed to connect to Device Hub: ${error.message}`);
                stopPolling();
                setHubState('down');
            });
        }

        async function disconnect() {
            stopPolling();
            const c = client;
            client = null;
            hubState = 'idle';
            deviceState.clear();
            if (c) {
                try { await c.disconnect(); } catch (_e) { /* shutting down anyway */ }
            }
        }

        /**
         * Register a device node's interest in a device.
         *
         * The connection is opened by the first registration and closed by the
         * last, so a hub with no device nodes referencing it holds no socket.
         */
        node.register = function(deviceId, subscriber) {
            if (!subscribers.has(deviceId)) subscribers.set(deviceId, new Set());
            subscribers.get(deviceId).add(subscriber);

            connect();
            pushSubscription();
            // A late joiner gets the state already known for its device.
            subscriber.onStateChange();

            return function unregister() {
                const set = subscribers.get(deviceId);
                if (!set) return;
                set.delete(subscriber);
                if (set.size === 0) {
                    subscribers.delete(deviceId);
                    deviceState.delete(deviceId);
                }
                if (subscribers.size === 0) disconnect();
                else pushSubscription();
            };
        };

        node.on('close', async function() {
            subscribers.clear();
            await disconnect();
        });
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

        // Rendered from the two facts the config node owns: whether the hub is
        // reachable, and what it knows about this device. Shared with the
        // endpoint nodes so one device reads the same way everywhere.
        function renderStatus() {
            node.status(deviceStatus(hubConfig, node.deviceName));
        }

        // Inbound traffic for this device, fanned out from the shared socket.
        function onMessage(kind, data) {
            if (kind === 'telemetry') {
                node.send({
                    topic: `telemetry/${node.deviceName}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'telemetry'
                });
            } else if (kind === 'event') {
                node.send({
                    topic: `event/${node.deviceName}/${data.eventType || 'unknown'}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'event'
                });
            } else if (kind === 'status') {
                node.send({
                    topic: `status/${node.deviceName}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'status'
                });
            } else if (kind === 'twin') {
                node.send({
                    topic: `twin/${node.deviceName}`,
                    payload: data,
                    deviceName: node.deviceName,
                    messageType: 'twin'
                });
            }
        }

        const unregister = hubConfig.register(node.deviceName, {
            onMessage,
            onStateChange: renderStatus
        });


        // Handle input messages (commands to device)
        node.on('input', async function(msg) {
            // Borrowed from the config node rather than held: the connection is
            // shared, and a reference cached here would go stale on reconnect.
            const client = hubConfig.getClient();
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

                    case 'sendMessage':
                    case 'message':
                        if (!msg.payload) {
                            node.error("payload required for sendMessage");
                            return;
                        }
                        
                        await client.sendMessageToDevice(node.deviceName, msg.payload);
                        
                        node.send({
                            topic: `message-sent/${node.deviceName}`,
                            payload: { success: true },
                            deviceName: node.deviceName,
                            messageType: 'message-confirm'
                        });
                        break;

                    default:
                        node.warn(`Unknown action: ${action}. Use 'method', 'twin', or 'message'.`);
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

        // Cleanup on close. Only this node's interest is dropped; the shared
        // connection closes once the last device node lets go of it.
        node.on('close', function() {
            unregister();
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
