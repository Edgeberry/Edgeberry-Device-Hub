/**
 * Edgeberry Device (Node-RED example)
 * ---------------------------------------------
 * Minimal node that:
 * - Requires configuration: host (Device Hub URL), uuid (device id), and a credential token
 * - Shows status 'ready' when configured; otherwise 'missing settings'
 * - Logs "hello world" on each input and forwards the message unchanged
 */
import type { Node, NodeAPI, NodeDef } from 'node-red';

// Configuration fields defined in the node's HTML (defaults section)
interface EdgeberryDeviceNodeDef extends NodeDef {
  host: string;
  uuid: string;
}

module.exports = function (RED: NodeAPI) {
  function EdgeberryDeviceNode(this: Node, config: EdgeberryDeviceNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Pull settings from config and credentials
    const host = (config.host || '').trim();
    const uuid = (config.uuid || '').trim();
    const token = String(((node as any).credentials?.token) || '').trim();

    if (!host || !uuid || !token) {
      node.status({ fill: 'red', shape: 'ring', text: 'missing settings' });
      node.warn('Edgeberry device: please configure host, device UUID, and host access token');
    } else {
      node.status({ fill: 'green', shape: 'dot', text: 'ready' });
    }

    node.on('input', function (msg) {
      // MVP behavior: just log and pass through the message
      node.log('[Edgeberry device] hello world');
      node.send(msg);
    });

    node.on('close', function () {
      // cleanup if needed
    });
  }

  RED.nodes.registerType('edgeberry-device', EdgeberryDeviceNode, {
    credentials: {
      token: { type: 'password' }
    }
  });
};
