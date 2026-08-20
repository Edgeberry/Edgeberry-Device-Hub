/*
 *  Terminal service
 *
 *  Backs the Terminal panel in the admin UI, and nothing else. Spawns a PTY
 *  per WebSocket connection on /ws/terminal and relays data both ways. Two
 *  message types in each direction: 'data' and, inbound, 'resize'.
 *
 *  Unlike the device software's equivalent, this one authenticates. That
 *  difference is the whole point: a device sits on a LAN, but the Hub answers
 *  on the public internet, so an unauthenticated PTY here would be a root
 *  shell for anyone who found the URL. The handshake is gated on the same
 *  session cookie the admin API uses (see auth.ts's authRequired) - if it is
 *  missing, expired or forged, the socket is closed before any process is
 *  spawned.
 *
 *  This deliberately exposes a `handleUpgrade` rather than attaching itself to
 *  the HTTP server. `ws` attached with { server, path } installs its own
 *  upgrade listener that aborts every path it does not own with a 400, so two
 *  such servers on one HTTP server cannot coexist - the first to run kills the
 *  other's handshake. index.ts owns one upgrade router and dispatches to this.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, SESSION_COOKIE } from './config.js';
import { parseCookies } from './auth.js';
import { isAuthDisabled, isWebTerminalEnabled } from './app-settings.js';

export const TERMINAL_PATH = '/ws/terminal';

/** The shell's starting size, replaced by the client's first 'resize'. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Who is asking, or null if nobody we recognise.
 *
 * Same rules as the admin WebSocket: the session cookie carries a JWT, and an
 * operator who has delegated auth to a reverse proxy can turn the check off
 * (isAuthDisabled) - in which case the proxy is doing it instead.
 */
function authenticate(req: IncomingMessage): string | null {
  if (isAuthDisabled()) return 'proxy-authenticated';
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string; user?: string };
    return payload.user || payload.sub || null;
  } catch {
    // Expired, malformed or wrongly-signed: all equally "not a session".
    return null;
  }
}

export function createTerminalService(): {
  path: string;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
} {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage & { user?: string }) => {
    // Imported here rather than at module load: node-pty is a native module,
    // and a Hub whose build lacks it should lose the terminal, not fail to
    // boot and take provisioning, twin and the application API down with it.
    let pty: typeof import('node-pty');
    try {
      pty = await import('node-pty');
    } catch (error: any) {
      console.error('[terminal] node-pty unavailable:', error?.message || error);
      try {
        ws.send(JSON.stringify({ type: 'data', data: 'Terminal unavailable: node-pty is not installed on this host.\r\n' }));
        ws.close();
      } catch { /* already gone */ }
      return;
    }

    const shell = process.env.SHELL || '/bin/bash';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: process.env.HOME || '/',
      env: process.env as { [key: string]: string },
    });

    console.log(`[terminal] PTY session opened for ${req.user} (pid ${ptyProcess.pid})`);

    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
    });

    ptyProcess.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'exit' }));
      ws.close();
    });

    ws.on('message', (msg: Buffer) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'data') {
          ptyProcess.write(parsed.data);
        } else if (parsed.type === 'resize') {
          const cols = Number(parsed.cols);
          const rows = Number(parsed.rows);
          // A zero or NaN dimension throws inside the pty; the client sends
          // its size from a ResizeObserver, which can fire on a hidden panel.
          if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
            ptyProcess.resize(cols, rows);
          }
        }
      } catch { /* not our protocol; ignore */ }
    });

    ws.on('close', () => {
      try { ptyProcess.kill(); } catch { /* already dead */ }
      console.log(`[terminal] PTY session closed for ${req.user}`);
    });
  });

  return {
    path: TERMINAL_PATH,
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      // Read per connection, not at boot: `devicehub --enable-webterminal`
      // takes effect on the next attempt, with no service restart - and so
      // does turning it off again, which matters more.
      if (!isWebTerminalEnabled()) {
        console.warn('[terminal] Refused: web terminal is disabled (enable with: devicehub --enable-webterminal)');
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const user = authenticate(req);
      if (!user) {
        console.warn('[terminal] Rejected unauthenticated terminal upgrade');
        // Answered at the HTTP layer, before the WebSocket exists - the
        // handshake never completes, so no PTY is ever spawned.
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        (req as IncomingMessage & { user?: string }).user = user;
        wss.emit('connection', ws, req);
      });
    },
  };
}
