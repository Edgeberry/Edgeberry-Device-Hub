import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ADMIN_PASSWORD, ADMIN_USER, JWT_SECRET, JWT_TTL_SECONDS, SESSION_COOKIE } from './config.js';

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
  // Public endpoints (non-sensitive): health, metrics, service status, auth
  if (
    req.path === '/healthz' ||
    req.path === '/api/health' ||
    req.path === '/api/status' ||
    req.path === '/api/metrics' ||
    req.path === '/api/metrics/history' ||
    req.path === '/api/services'
  ) {
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
  // Allow anonymous read-only access to the devices list. The handler will strip UUIDs when unauthenticated.
  if (req.method === 'GET' && req.path === '/api/devices') {
    return next();
  }
  // Allow WebSocket upgrades to /api/ws - authentication is handled in the WebSocket connection handler
  if (req.path === '/api/ws' && req.headers.upgrade?.toLowerCase() === 'websocket') {
    return next();
  }
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
