/**
 * Application Interface Service
 * 
 * Provides REST API and WebSocket interface for cloud applications
 * to interact with Edgeberry Device Hub and connected devices.
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
import dotenv from 'dotenv';
import { startApplicationDbusService, stopApplicationDbusService } from './dbus.js';
import {
  dbusListDevices, dbusGetDeviceInfo, dbusResolveIdentifier, dbusResolvePublicId,
  dbusVerifyToken, dbusRecordEvent, dbusQueryEvents, dbusGetTwin
} from './dbus-client.js';
// Load environment variables
dotenv.config();

// Configuration
const PORT = process.env.APPLICATION_PORT || 8090;
const SERVICE = 'application-service';

// MQTT Configuration
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';

// JWT secret (must match core-service for token validation)
// const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// dbus-native has a known bug where D-Bus introspection throws an uncaught
// exception with message "No root XML node" instead of a catchable
// rejection. This service exports its own ApplicationService D-Bus
// interface and is introspected by core-service, so without this guard the
// whole process (REST API + WebSocket) can die on an introspection hiccup.
// Mirrors the same guard in twin-service/src/dbus.ts. Any other uncaught
// exception remains fatal.
process.on('uncaughtException', (error) => {
  if (error?.message?.includes('No root XML node')) {
    console.error(`[${SERVICE}] D-Bus XML introspection error (non-fatal):`, error.message);
    return;
  }
  throw error;
});

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
  };
}

const clients = new Map<WebSocket, AuthenticatedClient>();

// MQTT client for device communication
let mqttClient: mqtt.MqttClient | null = null;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Token authentication middleware - verifies against core-service's
// api_tokens table via D-Bus (TokenService.VerifyToken); this service never
// opens devicehub.db itself.
async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const result = await dbusVerifyToken(token);
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
    console.log(`[${SERVICE}] MQTT message received on topic: ${topic}`);
    handleMqttMessage(topic, payload.toString()).catch(e =>
      console.error(`[${SERVICE}] Failed to handle MQTT message:`, e?.message || e)
    );
  });

  mqttClient.on('error', (err) => {
    console.error(`[${SERVICE}] MQTT error:`, err.message);
  });
}

// Handle incoming MQTT messages
async function handleMqttMessage(topic: string, payload: string) {
  try {
    const topicParts = topic.split('/');
    const deviceId = topicParts[2];
    const messageType = topicParts[3];

    console.log(`[${SERVICE}] Parsed MQTT - deviceId: ${deviceId}, messageType: ${messageType}`);

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

    // Handle method responses
    if (messageType === 'methods' && topicParts[4] === 'response') {
      const requestId = data.requestId;
      if (requestId) {
        eventEmitter.emit(`method-response-${requestId}`, data);
      }
    }

    // Broadcast to WebSocket clients based on their subscriptions
    await broadcastToSubscribers(messageType, messageData);

  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to handle MQTT message:`, e.message);
  }
}

// Broadcast to WebSocket subscribers. Every device identifier here is
// resolved via D-Bus to core-service (this service never opens
// devicehub.db itself) - `resolved` memoizes each unique identifier for
// the lifetime of this one incoming message so a message fanning out to
// many clients with overlapping device subscriptions doesn't repeat the
// same D-Bus round trip; it's not a cache across messages.
async function broadcastToSubscribers(topic: string, data: any) {
  const resolved = new Map<string, string | null>();
  async function resolveOnce(identifier: string): Promise<string | null> {
    if (resolved.has(identifier)) return resolved.get(identifier)!;
    const uuid = await dbusResolveIdentifier(identifier);
    resolved.set(identifier, uuid);
    return uuid;
  }

  // As parsed from the MQTT topic segment - for a claimed device this is
  // always its raw MQTT name (topic segment %c), never its uuid, since
  // devices publish under their own assigned name (see the masked-identity
  // provisioning design in core-service/src/dbus-devices.ts). Resolving it
  // to a uuid once here, up front, means every subscription comparison below
  // compares uuid-to-uuid instead of accidentally comparing a uuid against a
  // raw name - the two used to be compared directly and could never match.
  const rawDeviceId = data.deviceId || data.device_id;
  const deviceUuid = rawDeviceId ? await resolveOnce(rawDeviceId) : null;

  console.log(`[${SERVICE}] Broadcasting ${topic} for device ${rawDeviceId} (uuid=${deviceUuid}) to ${clients.size} clients`);

  const publicDeviceId = deviceUuid ? await dbusResolvePublicId(deviceUuid) : rawDeviceId;

  for (const client of clients.values()) {
    console.log(`[${SERVICE}] Checking client ${client.appName}: topics=${Array.from(client.subscriptions.topics)}, devices=${Array.from(client.subscriptions.devices)}`);

    // Check if client is subscribed to this topic
    if (!client.subscriptions.topics.has(topic) && !client.subscriptions.topics.has('*')) {
      console.log(`[${SERVICE}] Client ${client.appName} not subscribed to topic ${topic}`);
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
          const resolvedUuid = await resolveOnce(subscribedDevice);
          if (resolvedUuid === deviceUuid) {
            isSubscribed = true;
            break;
          }
        }
      }

      if (!isSubscribed) {
        console.log(`[${SERVICE}] Client ${client.appName} not subscribed to device ${rawDeviceId}`);
        continue;
      }
    }

    console.log(`[${SERVICE}] Sending ${topic} message to client ${client.appName}`);

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

  // Token verification is now a D-Bus round trip rather than a synchronous
  // local DB read, so there's a real async gap before we know whether to
  // register this connection at all. Buffer any message a client sends
  // during that gap (e.g. a `subscribe` fired immediately on open, a very
  // natural client pattern) instead of losing it to an as-yet-unregistered
  // listener, and replay it once verification finishes.
  const pending: string[] = [];
  const bufferMessage = (message: Buffer | string) => { pending.push(message.toString()); };
  ws.on('message', bufferMessage);

  dbusVerifyToken(token).then((result) => {
    ws.off('message', bufferMessage);

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
        devices: new Set()
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

    // Replay whatever arrived while we were still verifying the token
    for (const message of pending) handleWebSocketMessage(client, message);
  }).catch((e) => {
    ws.off('message', bufferMessage);
    console.error(`[${SERVICE}] Token verification failed:`, e?.message || e);
    try { ws.close(1011, 'Internal error'); } catch { /* ignore */ }
  });
});

