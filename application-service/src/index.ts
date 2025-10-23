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
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { startApplicationDbusService, stopApplicationDbusService } from './dbus.js';
// Load environment variables
dotenv.config();

// Configuration
const PORT = process.env.APPLICATION_PORT || 8090;
const SERVICE = 'application-service';

// Database paths
const DEVICEHUB_DB = process.env.DEVICEHUB_DB || '/var/lib/edgeberry/devicehub/devicehub.db';

// MQTT Configuration
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';

// JWT secret (must match core-service for token validation)
// const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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

// Database helper
function openDb(dbPath: string): any {
  try {
    const db = new Database(dbPath, { readonly: false });
    db.pragma('journal_mode = WAL');
    return db;
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to open database ${dbPath}:`, e.message);
    return null;
  }
}

// Initialize API tokens table if not exists
function initializeDatabase() {
  const db = openDb(DEVICEHUB_DB);
  if (!db) {
    console.error(`[${SERVICE}] Failed to initialize database`);
    process.exit(1);
  }

  try {
    // Create API tokens table
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_used TEXT,
        expires_at TEXT,
        scopes TEXT,
        active INTEGER DEFAULT 1
      )
    `);
    console.log(`[${SERVICE}] Database initialized`);
  } catch (e: any) {
    console.error(`[${SERVICE}] Database initialization failed:`, e.message);
  } finally {
    db.close();
  }
}

