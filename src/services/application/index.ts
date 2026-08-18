/**
 * Application sub-service - REST API and WebSocket interface for external
 * applications (Node-RED, dashboards, ...) to interact with the Device Hub
 * and connected devices. Runs its own HTTP server on APPLICATION_PORT
 * (8090) - deliberately separate from the admin server on 3000 so one can
 * be exposed without the other at the network/nginx level.
 *
 * Ported from the standalone application-service; all data access goes
 * directly into the shared stores (devices-store/token-store/event-store/
 * twin-store) as plain function calls.
 *
 * Features:
 * - Token-based authentication
 * - REST API for device management
 * - Real-time WebSocket telemetry streaming with device-specific subscriptions
 * - Direct method invocation to devices
 * - Batch operations
 */

import express, { Request, Response, NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { EventEmitter } from 'eventemitter3';
import http from 'http';
import mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';
import { APPLICATION_PORT, MQTT_URL } from '../../config.js';
import { getDevicesListSync, getDeviceByUuid, resolveIdentifierToUuid, resolvePublicIdFromUuid, getDeviceGroups, listGroups, normalizeGroups } from '../../devices-store.js';
import { verifyToken } from '../../token-store.js';
import { recordEvent, queryEvents } from '../../event-store.js';
import { getTwin } from '../../twin-store.js';

const SERVICE = 'application';

// Service instance
const app = express();
const server = http.createServer(app);
const eventEmitter = new EventEmitter();

// WebSocket server for real-time communication
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

// Connected clients with their subscriptions
interface AuthenticatedClient {
  ws: WebSocket;
  tokenId: string;
  appName: string;
  subscriptions: {
    topics: Set<string>;       // Topic types (telemetry, events, status, etc.)
    devices: Set<string>;      // Specific device IDs or '*' for all
    groups: Set<string>;       // Group names, matched exactly; additive to `devices`
  };
}

const clients = new Map<WebSocket, AuthenticatedClient>();

// MQTT client for device communication
let mqttClient: mqtt.MqttClient | null = null;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Token authentication middleware
function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const result = verifyToken(token);
  if (!result.ok || !result.token) {
    res.status(401).json({ error: result.error || 'Invalid token' });
    return;
  }

  // Attach token info to request
  (req as any).apiToken = result.token;

  next();
}

// Connect to MQTT broker
function connectMqtt() {
  console.log(`[${SERVICE}] Connecting to MQTT broker at ${MQTT_URL}...`);

  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: `application-service-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000
  });

  mqttClient.on('connect', () => {
    console.log(`[${SERVICE}] Connected to MQTT broker`);

    // Subscribe to device telemetry and status topics
    mqttClient?.subscribe([
      '$devicehub/devices/+/telemetry',
      '$devicehub/devices/+/status',
      '$devicehub/devices/+/twin/reported',
      '$devicehub/devices/+/events/+',
      '$devicehub/devices/+/methods/+/response'
    ]);
  });

  mqttClient.on('message', (topic: string, payload: Buffer) => {
    try {
      handleMqttMessage(topic, payload.toString());
    } catch (e: any) {
      console.error(`[${SERVICE}] Failed to handle MQTT message:`, e?.message || e);
    }
  });

  mqttClient.on('error', (err) => {
    console.error(`[${SERVICE}] MQTT error:`, err.message);
  });
}

// Handle incoming MQTT messages
function handleMqttMessage(topic: string, payload: string) {
  try {
    const topicParts = topic.split('/');
    const deviceId = topicParts[2];
    const messageType = topicParts[3];

    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      data = payload;
    }

    // Add deviceId to the data
    const messageData = {
      deviceId,
      ...data
    };

    // Handle method responses.
    // Topic: $devicehub/devices/{name}/methods/{methodName}/response
    //   index:  0          1       2        3        4            5
    // The trailing segment is index 5 - index 4 is the method name, so
    // testing index 4 for 'response' never matched and every direct method
    // call timed out waiting for a reply that had in fact already arrived.
    if (messageType === 'methods' && topicParts[5] === 'response') {
      const requestId = data.requestId;
      if (requestId) {
        eventEmitter.emit(`method-response-${requestId}`, data);
      }
    }

    // Persist device-originated telemetry and events so the history endpoints
    // (GET /api/telemetry, GET /api/devices/:id/events) can actually serve
    // them. Devices only ever publish over MQTT - without this, the only
    // stored telemetry would be whatever an application POSTed back through
    // the REST ingest path, and querying a real device's history returns
    // nothing.
    if (messageType === 'telemetry' || messageType === 'events') {
      const uuid = resolveIdentifierToUuid(deviceId);
      if (uuid) {
        const eventType = messageType === 'telemetry' ? 'telemetry' : (topicParts[4] || 'event');
        const stored = recordEvent(uuid, eventType, data);
        if (!stored.ok) {
          console.warn(`[${SERVICE}] failed to persist ${eventType} for ${deviceId}: ${stored.error}`);
        }
      }
    }

    // Broadcast to WebSocket clients based on their subscriptions
    broadcastToSubscribers(messageType, messageData);

  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to handle MQTT message:`, e.message);
  }
}

