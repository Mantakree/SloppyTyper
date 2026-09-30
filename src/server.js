import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const assets = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['replay.js', ['replay.js', 'text/javascript; charset=utf-8']],
  ['style.css', ['style.css', 'text/css; charset=utf-8']],
  ['favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

export async function createViewer(session, { port = 0, ttl = 2 * 60 * 60 * 1000 } = {}) {
  const token = randomBytes(24).toString('hex');
  const prefix = `/${token}/`;
  const staticFiles = new Map(await Promise.all([...assets].map(async ([key, [file, mime]]) => [key, { body: await readFile(new URL(`../web/${file}`, import.meta.url)), mime }])));
  const payload = JSON.stringify(session);
  const server = http.createServer((req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    };
    const reply = (status, body, mime = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...headers, 'Content-Type': mime });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return reply(403, 'Local sessions only.');
    if (!['GET', 'HEAD'].includes(req.method)) return reply(405, 'Read-only viewer.');
    if (!req.url.startsWith(prefix)) return reply(404, 'Session not found.');
    const route = req.url.slice(prefix.length);
    if (route === 'session.json') return reply(200, payload, 'application/json; charset=utf-8');
    const asset = staticFiles.get(route);
    if (asset) return reply(200, asset.body, asset.mime);
    reply(404, 'Not found.');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const timer = setTimeout(() => server.close(), ttl);
  timer.unref();
  server.once('close', () => clearTimeout(timer));
  return { server, url: `http://127.0.0.1:${server.address().port}${prefix}` };
}