// Token authentication middleware
async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const db = openDb(DEVICEHUB_DB);
  if (!db) {
    res.status(500).json({ error: 'Database unavailable' });
    return;
  }

  try {
    // Verify token exists and is active
    const stmt = db.prepare(`
      SELECT id, name, scopes, expires_at, active 
      FROM api_tokens 
      WHERE token = ?
    `);
    const tokenData = stmt.get(token) as any;

    if (!tokenData) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    if (!tokenData.active) {
      res.status(401).json({ error: 'Token inactive' });
      return;
    }

    // Check expiration
    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    // Update last_used
    const updateStmt = db.prepare('UPDATE api_tokens SET last_used = ? WHERE id = ?');
    updateStmt.run(new Date().toISOString(), tokenData.id);

    // Attach token info to request
    (req as any).apiToken = {
      id: tokenData.id,
      name: tokenData.name,
      scopes: tokenData.scopes ? JSON.parse(tokenData.scopes) : []
    };

    next();
  } catch (e: any) {
    console.error(`[${SERVICE}] Token authentication error:`, e.message);
    res.status(500).json({ error: 'Authentication error' });
    return;
  } finally {
    db.close();
  }
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
    handleMqttMessage(topic, payload.toString());
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
    broadcastToSubscribers(messageType, messageData);

  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to handle MQTT message:`, e.message);
  }
}

// Broadcast to WebSocket subscribers
function broadcastToSubscribers(topic: string, data: any) {
  const deviceId = data.deviceId || data.device_id;
  const db = openDb(DEVICEHUB_DB);
  
  console.log(`[${SERVICE}] Broadcasting ${topic} for device ${deviceId} to ${clients.size} clients`);
  
  clients.forEach(client => {
    console.log(`[${SERVICE}] Checking client ${client.appName}: topics=${Array.from(client.subscriptions.topics)}, devices=${Array.from(client.subscriptions.devices)}`);
    
    // Check if client is subscribed to this topic
    if (!client.subscriptions.topics.has(topic) && !client.subscriptions.topics.has('*')) {
      console.log(`[${SERVICE}] Client ${client.appName} not subscribed to topic ${topic}`);
      return;
    }
    
    // Check if client is subscribed to this device
    if (deviceId && !client.subscriptions.devices.has('*')) {
      // Check if client subscribed with UUID
      let isSubscribed = client.subscriptions.devices.has(deviceId);
      
      // If not, check if any of the subscribed device names resolve to this UUID
      if (!isSubscribed && db) {
        for (const subscribedDevice of client.subscriptions.devices) {
          const resolvedUuid = resolveDeviceIdentifier(subscribedDevice, db);
          if (resolvedUuid === deviceId) {
            isSubscribed = true;
            break;
          }
        }
      }
      
      if (!isSubscribed) {
        console.log(`[${SERVICE}] Client ${client.appName} not subscribed to device ${deviceId}`);
        return;
      }
    }
    
    console.log(`[${SERVICE}] Sending ${topic} message to client ${client.appName}`);
    
    try {
      // Convert UUID to device name for application layer
      let deviceName = deviceId;
      if (db) {
        const stmt = db.prepare('SELECT name FROM devices WHERE uuid = ?');
        const device = stmt.get(deviceId) as any;
        if (device && device.name) {
          deviceName = device.name;
        }
      }
      
      client.ws.send(JSON.stringify({
        type: 'message',
        topic,
        deviceId: deviceName,  // Send device name, not UUID
        data
      }));
    } catch (e) {
      console.error(`[${SERVICE}] Failed to send to WebSocket client:`, e);
    }
  });
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

  // Validate token
  const db = openDb(DEVICEHUB_DB);
  if (!db) {
    ws.send(JSON.stringify({ type: 'error', message: 'Database unavailable' }));
    ws.close(1011, 'Database unavailable');
    return;
  }

  try {
    const stmt = db.prepare('SELECT id, name, active FROM api_tokens WHERE token = ?');
    const tokenData = stmt.get(token) as any;

    if (!tokenData || !tokenData.active) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
      ws.close(1008, 'Invalid token');
      return;
    }

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

  } finally {
    db.close();
  }
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

  const db = openDb(DEVICEHUB_DB);
  if (!db) {
    client.ws.send(JSON.stringify({
      type: 'methodResponse',
      requestId,
      error: 'Database unavailable'
    }));
    return;
  }

  // Resolve device identifier to UUID
  const uuid = resolveDeviceIdentifier(deviceId, db);
  db.close();
  
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

// ============ HELPER FUNCTIONS ============

/**
 * Resolve device name to UUID
 * Accepts either a device name (EDGB-XXXX) or UUID and returns the UUID
 */
function resolveDeviceIdentifier(identifier: string, db: any): string | null {
  if (!identifier) return null;
  
  // Check if it's already a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(identifier)) {
    return identifier;
  }
  
  // Otherwise, treat it as a device name and look up the UUID
  const stmt = db.prepare('SELECT uuid FROM devices WHERE name = ?');
  const device = stmt.get(identifier) as any;
  return device ? device.uuid : null;
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
app.get('/api/devices', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    const { status, model, lastSeenAfter, lastSeenBefore, limit = 100, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM devices WHERE 1=1';
    const params: any[] = [];

    if (status) {
      // Status filtering not available in current schema
    }

    if (model) {
      query += ' AND model = ?';
      params.push(model);
    }

    if (lastSeenAfter) {
      query += ' AND created_at >= ?';
      params.push(lastSeenAfter);
    }

    if (lastSeenBefore) {
      query += ' AND created_at <= ?';
      params.push(lastSeenBefore);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const stmt = db.prepare(query);
    const devices = stmt.all(...params);

    res.json(devices.map((d: any) => ({
      deviceId: d.name, // Use device name as the public identifier
      deviceName: d.name,
      uuid: d.uuid, // Include UUID for internal use only
      status: 'offline', // Default status since last_seen doesn't exist in current schema
      lastSeen: null, // Not available in current schema
      model: d.model,
      firmware: d.firmware_version,
      metadata: d.tags ? JSON.parse(d.tags) : {},
      createdAt: d.created_at
    })));

    db.close();
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get devices:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve devices' });
  }
});

// Get specific device (accepts device name or UUID)
app.get('/api/devices/:deviceId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    // Resolve device identifier (name or UUID) to UUID
    const uuid = resolveDeviceIdentifier(deviceId, db);
    if (!uuid) {
      db.close();
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const stmt = db.prepare('SELECT * FROM devices WHERE uuid = ?');
    const device = stmt.get(uuid) as any;

    if (!device) {
      db.close();
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    res.json({
      deviceId: device.name, // Use device name as the public identifier
      deviceName: device.name,
      uuid: device.uuid, // Include UUID for internal use only
      status: 'offline', // Default status since last_seen doesn't exist in current schema
      lastSeen: null, // Not available in current schema
      model: device.model,
      firmware: device.firmware_version,
      metadata: device.tags ? JSON.parse(device.tags) : {}
    });

    db.close();
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get device:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve device' });
  }
});

// Get device telemetry
app.get('/api/telemetry', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId, startTime, endTime, limit = 100, offset = 0 } = req.query;
    
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    let query = `
      SELECT device_id, timestamp, data 
      FROM device_events 
      WHERE event_type = 'telemetry'
    `;
    const params: any[] = [];

    if (deviceId) {
      query += ' AND device_id = ?';
      params.push(deviceId);
    }

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }

    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const stmt = db.prepare(query);
    const telemetry = stmt.all(...params);

    res.json(telemetry.map((t: any) => ({
      deviceId: t.device_id,
      timestamp: t.timestamp,
      data: JSON.parse(t.data || '{}')
    })));

    db.close();
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

    const timestamp = new Date().toISOString();
    
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    const stmt = db.prepare(`
      INSERT INTO device_events (device_id, event_type, timestamp, data)
      VALUES (?, 'telemetry', ?, ?)
    `);
    
    stmt.run(deviceId, timestamp, JSON.stringify(data));

    // Note: last_seen column doesn't exist in current schema
    // Would need schema migration to add this functionality

    db.close();

    // Broadcast to subscribers
    broadcastToSubscribers('telemetry', {
      deviceId,
      timestamp,
      data
    });

    res.json({ ok: true, timestamp });
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to store telemetry:`, e.message);
    res.status(500).json({ error: 'Failed to store telemetry' });
  }
});

