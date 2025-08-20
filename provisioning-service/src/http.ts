import http from 'http';
import { readFile } from 'fs/promises';
import { SERVICE, CA_CRT_PATH, MQTT_TLS_CERT, MQTT_TLS_KEY, HTTP_ENABLE_CERT_API, HTTP_PORT } from './config.js';

export interface HttpServerConfig {
  host?: string;
  port?: number;
}

export function startHttpServer({ host = '0.0.0.0', port = HTTP_PORT }: HttpServerConfig = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end('bad request');
        return;
      }
      // Very small, read-only file serving for specific endpoints
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET');
        res.end('method not allowed');
        return;
      }

      if (req.url === '/health') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.url === '/certs/ca.crt') {
        const body = await readFile(CA_CRT_PATH);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-pem-file');
        res.end(body);
        return;
      }

      if (req.url === '/certs/provisioning.crt') {
        if (!HTTP_ENABLE_CERT_API) { res.statusCode = 403; res.end('forbidden'); return; }
        if (!MQTT_TLS_CERT) { res.statusCode = 404; res.end('not found'); return; }
        const body = await readFile(MQTT_TLS_CERT);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-pem-file');
        res.end(body);
        return;
      }

      if (req.url === '/certs/provisioning.key') {
        if (!HTTP_ENABLE_CERT_API) { res.statusCode = 403; res.end('forbidden'); return; }
        if (!MQTT_TLS_KEY) { res.statusCode = 404; res.end('not found'); return; }
        const body = await readFile(MQTT_TLS_KEY);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-pem-file');
        res.end(body);
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    } catch (e: any) {
      res.statusCode = 500;
      res.end(`server error: ${e?.message || e}`);
    }
  });

  server.listen(port, host, () => {
    console.log(`[${SERVICE}] http listening on http://${host}:${port} (cert API ${HTTP_ENABLE_CERT_API ? 'enabled' : 'disabled'})`);
  });

  server.on('error', (err) => {
    console.error(`[${SERVICE}] http error`, err);
  });

  return server;
}
