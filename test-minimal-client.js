const WebSocket = require('ws');

console.log('Testing minimal WebSocket client...');
const ws = new WebSocket('ws://localhost:8080/test-ws');

ws.on('open', () => {
  console.log('Connected to test server');
  ws.send(JSON.stringify({ type: 'test', message: 'Hello from client' }));
});

ws.on('message', (data) => {
  console.log('Received from server:', String(data));
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('Connection closed:', code, String(reason));
  process.exit(code === 1000 ? 0 : 1);
});

setTimeout(() => {
  console.log('Timeout - closing connection');
  ws.close();
  process.exit(1);
}, 5000);