// Broadcast to WebSocket subscribers.
function broadcastToSubscribers(topic: string, data: any) {
  // As parsed from the MQTT topic segment - for a claimed device this is
  // always its raw MQTT name (topic segment %c), never its uuid, since
  // devices publish under their own assigned name (see the masked-identity
  // provisioning design in devices-store.ts). Resolving it to a uuid once
  // here, up front, means every subscription comparison below compares
  // uuid-to-uuid instead of accidentally comparing a uuid against a raw
  // name.
  const rawDeviceId = data.deviceId || data.device_id;
  const deviceUuid = rawDeviceId ? resolveIdentifierToUuid(rawDeviceId) : null;

  const publicDeviceId = deviceUuid ? resolvePublicIdFromUuid(deviceUuid) : rawDeviceId;

  // This device's groups, looked up at most once per message and only if some
  // client actually subscribed by group - most deployments won't, and this is
  // the hot path for every telemetry message in the fleet.
  let cachedGroups: string[] | null = null;
  const deviceGroups = (): string[] => {
    if (cachedGroups === null) cachedGroups = deviceUuid ? getDeviceGroups(deviceUuid) : [];
    return cachedGroups;
  };

  for (const client of clients.values()) {
    // Check if client is subscribed to this topic
    if (!client.subscriptions.topics.has(topic) && !client.subscriptions.topics.has('*')) {
      continue;
    }

    // Check if client is subscribed to this device
    if (rawDeviceId && !client.subscriptions.devices.has('*')) {
      // Cheap fast-path: client subscribed with the exact raw identifier.
      let isSubscribed = client.subscriptions.devices.has(rawDeviceId);

      // Otherwise, resolve each subscribed identifier (uuid, role, or raw
      // name) to a uuid and compare against this message's device uuid.
      if (!isSubscribed && deviceUuid) {
        for (const subscribedDevice of client.subscriptions.devices) {
          if (resolveIdentifierToUuid(subscribedDevice) === deviceUuid) {
            isSubscribed = true;
            break;
          }
        }
      }

      // Group subscriptions are additive to device subscriptions: a client
      // that subscribed to "cold-storage" receives every device in it without
      // having to name them, including ones added to the group later.
      if (!isSubscribed && client.subscriptions.groups.size > 0) {
        for (const g of deviceGroups()) {
          if (client.subscriptions.groups.has(g)) {
            isSubscribed = true;
            break;
          }
        }
      }

      if (!isSubscribed) {
        continue;
      }
    }

    try {
      client.ws.send(JSON.stringify({
        type: 'message',
        topic,
        // Role, if assigned, else raw MQTT name, else the uuid - never the
        // raw uuid alone when something more stable/readable is available.
        // Role takes precedence so a hardware swap behind a role is
        // invisible to subscribers: they keep seeing the same deviceId
        // across the swap.
        deviceId: publicDeviceId,
        data
      }));
    } catch (e) {
      console.error(`[${SERVICE}] Failed to send to WebSocket client:`, e);
    }
  }
}

