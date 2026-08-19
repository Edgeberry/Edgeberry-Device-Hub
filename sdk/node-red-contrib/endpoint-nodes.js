/**
 * Endpoint nodes for the Edgeberry bridge - cloud side.
 *
 * A matching pair exists on the device (@edgeberry/device-node-red-contrib).
 * Between them a message keeps its shape: what a flow sends on one side is what
 * the flow on the other side receives.
 *
 *   [ ->  from device ]   messages arriving from a device
 *   [ <-  to device   ]   messages sent to a device
 *
 * The contract is `msg.topic` + `msg.payload`, carried in a small envelope so
 * that no value is reshaped in transit:
 *
 *   { eb: { v: 1, topic, timestamp, payload } }
 *
 * It is nested under one key rather than spread across the message because the
 * device Core wraps outbound data as { deviceId, timestamp, ...yours } - a
 * top-level `timestamp` of ours would silently replace the one it stamps.
 *
 * The envelope also travels well: `payload` holds any JSON value, so `true`,
 * `0` and `null` arrive as themselves rather than collapsing, which is what
 * happens to a primitive spread into an object.
 */

const ENVELOPE_VERSION = 1;

const { deviceStatus } = require('./status');

module.exports = function(RED) {
    "use strict";

    /**
     * Match a received topic against a node's configured one.
     *
     * Exact by default. `*` takes everything, and a trailing `*` matches a
     * prefix - enough to build one catch-all node for debugging without
     * needing a node per topic.
     */
    function topicMatches(configured, received) {
        if (typeof received !== 'string') return false;
        if (!configured || configured === '*') return true;
        if (configured.endsWith('*')) return received.startsWith(configured.slice(0, -1));
        return configured === received;
    }

    /** Build the wire envelope, stamping the parts the flow left out. */
    function pack(node, msg) {
        // The node is the endpoint, so its configured topic is authoritative.
        // A message arriving with a different one is a wiring mistake worth
        // saying out loud rather than passing along silently.
        if (msg.topic && msg.topic !== node.topic) {
            node.warn(`topic "${msg.topic}" overridden with this endpoint's topic "${node.topic}"`);
        }
        return {
            eb: {
                v: ENVELOPE_VERSION,
                topic: node.topic,
                // Stamped once, at the origin, and never rewritten downstream:
                // the receiving flow sees when the message was sent, not when
                // it happened to arrive.
                timestamp: msg.timestamp || new Date().toISOString(),
                payload: msg.payload === undefined ? null : msg.payload
            }
        };
    }

    /** Read an envelope out of whatever the client handed us, or null. */
    function unpack(data) {
        // Telemetry arrives as { deviceId, timestamp, data: { ...published } },
        // and the envelope rides inside the published body.
        const body = (data && data.data) || data;
        const eb = body && body.eb;
        if (!eb || typeof eb !== 'object' || typeof eb.topic !== 'string') return null;
        return eb;
    }

    /**
     * from device - messages arriving from a device, filtered to one topic.
     */
    function FromDeviceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const hubConfig = RED.nodes.getNode(config.hub);
        if (!hubConfig) {
            node.error("No Device Hub configuration found");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }

        node.deviceName = config.deviceName;
        node.topic = config.topic;

        if (!node.deviceName) {
            node.error("Device is required");
            node.status({fill: "red", shape: "ring", text: "no device"});
            return;
        }

        function renderStatus() {
            node.status(deviceStatus(hubConfig, node.deviceName));
        }

        const unregister = hubConfig.register(node.deviceName, {
            onMessage(kind, data) {
                const eb = unpack(data);
                if (!eb) return;                                   // ordinary telemetry, not ours
                if (!topicMatches(node.topic, eb.topic)) return;   // another endpoint's traffic
                node.send({
                    topic: eb.topic,
                    payload: eb.payload,
                    timestamp: eb.timestamp,
                    deviceName: node.deviceName
                });
            },
            onStateChange: renderStatus
        });

        node.on('close', function() {
            unregister();
        });
    }

    /**
     * to device - send a message to a device under this endpoint's topic.
     */
    function ToDeviceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const hubConfig = RED.nodes.getNode(config.hub);
        if (!hubConfig) {
            node.error("No Device Hub configuration found");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }

        node.deviceName = config.deviceName;
        node.topic = config.topic;

        if (!node.deviceName) {
            node.error("Device is required");
            node.status({fill: "red", shape: "ring", text: "no device"});
            return;
        }
        if (!node.topic || node.topic.includes('*')) {
            node.error("A concrete topic is required to send (wildcards are for receiving)");
            node.status({fill: "red", shape: "ring", text: "no topic"});
            return;
        }

        // This direction only sends, but the badge still reports the device -
        // nothing queues, so an offline or misnamed device means the next
        // message is dropped, and that is worth seeing before it happens.
        function renderStatus() {
            node.status(deviceStatus(hubConfig, node.deviceName));
        }

        // Registers for state only; there is nothing to receive here.
        const unregister = hubConfig.register(node.deviceName, {
            onMessage() { /* outbound endpoint; nothing to receive */ },
            onStateChange: renderStatus
        });

        node.on('input', async function(msg, send, done) {
            const client = hubConfig.getClient();
            if (!client || !client.isConnected()) {
                // Nothing queues for a hub we cannot reach, so say so rather
                // than letting the message disappear quietly.
                const err = new Error('Not connected to Device Hub - message dropped');
                if (done) done(err); else node.error(err.message, msg);
                return;
            }
            try {
                await client.sendMessageToDevice(node.deviceName, pack(node, msg));
                if (done) done();
            } catch (error) {
                if (done) done(error); else node.error(error.message, msg);
            }
        });

        node.on('close', function() {
            unregister();
        });
    }

    RED.nodes.registerType("devicehub-from-device", FromDeviceNode);
    RED.nodes.registerType("devicehub-to-device", ToDeviceNode);
};
