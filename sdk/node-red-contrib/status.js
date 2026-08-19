/**
 * The one status badge, rendered identically by every node that watches a
 * device: the device node and both endpoint nodes.
 *
 * The badge always describes *the device*, never the node's own role, so the
 * same device reads the same way wherever it appears in a flow. What the node
 * is for - which topic it carries, which direction it points - is already in
 * its label, and repeating it here would cost the one line that says whether
 * the thing on the other end is actually there.
 *
 * Order matters. Hub trouble takes over the badge, because while the hub is
 * unreachable the device's state cannot be observed at all and a remembered
 * "online" would be a guess. Only once the hub is known good does the device's
 * own state mean anything.
 */

/**
 * @param {object} hubConfig  the devicehub-config node this node belongs to
 * @param {string} deviceName the device this node addresses
 * @returns {{fill: string, shape: string, text: string}} a Node-RED status
 */
function deviceStatus(hubConfig, deviceName) {
    const hub = hubConfig.getHubState();

    if (hub === 'connecting' || hub === 'idle') {
        return { fill: 'yellow', shape: 'ring', text: 'connecting to hub' };
    }
    if (hub === 'down') {
        return { fill: 'red', shape: 'ring', text: 'hub unreachable' };
    }

    switch (hubConfig.getDeviceState(deviceName)) {
        case 'online':
            return { fill: 'green', shape: 'dot', text: `${deviceName}: online` };
        case 'offline':
            return { fill: 'red', shape: 'ring', text: `${deviceName}: offline` };
        // The hub answered, and has no such device. Almost always a typo in the
        // Device field - the name is free text, and nothing else in the flow
        // would ever say so: the node looks configured, and only the first
        // message fails, with a "Device not found" that names no node.
        case 'absent':
            return { fill: 'red', shape: 'ring', text: `unknown device: ${deviceName}` };
        // Hub reachable, but it has not been asked yet.
        default:
            return { fill: 'grey', shape: 'ring', text: `${deviceName}: unknown` };
    }
}

module.exports = { deviceStatus };
