import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import morgan from 'morgan';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';

const app = express();
const PORT = Number(process.env.PORT || (process.env.NODE_ENV === 'production' ? 80 : 8080));

app.use(morgan('dev'));
app.use(cors());
app.get('/healthz', (_req: Request, res: Response) => res.json({ status: 'ok' }));

// Core-service owns the public HTTP(S) surface: define API routes here.
app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

// Log a startup hello from core-service
console.log('[core-service] hello from Fleet Hub core-service');

// Unified logs: snapshot and streaming from systemd journal (journalctl)
// Services are expected to be systemd units like fleethub-*.service
const DEFAULT_LOG_UNITS = [
  'fleethub-core.service',
  'fleethub-provisioning.service',
  'fleethub-twin.service',
  'fleethub-api.service',
  'fleethub-registry.service',
];

function buildJournalctlArgs(opts: {
  units?: string[];
  lines?: number;
  since?: string;
  follow?: boolean;
  output?: 'json' | 'json-pretty' | 'short';
}) {
  const args: string[] = [];
  const units = opts.units && opts.units.length ? opts.units : DEFAULT_LOG_UNITS;
  for (const u of units) {
    args.push('-u', u);
  }
  if (opts.lines != null) {
    args.push('-n', String(opts.lines));
  }
  if (opts.since) {
    args.push('--since', opts.since);
  }
  if (opts.follow) {
    args.push('-f');
  }
  args.push('-o', opts.output ?? 'json');
  return args;
}

// GET /api/services -> systemd unit status snapshot
app.get('/api/services', async (_req: Request, res: Response) => {
  const units = DEFAULT_LOG_UNITS;
  const checks = await Promise.all(units.map(async (u) => {
    try {
      const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const p = spawn('systemctl', ['is-active', u], { stdio: ['ignore', 'pipe', 'pipe'] });
        const out: string[] = [];
        const err: string[] = [];
        p.stdout.on('data', (c: Buffer) => out.push(c.toString()));
        p.stderr.on('data', (c: Buffer) => err.push(c.toString()));
        p.on('close', (code: number | null) => resolve({ code, out: out.join('').trim(), err: err.join('') }));
      });
      return { unit: u, status: result.out || 'unknown' };
    } catch (e) {
      return { unit: u, status: 'error' };
    }
  }));
  res.json({ services: checks });
});

// GET /api/logs -> recent logs snapshot
// Query: units=comma,separated (optional), lines=number (default 200), since=systemd-time (optional)
app.get('/api/logs', (req: Request, res: Response) => {
  const units = typeof req.query.units === 'string' && req.query.units
    ? String(req.query.units).split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  const lines = req.query.lines ? Number(req.query.lines) : 200;
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;

  const args = buildJournalctlArgs({ units, lines, since, output: 'json' });
  const proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const out: string[] = [];
  const err: string[] = [];
  proc.stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()));
  proc.stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
  proc.on('close', (code: number | null) => {
    if (code !== 0) {
      res.status(500).json({ error: 'journalctl failed', code, stderr: err.join('') });
      return;
    }
    // journalctl -o json outputs NDJSON (one JSON per line)
    const linesArr = out.join('').split('\n').filter(Boolean);
    const entries = linesArr.map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
    res.json({ entries });
  });
});

// GET /api/logs/stream -> SSE stream of logs
// Query: units=comma,separated (optional), since=systemd-time (optional)
app.get('/api/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const units = typeof req.query.units === 'string' && req.query.units
    ? String(req.query.units).split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;

  const args = buildJournalctlArgs({ units, since, follow: true, output: 'json' });
  const proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  proc.stdout.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        send('log', obj);
      } catch {
        send('log', { raw: line });
      }
    }
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    send('stderr', { message: chunk.toString() });
  });
  proc.on('close', (code: number | null) => {
    send('end', { code });
    res.end();
  });

  req.on('close', () => {
    proc.kill('SIGTERM');
  });
});

// Where to serve UI from.
// Default to production install location of the built UI: /opt/Edgeberry/fleethub/ui/build
// Allow override via UI_DIST for local/dev.
const defaultUiRoot = '/opt/Edgeberry/fleethub/ui/build';
const UI_DIST = process.env.UI_DIST || defaultUiRoot;
const UI_EXISTS = fs.existsSync(UI_DIST);
const UI_INDEX = path.join(UI_DIST, 'index.html');
const UI_READY = UI_EXISTS && fs.existsSync(UI_INDEX);

// If UI build (with index.html) is missing, provide a minimal dashboard at '/'
if (!UI_READY) {
  app.get('/', (_req: Request, res: Response) => {
    res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Edgeberry Fleet Hub — Hello World</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;line-height:1.4;margin:2rem;color:#111}
      h1{margin:0 0 0.5rem}
      .muted{color:#666}
      table{border-collapse:collapse;width:100%;margin-top:1rem}
      th,td{border:1px solid #ddd;padding:8px}
      th{background:#f5f5f5;text-align:left}
      .ok{color:#0a7a0a;font-weight:600}
      .bad{color:#b00020;font-weight:600}
      pre{background:#0b1020;color:#e6edf3;padding:12px;border-radius:8px;overflow:auto;max-height:300px}
      .actions{margin:12px 0}
      button{padding:6px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}
      button:hover{background:#f5f5f5}
    </style>
  </head>
  <body>
    <h1>Edgeberry Fleet Hub</h1>
    <div class="muted">Hello World demo — core-service serves UI and API</div>
    <div class="actions">
      <button id="emit">Emit demo hello logs</button>
    </div>
    <h2>Services</h2>
    <table id="svc">
      <thead><tr><th>Unit</th><th>Status</th></tr></thead>
      <tbody></tbody>
    </table>
    <h2>Recent logs</h2>
    <pre id="logs">loading…</pre>
    <script>
      async function refreshServices(){
        const res = await fetch('/api/services');
        const data = await res.json();
        const tbody = document.querySelector('#svc tbody');
        tbody.innerHTML = '';
        for (const s of data.services){
          const tr = document.createElement('tr');
          const stOk = s.status === 'active';
          tr.innerHTML = '<td>' + s.unit + '</td><td class="' + (stOk ? 'ok' : 'bad') + '">' + s.status + '</td>';
          tbody.appendChild(tr);
        }
      }
      async function loadLogs(){
        const res = await fetch('/api/logs?lines=100');
        const data = await res.json();
        const el = document.getElementById('logs');
        const lines = data.entries.map(e => {
          const t = e.__REALTIME_TIMESTAMP || e._SOURCE_REALTIME_TIMESTAMP || '';
          const unit = e.SYSLOG_IDENTIFIER || e._SYSTEMD_UNIT || '';
          const msg = e.MESSAGE || JSON.stringify(e);
          return '[' + unit + '] ' + msg;
        });
        el.textContent = lines.join('\n');
      }
      async function emitHello(){
        await fetch('/api/logs/hello', { method: 'POST' });
        setTimeout(loadLogs, 500);
      }
      document.getElementById('emit').addEventListener('click', emitHello);
      refreshServices();
      loadLogs();
      setInterval(refreshServices, 5000);
    </script>
  </body>
</html>`);
  });
}

// Serve built UI and SPA fallback only when UI is ready
if (UI_READY) {
  app.use(express.static(UI_DIST));
  app.get('*', (_req: Request, res: Response, next: NextFunction) => {
    res.sendFile(UI_INDEX, (err: unknown) => {
      if (err) next();
    });
  });
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[core-service] listening on :${PORT}, UI_DIST=${UI_DIST}`);
});
