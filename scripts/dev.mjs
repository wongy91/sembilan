import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { createLocalD1 } from './d1-local.mjs';
import { stampedServiceWorker } from './stamp-sw.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 8787);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function serveStatic(request) {
  let path = normalize(decodeURIComponent(new URL(request.url).pathname));
  if (path.endsWith('/')) path += 'index.html';
  const file = join(root, path);
  if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
  if (path === '/sw.js') {
    return new Response(await stampedServiceWorker(), { headers: { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' } });
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    return new Response(await readFile(file), {
      headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

const env = {
  DB: createLocalD1(process.env.SEMBILAN_DB || ':memory:'),
  TOMTOM_API_KEY: process.env.TOMTOM_API_KEY || '',
  REPORT_SALT: 'dev',
  ASSETS: { fetch: serveStatic },
};

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = { 'cf-connecting-ip': req.socket.remoteAddress || 'local' };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('dev server error');
  }
}).listen(port, () => {
  console.log(`Sembilan on http://localhost:${port}`);
  console.log(`live traffic: ${env.TOMTOM_API_KEY ? 'on' : 'off (set TOMTOM_API_KEY)'}; community reports: local SQLite`);
});
