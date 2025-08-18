const WebSocket = require('ws');

console.log('Testing WS connection...');
const ws = new WebSocket('ws://192.168.1.116/api/ws');

let connected = false;

ws.on('open', () => {
  console.log('WS OPEN - connection established');
  connected = true;
  ws.send(JSON.stringify({
    type: 'subscribe',
    topics: ['services.status', 'devices.list.public', 'metrics.snapshots']
  }));
  console.log('Subscribe message sent');
});

ws.on('message', (data) => {
  console.log('WS MSG received:', String(data));
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('WS ERROR:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('WS CLOSED:', code, String(reason));
  if (connected) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

setTimeout(() => {
  if (!connected) {
    console.log('Connection timeout');
    ws.close();
    process.exit(1);
  } else {
    console.log('Message timeout - no data received');
    ws.close();
    process.exit(1);
  }
}, 10000);