// WebSocket connection handler
wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.send(JSON.stringify({ type: 'error', message: 'No token provided' }));
    ws.close(1008, 'No token provided');
    return;
  }

  const result = verifyToken(token);
  if (!result.ok || !result.token) {
    ws.send(JSON.stringify({ type: 'error', message: result.error || 'Invalid token' }));
    ws.close(1008, 'Invalid token');
    return;
  }
  const tokenData = result.token;

  // Register authenticated client
  const client: AuthenticatedClient = {
    ws,
    tokenId: tokenData.id,
    appName: tokenData.name,
    subscriptions: {
      topics: new Set(),
      devices: new Set(),
      groups: new Set()
    }
  };
  clients.set(ws, client);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: `Connected as ${tokenData.name}`,
    timestamp: new Date().toISOString()
  }));

  console.log(`[${SERVICE}] WebSocket client connected: ${tokenData.name}`);

  // Handle client messages
  ws.on('message', (message: string) => {
    handleWebSocketMessage(client, message.toString());
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[${SERVICE}] WebSocket client disconnected: ${client.appName}`);
  });

  ws.on('error', (err) => {
    console.error(`[${SERVICE}] WebSocket error for ${client.appName}:`, err.message);
  });
});

// Handle WebSocket messages from clients
function handleWebSocketMessage(client: AuthenticatedClient, message: string) {
  try {
    const msg = JSON.parse(message);

    switch (msg.type) {
      case 'subscribe': {
        if (msg.topics && Array.isArray(msg.topics)) {
          msg.topics.forEach((topic: string) => client.subscriptions.topics.add(topic));
        }
        const hasDevices = Array.isArray(msg.devices);
        const hasGroups = msg.groups !== undefined;
        if (hasGroups) {
          // Accepts a bare string or an array, same as the admin API.
          const normalized = normalizeGroups(msg.groups);
          if (!normalized.ok) {
            client.ws.send(JSON.stringify({ type: 'error', message: normalized.error }));
            return;
          }
          client.subscriptions.groups.clear();
          (normalized.groups || []).forEach(g => client.subscriptions.groups.add(g));
        }
        if (hasDevices) {
          // Clear previous device subscriptions and add new ones
          client.subscriptions.devices.clear();
          msg.devices.forEach((device: string) => client.subscriptions.devices.add(device));
        } else if (!hasGroups) {
          // Fall back to "everything" only when the client narrowed by
          // nothing at all - a group-only subscription means the group, not
          // the whole fleet.
          client.subscriptions.devices.add('*');
        }
        console.log(`[${SERVICE}] Client ${client.appName} subscribed to topics=${Array.from(client.subscriptions.topics)}, devices=${Array.from(client.subscriptions.devices)}, groups=${Array.from(client.subscriptions.groups)}`);
        client.ws.send(JSON.stringify({
          type: 'subscribed',
          topics: msg.topics,
          devices: Array.from(client.subscriptions.devices),
          groups: Array.from(client.subscriptions.groups)
        }));
        break;
      }

      case 'unsubscribe':
        if (msg.topics && Array.isArray(msg.topics)) {
          msg.topics.forEach((topic: string) => client.subscriptions.topics.delete(topic));
        }
        if (msg.devices && Array.isArray(msg.devices)) {
          msg.devices.forEach((device: string) => client.subscriptions.devices.delete(device));
        }
        if (msg.groups !== undefined) {
          const normalized = normalizeGroups(msg.groups);
          (normalized.groups || []).forEach(g => client.subscriptions.groups.delete(g));
        }
        client.ws.send(JSON.stringify({
          type: 'unsubscribed',
          topics: msg.topics,
          devices: msg.devices,
          groups: msg.groups
        }));
        break;

      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'callMethod':
        handleMethodCall(client, msg);
        break;

      case 'sendMessage':
        handleSendMessage(client, msg);
        break;

      default:
        client.ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${msg.type}`
        }));
    }
  } catch (e: any) {
    client.ws.send(JSON.stringify({
      type: 'error',
      message: 'Invalid message format'
    }));
    console.error(`[${SERVICE}] Failed to handle WebSocket message:`, e.message);
  }
}

