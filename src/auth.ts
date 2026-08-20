import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ADMIN_PASSWORD, ADMIN_USER, JWT_SECRET, JWT_TTL_SECONDS, SESSION_COOKIE } from './config.js';
import { isAuthDisabled } from './app-settings.js';

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = decodeURIComponent(p.slice(0, idx).trim());
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

export function getSession(req: Request): { user: string; exp?: number } | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string; user?: string; iat?: number; exp?: number };
    const user = payload.user || payload.sub;
    if (!user) return null;
    return { user, exp: payload.exp };
  } catch {
    return null;
  }
}

/**
 * The session behind a raw HTTP request, or null.
 *
 * Same rules as getSession(), but reading a plain IncomingMessage rather than
 * an express Request - WebSocket upgrades never reach express, so both the
 * admin feed and the terminal authenticate here instead. Kept beside
 * getSession so the two can't drift into disagreeing about what a valid
 * session is.
 *
 * isAuthDisabled() is honoured for the same reason authRequired honours it:
 * the operator has delegated auth to something in front of the Hub.
 */
export function getSessionUserFromHeaders(cookieHeader?: string): string | null {
  if (isAuthDisabled()) return 'proxy-authenticated';
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string; user?: string };
    return payload.user || payload.sub || null;
  } catch {
    // Expired, malformed or wrongly signed: all equally "not a session".
    return null;
  }
}

export function setSessionCookie(res: Response, token: string) {
  const isHttps = false; // Note: HTTPS detection could be added via X-Forwarded-Proto or config if needed
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isHttps) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  // Escape hatch for deployments where a reverse proxy in front of the Hub
  // already handles authentication (nginx auth_basic, an oauth2-proxy, mTLS
  // at the edge, ...) - see `devicehub --disable-login` in cli.ts. Checked
  // first and unconditionally, since when this is set every other rule in
  // this function becomes moot: the operator has explicitly told us access
  // control is someone else's job now.
  if (isAuthDisabled()) {
    return next();
  }
  // Login is required for everything Device Hub data/control-related - no
  // anonymous "peek" view. What's left public here is deliberately narrow:
  // trivial liveness (health), the device-facing provisioning bootstrap
  // endpoints (devices don't have a login), and the auth flow itself (can't
  // require a session to *get* a session).
  if (req.path === '/healthz' || req.path === '/api/health') {
    return next();
  }
  // Explicitly allow provisioning bootstrap endpoints to be public (device bootstrap)
  // These must be accessible without authentication for virtual devices to fetch bootstrap certs.
  if (
    req.path === '/api/provisioning/health' ||
    req.path === '/api/provisioning/certs/ca.crt' ||
    req.path === '/api/provisioning/certs/provisioning.crt' ||
    req.path === '/api/provisioning/certs/provisioning.key'
  ) {
    return next();
  }
  // WebSocket upgrades never reach express middleware at all - they are
  // dispatched by the server's own 'upgrade' event (see index.ts's upgrade
  // router), which authenticates them there and answers a bare 401 on the
  // socket. Nothing to allow through here.
  if (req.path.startsWith('/api/auth/')) return next();
  const s = getSession(req);
  if (!s) {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    return next();
  }
  next();
}
