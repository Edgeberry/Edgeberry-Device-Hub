// Lightweight WebSocket client with topic-based pub/sub and auto-reconnect

let ws: WebSocket | null = null;
let connected = false;
let wantOpen = false;
let backoff = 500; // ms, doubles up to 10s
const maxBackoff = 10000;

// topic -> set of handlers
const subs = new Map<string, Set<(data: any) => void>>();

function url(){
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/ws`;
}

function open(){
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  wantOpen = true;
  try{
    ws = new WebSocket(url());
  }catch{
    scheduleReconnect();
    return;
  }
  ws.addEventListener('open', () => {
    connected = true;
    backoff = 500;
    // resubscribe all topics
    const topics = Array.from(subs.keys());
    if (topics.length) send({ type: 'subscribe', topics });
  });
  ws.addEventListener('message', (ev) => {
    try{
      const msg = JSON.parse(String(ev.data||'{}'));
      const t = msg?.type;
      if(!t) return;
      // normalize metrics.history.append to metrics.history
      const topic = t === 'metrics.history.append' ? 'metrics.history' : t;
      const handlers = subs.get(topic);
      if (!handlers || handlers.size === 0) return;
      handlers.forEach(fn => {
        try{ fn(msg.data); }catch{}
      });
    }catch{}
  });
  ws.addEventListener('close', () => { connected = false; scheduleReconnect(); });
  ws.addEventListener('error', () => { try{ ws?.close(); }catch{} });
}

function scheduleReconnect(){
  if(!wantOpen) return;
  setTimeout(open, backoff);
  backoff = Math.min(maxBackoff, backoff * 2);
}

function send(obj: any){
  try{
    if(ws && ws.readyState === WebSocket.OPEN){ ws.send(JSON.stringify(obj)); }
  }catch{}
}

export function subscribe(topic: string, handler: (data: any)=>void){
  if(!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic)!.add(handler);
  if(connected) send({ type: 'subscribe', topics: [topic] });
  open();
}

export function unsubscribe(topic: string, handler: (data: any)=>void){
  const set = subs.get(topic);
  if(set){ set.delete(handler); if(set.size === 0) subs.delete(topic); }
  if(connected) send({ type: 'unsubscribe', topics: [topic] });
}

export function isConnected(){ return connected; }