// Handle method call via WebSocket
function handleMethodCall(client: AuthenticatedClient, msg: any) {
  const { deviceId, methodName, payload, requestId } = msg;

  if (!deviceId || !methodName) {
    client.ws.send(JSON.stringify({
      type: 'methodResponse',
      requestId,
      error: 'deviceId and methodName required'
    }));
    return;
  }

  if (!mqttClient || !mqttClient.connected) {
    client.ws.send(JSON.stringify({
      type: 'methodResponse',
      requestId,
      error: 'MQTT broker not connected'
    }));
    return;
  }

  // Resolve to the device's MQTT name - the namespace it actually listens on
  const mqttName = resolveDeviceMqttName(deviceId);

  if (!mqttName) {
    client.ws.send(JSON.stringify({
      type: 'methodResponse',
      requestId,
      error: 'Device not found'
    }));
    return;
  }

  console.log(`[${SERVICE}] WebSocket method call: ${methodName} on device ${deviceId} (${mqttName})`);

  // Set up response listener with timeout
  const timeout = setTimeout(() => {
    eventEmitter.off(`method-response-${requestId}`, responseHandler);
    client.ws.send(JSON.stringify({
      type: 'methodResponse',
      requestId,
      error: 'Method call timeout'
    }));
  }, 30000);

  const responseHandler = (response: any) => {
    clearTimeout(timeout);
    client.ws.send(JSON.stringify({
      type: 'methodResponse',
      requestId,
      status: response.status || 200,
      payload: response.payload,
      message: response.message
    }));
  };

  eventEmitter.once(`method-response-${requestId}`, responseHandler);

  mqttClient.publish(
    `$devicehub/devices/${mqttName}/methods/${methodName}/request`,
    JSON.stringify({
      requestId,
      methodName,
      payload
    }),
    { qos: 1 }
  );
}

// Handle sendMessage via WebSocket
function handleSendMessage(client: AuthenticatedClient, msg: any) {
  const { deviceId, payload, messageId } = msg;

  if (!deviceId || !payload) {
    client.ws.send(JSON.stringify({
      type: 'messageResponse',
      messageId,
      error: 'deviceId and payload required'
    }));
    return;
  }

  if (!mqttClient || !mqttClient.connected) {
    client.ws.send(JSON.stringify({
      type: 'messageResponse',
      messageId,
      error: 'MQTT broker not connected'
    }));
    return;
  }

  // Resolve to the device's MQTT name - the namespace it actually listens on
  const mqttName = resolveDeviceMqttName(deviceId);

  if (!mqttName) {
    client.ws.send(JSON.stringify({
      type: 'messageResponse',
      messageId,
      error: 'Device not found'
    }));
    return;
  }

  console.log(`[${SERVICE}] Sending cloud-to-device message to ${deviceId} (${mqttName})`);

  // Publish message to device
  mqttClient.publish(
    `$devicehub/devices/${mqttName}/messages/devicebound`,
    JSON.stringify(payload),
    { qos: 1 },
    (err) => {
      if (err) {
        client.ws.send(JSON.stringify({
          type: 'messageResponse',
          messageId,
          error: 'Failed to send message'
        }));
      } else {
        client.ws.send(JSON.stringify({
          type: 'messageResponse',
          messageId,
          success: true
        }));
      }
    }
  );
}

// ============ REST API ENDPOINTS ============

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: SERVICE,
    timestamp: new Date().toISOString()
  });
});

/** Live WebSocket connection stats - also consumed by the admin
 * GET /api/applications/connections route (a direct call now; this used to
 * be served to core-service over D-Bus). */
/**
 * Tell connected applications that an application ID moved to different
 * hardware. Everything they address it by is unchanged - same deviceId, same
 * groups - so nothing breaks if they ignore this; it exists because a silent
 * hardware substitution is something an application may legitimately want to
 * react to (re-read the twin, note it in an audit log, reset a calibration
 * baseline that belonged to the old unit).
 *
 * Called directly by the admin server's role endpoint - same process, so no
 * transport in between - and delivered on the existing broadcast channel
 * under its own `swap` topic, filtered by the same device and group
 * subscriptions as everything else.
 */
export function notifyIdentityTransfer(info: { deviceId: string; previousUuid: string; previousName: string | null; newUuid: string; newName: string; groups: string[] }) {
  broadcastToSubscribers('swap', {
    deviceId: info.deviceId,
    previousUuid: info.previousUuid,
    previousName: info.previousName,
    uuid: info.newUuid,
    deviceName: info.newName,
    groups: info.groups,
    timestamp: new Date().toISOString()
  });
}