// Get device events (accepts device name or UUID)
app.get('/api/devices/:deviceId/events', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { startTime, endTime, eventType, limit = 100 } = req.query;
    
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    // Resolve device identifier to UUID
    const uuid = resolveDeviceIdentifier(deviceId, db);
    if (!uuid) {
      db.close();
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    let query = 'SELECT * FROM device_events WHERE device_id = ?';
    const params: any[] = [uuid];

    if (eventType) {
      query += ' AND event_type = ?';
      params.push(eventType);
    }

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }

    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(Number(limit));

    const stmt = db.prepare(query);
    const events = stmt.all(...params);

    res.json(events.map((e: any) => ({
      deviceId: e.device_id,
      eventType: e.event_type,
      timestamp: e.timestamp,
      data: JSON.parse(e.data || '{}')
    })));

    db.close();
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get device events:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
});

// Get device twin (accepts device name or UUID)
app.get('/api/devices/:deviceId/twin', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    // Resolve device identifier to UUID
    const uuid = resolveDeviceIdentifier(deviceId, db);
    db.close();
    
    if (!uuid) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    
    // TODO: Call twin service via D-Bus to get twin state
    // For now, return a mock response
    res.json({
      deviceId,
      desired: {},
      reported: {},
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

    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    // Resolve device identifier to UUID
    const uuid = resolveDeviceIdentifier(deviceId, db);
    db.close();
    
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

    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    // Resolve device identifier to UUID
    const uuid = resolveDeviceIdentifier(deviceId, db);
    db.close();
    
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
    const db = openDb(DEVICEHUB_DB);
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    const totalStmt = db.prepare('SELECT COUNT(*) as total FROM devices');
    const total = (totalStmt.get() as any).total;

    // Online count not available without last_seen column
    const online = 0;

    const statusStmt = db.prepare('SELECT status, COUNT(*) as count FROM devices GROUP BY status');
    const statusCounts = statusStmt.all();

    res.json({
      total,
      online,
      offline: total - online,
      byStatus: statusCounts
    });

    db.close();
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to get statistics:`, e.message);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

// Start the service
async function start() {
  console.log(`[${SERVICE}] Starting Application Interface Service...`);
  
  // Initialize database
  initializeDatabase();
  
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
