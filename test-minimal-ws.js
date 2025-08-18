const { WebSocketServer } = require('ws');
const http = require('http');

console.log('Creating minimal WebSocket server...');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket test server');
});

const wss = new WebSocketServer({ 
  server,
  path: '/test-ws'
});

wss.on('connection', (ws, req) => {
  console.log('WebSocket connection established');
  
  ws.on('message', (data) => {
    console.log('Received:', String(data));
    ws.send(JSON.stringify({ type: 'echo', data: String(data) }));
  });
  
  ws.on('close', (code, reason) => {
    console.log('Connection closed:', code, String(reason));
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to test server' }));
});

server.listen(8080, () => {
  console.log('Test WebSocket server listening on port 8080');
  console.log('Test with: ws://localhost:8080/test-ws');
});