export function getConnectionStatus() {
  // Group active clients by token ID
  const connectionsByToken = new Map<string, {
    appName: string;
    connections: number;
    subscriptions: {
      topics: string[];
      devices: string[];
    }[];
  }>();

  clients.forEach(client => {
    const existing = connectionsByToken.get(client.tokenId);
    if (existing) {
      existing.connections++;
      existing.subscriptions.push({
        topics: Array.from(client.subscriptions.topics),
        devices: Array.from(client.subscriptions.devices)
      });
    } else {
      connectionsByToken.set(client.tokenId, {
        appName: client.appName,
        connections: 1,
        subscriptions: [{
          topics: Array.from(client.subscriptions.topics),
          devices: Array.from(client.subscriptions.devices)
        }]
      });
    }
  });

  // Convert to array format
  const activeConnections = Array.from(connectionsByToken.entries()).map(([tokenId, info]) => ({
    tokenId,
    appName: info.appName,
    connectionCount: info.connections,
    subscriptions: info.subscriptions
  }));

  return {
    totalConnections: clients.size,
    activeApplications: activeConnections.length,
    connections: activeConnections
  };
}

// Get active WebSocket connections (authenticated - for external API consumers)
app.get('/api/connections/active', authenticateToken, (_req: Request, res: Response) => {
  try {
    res.json(getConnectionStatus());
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get active connections:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve active connections' });
  }
});

// Get all devices
/**
 * Resolve any device identifier (assigned name, role, or uuid) to the device's
 * MQTT name. That name is the device's actual broker identity - its certificate
 * CN and clientId - and therefore the only topic namespace it is subscribed
 * under. Every Hub->device publish must address this, never the uuid: a device
 * only ever uses its uuid during the one-time provisioning claim, so a message
 * sent to the uuid's namespace reaches nobody.
 */
/**
 * Resolve one or more group names (?group=a&group=b, or a single value) to the
 * hardware uuids of every device currently in any of them. Exact matching,
 * same as the group filter on /api/devices.
 */
function devicesInGroups(group: unknown): string[] {
  const wanted = new Set((Array.isArray(group) ? group : [group]).map(g => String(g)));
  return getDevicesListSync().devices
    .filter(d => (d.groups || []).some(g => wanted.has(g)))
    .map(d => d.uuid);
}

function resolveDeviceMqttName(identifier: string): string | null {
  const uuid = resolveIdentifierToUuid(identifier);
  if (!uuid) return null;
  const device = getDeviceByUuid(uuid);
  return device ? device.name : null;
}

function toApiDevice(d: { uuid: string; name: string; role: string | null; groups?: string[]; meta: any; created_at: string; last_seen: string | null; online: boolean }) {
  const meta = d.meta && typeof d.meta === 'object' ? d.meta : {};
  return {
    deviceId: d.role ?? d.name, // role if assigned, else raw MQTT name - same precedence as the WebSocket broadcast
    deviceName: d.name,
    role: d.role,
    groups: d.groups ?? [],
    uuid: d.uuid, // Include UUID for internal use only
    status: d.online ? 'online' : 'offline',
    lastSeen: d.last_seen,
    model: meta.model,
    firmware: meta.firmware,
    metadata: meta,
    createdAt: d.created_at
  };
}

app.get('/api/devices', authenticateToken, (req: Request, res: Response) => {
  try {
    const { model, group, status, lastSeenAfter, lastSeenBefore, limit = 100, offset = 0 } = req.query;

    let devices = getDevicesListSync().devices;

    if (model) devices = devices.filter(d => (d.meta?.model) === model);
    // ?group=a&group=b returns devices in *any* of the named groups, which is
    // what "show me the cold-storage and loading-bay fleet" means. Matched
    // exactly (case included) - see normalizeGroups for why.
    if (group) {
      const wanted = new Set((Array.isArray(group) ? group : [group]).map(g => String(g)));
      devices = devices.filter(d => (d.groups || []).some(g => wanted.has(g)));
    }
    if (status) devices = devices.filter(d => (d.online ? 'online' : 'offline') === String(status));
    if (lastSeenAfter) devices = devices.filter(d => d.created_at >= String(lastSeenAfter));
    if (lastSeenBefore) devices = devices.filter(d => d.created_at <= String(lastSeenBefore));

    const start = Number(offset) || 0;
    const end = start + (Number(limit) || 100);
    devices = devices.slice(start, end);

    res.json(devices.map(toApiDevice));
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get devices:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve devices' });
  }
});