// Handle WebSocket messages from clients
function handleWebSocketMessage(client: AuthenticatedClient, message: string) {
  try {
    const msg = JSON.parse(message);

    switch (msg.type) {
      case 'subscribe':
        if (msg.topics && Array.isArray(msg.topics)) {
          msg.topics.forEach((topic: string) => client.subscriptions.topics.add(topic));
        }
        if (msg.devices && Array.isArray(msg.devices)) {
          // Clear previous device subscriptions and add new ones
          client.subscriptions.devices.clear();
          msg.devices.forEach((device: string) => client.subscriptions.devices.add(device));
        } else {
          // Default to all devices if not specified
          client.subscriptions.devices.add('*');
        }
        console.log(`[${SERVICE}] Client ${client.appName} subscribed to topics=${Array.from(client.subscriptions.topics)}, devices=${Array.from(client.subscriptions.devices)}`);
        client.ws.send(JSON.stringify({
          type: 'subscribed',
          topics: msg.topics,
          devices: Array.from(client.subscriptions.devices)
        }));
        break;

      case 'unsubscribe':
        if (msg.topics && Array.isArray(msg.topics)) {
          msg.topics.forEach((topic: string) => client.subscriptions.topics.delete(topic));
        }
        if (msg.devices && Array.isArray(msg.devices)) {
          msg.devices.forEach((device: string) => client.subscriptions.devices.delete(device));
        }
        client.ws.send(JSON.stringify({
          type: 'unsubscribed',
          topics: msg.topics,
          devices: msg.devices
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
async function handleMethodCall(client: AuthenticatedClient, msg: any) {
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

  // Resolve device identifier to UUID
  const uuid = await dbusResolveIdentifier(deviceId);

  if (!uuid) {
    client.ws.send(JSON.stringify({
      type: 'methodResponse',
      requestId,
      error: 'Device not found'
    }));
    return;
  }

  console.log(`[${SERVICE}] WebSocket method call: ${methodName} on device ${deviceId} (${uuid})`);

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

  // Publish method request using UUID
  mqttClient.publish(
    `$devicehub/devices/${uuid}/methods/${methodName}/request`,
    JSON.stringify({
      requestId,
      methodName,
      payload
    }),
    { qos: 1 }
  );
}

// Handle sendMessage via WebSocket
async function handleSendMessage(client: AuthenticatedClient, msg: any) {
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

  // Resolve device identifier to UUID
  const uuid = await dbusResolveIdentifier(deviceId);

  if (!uuid) {
    client.ws.send(JSON.stringify({
      type: 'messageResponse',
      messageId,
      error: 'Device not found'
    }));
    return;
  }

  console.log(`[${SERVICE}] Sending cloud-to-device message to ${deviceId} (${uuid})`);

  // Publish message to device
  mqttClient.publish(
    `$devicehub/devices/${uuid}/messages/devicebound`,
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

// Device identifier resolution (role -> devices.name -> raw uuid, and the
// reverse) now lives entirely behind D-Bus - see dbus-client.ts's
// dbusResolveIdentifier/dbusResolvePublicId. This service never opens
// devicehub.db itself.

// ============ REST API ENDPOINTS ============

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: SERVICE,
    timestamp: new Date().toISOString()
  });
});

// Helper function to get connection status
function getConnectionStatus() {
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
app.get('/api/connections/active', authenticateToken, async (_req: Request, res: Response) => {
  try {
    res.json(getConnectionStatus());
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get active connections:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve active connections' });
  }
});

// Get all devices
function toApiDevice(d: { uuid: string; name: string; role: string | null; meta: any; created_at: string; last_seen: string | null; online: boolean }) {
  const meta = d.meta && typeof d.meta === 'object' ? d.meta : {};
  return {
    deviceId: d.role ?? d.name, // role if assigned, else raw MQTT name - same precedence as the WebSocket broadcast
    deviceName: d.name,
    role: d.role,
    uuid: d.uuid, // Include UUID for internal use only
    status: d.online ? 'online' : 'offline',
    lastSeen: d.last_seen,
    model: meta.model,
    firmware: meta.firmware,
    metadata: meta,
    createdAt: d.created_at
  };
}

app.get('/api/devices', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { model, lastSeenAfter, lastSeenBefore, limit = 100, offset = 0 } = req.query;

    let devices = await dbusListDevices();

    if (model) devices = devices.filter(d => (d.meta?.model) === model);
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

// Get specific device (accepts device name, role, or UUID)
app.get('/api/devices/:deviceId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    const uuid = await dbusResolveIdentifier(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const device = await dbusGetDeviceInfo(uuid);
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
app.get('/api/telemetry', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId, startTime, endTime, limit = 100, offset = 0 } = req.query;

    const deviceUuid = deviceId ? await dbusResolveIdentifier(String(deviceId)) : undefined;
    if (deviceId && !deviceUuid) {
      res.json([]);
      return;
    }

    const events = await dbusQueryEvents({
      deviceUuid: deviceUuid || undefined,
      eventType: 'telemetry',
      startTime: startTime ? String(startTime) : undefined,
      endTime: endTime ? String(endTime) : undefined,
      limit: Number(limit) || 100,
      offset: Number(offset) || 0
    });

    res.json(events.map(e => ({ deviceId: e.deviceUuid, timestamp: e.ts, data: e.data })));
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get telemetry:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve telemetry' });
  }
});

// Store telemetry data
app.post('/api/telemetry', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId, data } = req.body;

    if (!deviceId || !data) {
      res.status(400).json({ error: 'deviceId and data are required' });
      return;
    }

    const uuid = await dbusResolveIdentifier(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const result = await dbusRecordEvent(uuid, 'telemetry', data);
    if (!result.ok) {
      res.status(500).json({ error: result.error || 'Failed to store telemetry' });
      return;
    }

    // Broadcast to subscribers
    await broadcastToSubscribers('telemetry', {
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
app.get('/api/devices/:deviceId/events', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { startTime, endTime, eventType, limit = 100 } = req.query;

    const uuid = await dbusResolveIdentifier(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const events = await dbusQueryEvents({
      deviceUuid: uuid,
      eventType: eventType ? String(eventType) : undefined,
      startTime: startTime ? String(startTime) : undefined,
      endTime: endTime ? String(endTime) : undefined,
      limit: Number(limit) || 100
    });

    res.json(events.map(e => ({ deviceId: e.deviceUuid, eventType: e.eventType, timestamp: e.ts, data: e.data })));
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get device events:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
});

// Get device twin (accepts device name or UUID)
app.get('/api/devices/:deviceId/twin', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Resolve device identifier to UUID, then to the device's assigned MQTT
    // name - twin docs are keyed by that name (see core-service/src/twin-store.ts),
    // never by uuid.
    const uuid = await dbusResolveIdentifier(deviceId);
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const device = await dbusGetDeviceInfo(uuid);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const twin = await dbusGetTwin(device.name);
    if (!twin.ok) {
      res.status(502).json({ error: twin.error || 'Failed to fetch twin' });
      return;
    }

    res.json({
      deviceId,
      desired: twin.desired?.doc ?? {},
      reported: twin.reported?.doc ?? {},
      lastUpdated: new Date().toISOString()
    });
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get device twin:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve twin' });
  }
});

// Update device twin desired properties (accepts device name or UUID)
app.patch('/api/devices/:deviceId/twin', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { desired } = req.body;

    if (!desired) {
      return res.status(400).json({ error: 'desired properties required' });
    }

    // Resolve device identifier to UUID
    const uuid = await dbusResolveIdentifier(deviceId);

    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    // Publish desired state update to MQTT using UUID
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(
        `$devicehub/devices/${uuid}/twin/desired`,
        JSON.stringify(desired),
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
app.post('/api/devices/:deviceId/methods/:methodName', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId, methodName } = req.params;
    const { payload } = req.body;
    const requestId = uuidv4();
    
    if (!mqttClient || !mqttClient.connected) {
      return res.status(503).json({ error: 'MQTT broker not connected' });
    }

    // Resolve device identifier to UUID
    const uuid = await dbusResolveIdentifier(deviceId);

    if (!uuid) {
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

    // Publish method request using UUID
    mqttClient.publish(
      `$devicehub/devices/${uuid}/methods/${methodName}/request`,
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
app.post('/api/batch/methods', authenticateToken, async (req: Request, res: Response) => {
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
      
      // Publish method request for each device
      mqttClient!.publish(
        `$devicehub/devices/${deviceId}/methods/${methodName}/request`,
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
app.get('/api/stats/devices', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const devices = await dbusListDevices();
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

// Start the service
async function start() {
  console.log(`[${SERVICE}] Starting Application Interface Service...`);

  // Initialize D-Bus service
  try {
    await startApplicationDbusService(getConnectionStatus);
    console.log(`[${SERVICE}] D-Bus service initialized`);
  } catch (error) {
    console.error(`[${SERVICE}] Failed to start D-Bus service:`, error);
    console.error(`[${SERVICE}] Continuing without D-Bus support`);
  }
  
  // Connect to MQTT
  connectMqtt();
  
  // Start server
  server.listen(PORT, () => {
    console.log(`[${SERVICE}] REST API listening on port ${PORT}`);
    console.log(`[${SERVICE}] WebSocket server available at ws://localhost:${PORT}/ws`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[${SERVICE}] SIGTERM received, shutting down gracefully...`);
  
  // Close WebSocket connections
  clients.forEach(client => {
    client.ws.close(1000, 'Server shutting down');
  });
  wss.close();
  
  // Disconnect MQTT
  if (mqttClient) {
    mqttClient.end();
  }
  
  // Stop D-Bus service
  stopApplicationDbusService();
  
  // Close HTTP server
  server.close(() => {
    console.log(`[${SERVICE}] Server closed`);
    process.exit(0);
  });
});

// Start the service
start().catch(err => {
  console.error(`[${SERVICE}] Failed to start:`, err);
  process.exit(1);
});
