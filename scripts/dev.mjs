import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { createLocalD1 } from './d1-local.mjs';
import { headersFor, parseHeaders } from './headers.mjs';
import { stampedServiceWorker, stampedVersionModule } from './stamp-sw.mjs';

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
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

async function serveStatic(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  let path = normalize(pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = join(root, path);
  if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
  if (path === '/_headers') return new Response('Not found', { status: 404 });
  const extra = headersFor(parseHeaders(await readFile(join(root, '_headers'), 'utf8').catch(() => '')), pathname);
  if (path === '/sw.js' || path === '/src/version.js') {
    const body = path === '/sw.js' ? await stampedServiceWorker() : await stampedVersionModule();
    return new Response(body, { headers: { 'content-type': TYPES['.js'], 'cache-control': 'no-cache', ...extra } });
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    return new Response(await readFile(file), {
      headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', ...extra },
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
    for (const name of ['content-type', 'user-agent']) if (req.headers[name]) headers[name] = req.headers[name];
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
