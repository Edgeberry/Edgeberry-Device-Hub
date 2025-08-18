const WebSocket = require('ws');

console.log('Testing detailed WS connection...');
const ws = new WebSocket('ws://192.168.1.116/api/ws');

let connected = false;
let messageReceived = false;

ws.on('open', () => {
  console.log('WS OPEN - connection established');
  connected = true;
  
  // Send subscribe message
  const subscribeMsg = JSON.stringify({
    type: 'subscribe',
    topics: ['services.status', 'devices.list.public', 'metrics.snapshots']
  });
  console.log('Sending:', subscribeMsg);
  ws.send(subscribeMsg);
});

ws.on('message', (data) => {
  console.log('WS MESSAGE received:', String(data));
  messageReceived = true;
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('WS ERROR:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('WS CLOSED:', code, String(reason));
  if (connected && !messageReceived) {
    console.log('Connection was established but closed before receiving messages');
  }
  process.exit(code === 1000 ? 0 : 1);
});

// Timeout after 15 seconds
setTimeout(() => {
  console.log('Timeout - closing connection');
  ws.close();
  process.exit(1);
}, 15000);