// Groups in use, with device counts. Read-only here: grouping is an operator
// concern, assigned through the Device Hub admin API/UI.
app.get('/api/groups', authenticateToken, (_req: Request, res: Response) => {
  try {
    res.json(listGroups());
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to list groups:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve groups' });
  }
});

// Get specific device (accepts device name, role, or UUID)
app.get('/api/devices/:deviceId', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    const uuid = resolveIdentifierToUuid(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const device = getDeviceByUuid(uuid);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    res.json(toApiDevice(device));
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get device:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve device' });
  }
});

// Get device telemetry
app.get('/api/telemetry', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceId, group, startTime, endTime, limit = 100, offset = 0 } = req.query;

    const deviceUuid = deviceId ? resolveIdentifierToUuid(String(deviceId)) : undefined;
    if (deviceId && !deviceUuid) {
      res.json([]);
      return;
    }

    // ?group=... narrows to the devices currently in those groups. Resolved
    // to uuids here so the store stays a plain event table with no knowledge
    // of grouping. Membership is evaluated at query time, so a device added
    // to a group today also surfaces its older readings under that group.
    const groupUuids = group ? devicesInGroups(group) : undefined;

    const events = queryEvents({
      deviceUuid: deviceUuid || undefined,
      deviceUuids: groupUuids,
      eventType: 'telemetry',
      startTime: startTime ? String(startTime) : undefined,
      endTime: endTime ? String(endTime) : undefined,
      limit: Number(limit) || 100,
      offset: Number(offset) || 0
    });

    // deviceId is the public identifier (role if assigned, else the MQTT
    // name) - the same value getDevices() and the WebSocket broadcasts use,
    // so telemetry can be correlated with a device without the caller having
    // to translate uuids. It also keeps a hardware swap invisible: readings
    // before and after keep reporting the role.
    res.json(events.map(e => ({ deviceId: resolvePublicIdFromUuid(e.deviceUuid), uuid: e.deviceUuid, timestamp: e.ts, data: e.data })));
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get telemetry:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve telemetry' });
  }
});

// Store telemetry data
app.post('/api/telemetry', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceId, data } = req.body;

    if (!deviceId || !data) {
      res.status(400).json({ error: 'deviceId and data are required' });
      return;
    }

    const uuid = resolveIdentifierToUuid(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const result = recordEvent(uuid, 'telemetry', data);
    if (!result.ok) {
      res.status(500).json({ error: result.error || 'Failed to store telemetry' });
      return;
    }

    // Broadcast to subscribers
    broadcastToSubscribers('telemetry', {
      deviceId: uuid,
      timestamp: result.ts,
      data
    });

    res.json({ ok: true, timestamp: result.ts });
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to store telemetry:`, e.message);
    res.status(500).json({ error: 'Failed to store telemetry' });
  }
});

// Get device events (accepts device name, role, or UUID)
app.get('/api/devices/:deviceId/events', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { startTime, endTime, eventType, limit = 100 } = req.query;

    const uuid = resolveIdentifierToUuid(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const events = queryEvents({
      deviceUuid: uuid,
      eventType: eventType ? String(eventType) : undefined,
      startTime: startTime ? String(startTime) : undefined,
      endTime: endTime ? String(endTime) : undefined,
      limit: Number(limit) || 100
    });

    // Same public-identifier convention as /api/telemetry and /api/devices.
    res.json(events.map(e => ({ deviceId: resolvePublicIdFromUuid(e.deviceUuid), uuid: e.deviceUuid, eventType: e.eventType, timestamp: e.ts, data: e.data })));
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get device events:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
});

// Get device twin (accepts device name, role, or UUID)
app.get('/api/devices/:deviceId/twin', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Resolve device identifier to UUID, then to the device's assigned MQTT
    // name - twin docs are keyed by that name (see twin-store.ts), never by
    // uuid.
    const uuid = resolveIdentifierToUuid(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const device = getDeviceByUuid(uuid);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const twin = getTwin(device.name);

    res.json({
      deviceId,
      desired: twin.desired.doc,
      reported: twin.reported.doc,
      lastUpdated: new Date().toISOString()
    });
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get device twin:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve twin' });
  }
});

// Update device twin desired properties (accepts device name or UUID)
app.patch('/api/devices/:deviceId/twin', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { desired } = req.body;

    if (!desired) {
      return res.status(400).json({ error: 'desired properties required' });
    }

    // Resolve device identifier to UUID, then to the device's assigned MQTT
    // name - twin topics are keyed by that name (see twin-store.ts / the
    // twin sub-service's TOPICS), never by uuid.
    const uuid = resolveIdentifierToUuid(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const device = getDeviceByUuid(uuid);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    // Publish onto the same twin/update topic a device itself would use;
    // the twin sub-service's own subscription applies the patch and
    // computes/publishes the resulting delta - no need to duplicate that
    // logic here.
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(
        `$devicehub/devices/${device.name}/twin/update`,
        JSON.stringify({ desired }),
        { qos: 1 }
      );
    }

    res.json({ ok: true, deviceId });
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to update device twin:`, e.message);
    res.status(500).json({ error: 'Failed to update twin' });
  }
});

