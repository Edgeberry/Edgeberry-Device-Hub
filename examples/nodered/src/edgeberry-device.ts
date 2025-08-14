import type { Node, NodeAPI, NodeDef } from 'node-red';

interface EdgeberryDeviceNodeDef extends NodeDef {
  host: string;
  uuid: string;
}

module.exports = function (RED: NodeAPI) {
  function EdgeberryDeviceNode(this: Node, config: EdgeberryDeviceNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;

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
      node.log('[Edgeberry device] hello world');
      // For now we simply forward the message unchanged.
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
