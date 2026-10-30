const VERSION = 'sembilan-dev';
const TILES = 'sembilan-tiles';
const SHELL = [
  './',
];
const LIBRARY = [
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/maplibre-gl.css',
];
const MAX_TILES = 4000;
const SAVE_BYTES = 15 * 1024 * 1024;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
      await Promise.all(LIBRARY.map((url) => cache.add(new Request(url, { mode: 'cors' })).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION && key !== TILES) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function shell(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request.mode === 'navigate' ? './' : request, { ignoreSearch: true });
  return hit || fetch(request);
}

let writes = 0;
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES * 0.85).map((k) => cache.delete(k)));
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(request, res.clone());
        if (++writes % 200 === 0) trim(cache);
      }
      return res;
    })
    .catch(() => null);
  return hit || (await update) || Response.error();
}

async function saveTiles(urls) {
  const cache = await caches.open(TILES);
  const queue = urls.filter((url) => typeof url === 'string' && url.startsWith('https://tiles.openfreemap.org/'));
  let bytes = 0;
  const work = async () => {
    while (queue.length && bytes < SAVE_BYTES) {
      const url = queue.shift();
      if (await cache.match(url)) continue;
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) continue;
        bytes += Number(res.headers.get('content-length')) || (await res.clone().arrayBuffer()).byteLength;
        await cache.put(url, res);
      } catch {}
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  await trim(cache);
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'save-tiles' && Array.isArray(event.data.urls)) event.waitUntil(saveTiles(event.data.urls));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith('/api/')) event.respondWith(shell(request));
  } else if (url.hostname === 'tiles.openfreemap.org') {
    event.respondWith(staleWhileRevalidate(request));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});