// Call direct method on device (accepts device name or UUID)
app.post('/api/devices/:deviceId/methods/:methodName', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceId, methodName } = req.params;
    const { payload } = req.body;
    const requestId = uuidv4();

    if (!mqttClient || !mqttClient.connected) {
      return res.status(503).json({ error: 'MQTT broker not connected' });
    }

    // Resolve to the device's MQTT name - the namespace it actually listens on
    const mqttName = resolveDeviceMqttName(deviceId);

    if (!mqttName) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    // Set up response listener with timeout
    const timeout = setTimeout(() => {
      eventEmitter.off(`method-response-${requestId}`, responseHandler);
      res.status(504).json({
        status: 504,
        message: 'Method call timeout',
        requestId
      });
    }, 30000);

    const responseHandler = (response: any) => {
      clearTimeout(timeout);
      res.json({
        status: response.status || 200,
        payload: response.payload,
        message: response.message,
        requestId
      });
    };

    eventEmitter.once(`method-response-${requestId}`, responseHandler);

    mqttClient.publish(
      `$devicehub/devices/${mqttName}/methods/${methodName}/request`,
      JSON.stringify({
        requestId,
        methodName,
        payload
      }),
      { qos: 1 }
    );

  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to call device method:`, e.message);
    res.status(500).json({ error: 'Failed to call method' });
  }
});

// Batch operations - execute commands on multiple devices
app.post('/api/batch/methods', authenticateToken, (req: Request, res: Response) => {
  try {
    const { deviceIds, methodName, payload } = req.body;

    if (!deviceIds || !Array.isArray(deviceIds) || !methodName) {
      return res.status(400).json({ error: 'deviceIds array and methodName required' });
    }

    if (!mqttClient || !mqttClient.connected) {
      return res.status(503).json({ error: 'MQTT broker not connected' });
    }

    const results = deviceIds.map(deviceId => {
      const requestId = uuidv4();

      // Same resolution as the single-device route: publish to the device's
      // MQTT name, not whatever identifier form the caller happened to use.
      const mqttName = resolveDeviceMqttName(deviceId);
      if (!mqttName) {
        return { deviceId, requestId, status: 'failed', error: 'Device not found' };
      }

      mqttClient!.publish(
        `$devicehub/devices/${mqttName}/methods/${methodName}/request`,
        JSON.stringify({
          requestId,
          methodName,
          payload
        }),
        { qos: 1 }
      );

      return {
        deviceId,
        requestId,
        status: 'submitted'
      };
    });

    res.json({
      ok: true,
      results,
      message: `Method ${methodName} submitted to ${deviceIds.length} devices`
    });

  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to execute batch operation:`, e.message);
    res.status(500).json({ error: 'Failed to execute batch operation' });
  }
});

// Get system statistics
app.get('/api/stats/devices', authenticateToken, (_req: Request, res: Response) => {
  try {
    const devices = getDevicesListSync().devices;
    const total = devices.length;
    const online = devices.filter(d => d.online).length;

    res.json({
      total,
      online,
      offline: total - online
    });
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get statistics:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

// Start the application sub-service (called from the main entrypoint)
export function startApplication() {
  connectMqtt();
  server.listen(APPLICATION_PORT, () => {
    console.log(`[${SERVICE}] REST API listening on port ${APPLICATION_PORT}`);
    console.log(`[${SERVICE}] WebSocket server available at ws://localhost:${APPLICATION_PORT}/ws`);
  });
}
