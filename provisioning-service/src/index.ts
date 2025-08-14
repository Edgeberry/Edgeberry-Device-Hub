import http from 'http';
import https from 'https';

function httpGet(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res: http.IncomingMessage) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const service = 'provisioning-service';
  console.log(`[${service}] hello world`);
  const coreUrl = process.env.CORE_URL || 'http://localhost:8080/api/health';
  try {
    const body = await httpGet(coreUrl);
    console.log(`[${service}] core-service responded: ${body}`);
  } catch (err: any) {
    console.error(`[${service}] failed to reach core-service at ${coreUrl}: ${err?.message || err}`);
    process.exitCode = 1;
  }
}

// Run and exit
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
