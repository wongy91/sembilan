const REGION = [99.0, 0.5, 120.0, 8.0];
const REPORT_TTL_MIN = { accident: 90, police: 60, hazard: 120, jam: 30, closure: 240, flood: 360, pothole: 1440 };
const MAX_REPORTS_PER_HOUR = 10;
const MAX_BODY = 2048;
const PLUS_FARE_URL = 'https://plusapp-api-prod1.azurewebsites.net/api/tolls/GetTollFare';
const FARE_TTL_MS = 12 * 3600000;
const fareCache = new Map();
const SEARCH_TTL_MS = 6 * 3600000;
const searchCache = new Map();
const NEARBY_CATEGORIES = { fuel: '7311', food: '7315', parking: '7369,7313', ev: '7309' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function inRegion(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= REGION[0] && lon <= REGION[2] && lat >= REGION[1] && lat <= REGION[3];
}

function lonLat(value, field) {
  if (!Array.isArray(value) || value.length !== 2) throw new HttpError(400, `${field} must be [lon, lat]`);
  const [lon, lat] = value.map(Number);
  if (!inRegion(lon, lat)) throw new HttpError(400, `${field} is outside Malaysia`);
  return [lon, lat];
}

async function body(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'body too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

async function reporterId(request, env, now) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const day = new Date(now).toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip}|${day}|${env.REPORT_SALT || 'sembilan'}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function route(request, env) {
  if (!env.TOMTOM_API_KEY) throw new HttpError(501, 'live traffic routing is not configured');
  const input = await body(request);
  const from = lonLat(input.from, 'from');
  const to = lonLat(input.to, 'to');
  const params = new URLSearchParams({
    key: env.TOMTOM_API_KEY,
    traffic: 'true',
    travelMode: 'car',
    routeType: 'fastest',
    maxAlternatives: '2',
    instructionsType: 'coded',
    computeTravelTimeFor: 'all',
    routeRepresentation: 'polyline',
  });
  for (const type of ['tollRoad', 'traffic', 'motorway', 'speedLimit']) params.append('sectionType', type);
  if (input.avoidTolls) params.append('avoid', 'tollRoads');
  if (input.avoidHighways) params.append('avoid', 'motorways');
  const heading = Number(input.heading);
  if (input.heading != null && Number.isFinite(heading)) params.set('vehicleHeading', String(Math.round(((heading % 360) + 360) % 360)));
  const path = `${from[1]},${from[0]}:${to[1]},${to[0]}`;
  const upstream = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${path}/json?${params}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!upstream.ok) throw new HttpError(502, `routing upstream returned ${upstream.status}`);
  const data = await upstream.json();
  return json({ routes: data.routes || [] });
}

async function trafficTile(env, ctx, url, match) {
  if (!env.TOMTOM_API_KEY) throw new HttpError(501, 'traffic tiles are not configured');
  const [z, x, y] = match.slice(1).map(Number);
  if (z < 5 || z > 18 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new HttpError(400, 'bad tile');
  const cache = globalThis.caches?.default;
  const key = new Request(url.toString());
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  const upstream = await fetch(
    `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.png?tileSize=256&key=${encodeURIComponent(env.TOMTOM_API_KEY)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!upstream.ok) return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  const res = new Response(upstream.body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=60' } });
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

function tomtomPlace(r) {
  const a = r.address || {};
  const at = r.entryPoints?.find((e) => e.type === 'main')?.position || r.position;
  if (!Number.isFinite(at?.lat) || !Number.isFinite(at?.lon)) return null;
  const street = [a.streetNumber, a.streetName].filter(Boolean).join(' ');
  const name = r.poi?.name || street || a.municipalitySubdivision || a.municipality || a.freeformAddress || '';
  const parts = [r.poi ? street : '', a.municipalitySubdivision, a.municipality, a.countrySubdivision].filter((p) => p && p !== name);
  return { name, sub: [...new Set(parts)].join(', '), lon: at.lon, lat: at.lat };
}

async function search(env, url, now) {
  if (!env.TOMTOM_API_KEY) throw new HttpError(501, 'search is not configured');
  const q = (url.searchParams.get('q') || '').trim();
  const cat = url.searchParams.get('cat');
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!inRegion(lon, lat)) throw new HttpError(400, 'lat and lon must be inside Malaysia');
  if (cat ? !NEARBY_CATEGORIES[cat] : q.length < 2 || q.length > 120) {
    throw new HttpError(400, cat ? 'unknown category' : 'q must be 2 to 120 characters');
  }
  const key = `${cat ? `cat:${cat}` : q.toLowerCase()}|${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = searchCache.get(key);
  if (hit && now - hit.time < SEARCH_TTL_MS) return json({ results: hit.results });
  const params = new URLSearchParams({ key: env.TOMTOM_API_KEY, lat: String(lat), lon: String(lon), language: 'en-GB' });
  let path;
  if (cat) {
    Object.entries({ categorySet: NEARBY_CATEGORIES[cat], radius: '10000', limit: '20' }).forEach(([k, v]) => params.set(k, v));
    path = 'nearbySearch/.json';
  } else {
    Object.entries({ typeahead: 'true', countrySet: 'MY,SG', limit: '8' }).forEach(([k, v]) => params.set(k, v));
    path = `search/${encodeURIComponent(q)}.json`;
  }
  const upstream = await fetch(`https://api.tomtom.com/search/2/${path}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!upstream.ok) throw new HttpError(502, `search upstream returned ${upstream.status}`);
  const results = ((await upstream.json()).results || []).map(tomtomPlace).filter((p) => p?.name);
  searchCache.set(key, { results, time: now });
  if (searchCache.size > 2000) searchCache.delete(searchCache.keys().next().value);
  return json({ results });
}

async function plusFare(from, to, now) {
  const key = `${from}/${to}`;
  const hit = fareCache.get(key);
  if (hit && now - hit.time < FARE_TTL_MS) return hit.fare;
  const upstream = await fetch(`${PLUS_FARE_URL}/${from}/${to}/1`, {
    signal: AbortSignal.timeout(6000),
    cf: { cacheTtl: FARE_TTL_MS / 1000, cacheEverything: true },
  });
  if (!upstream.ok) throw new Error(`fare upstream returned ${upstream.status}`);
  const text = (await upstream.text()).trim();
  const fare = /^\d{1,4}(\.\d{1,2})?$/.test(text) ? Number(text) : null;
  fareCache.set(key, { fare, time: now });
  if (fareCache.size > 2000) fareCache.delete(fareCache.keys().next().value);
  return fare;
}

async function fares(request, now) {
  const { pairs } = await body(request);
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 12) throw new HttpError(400, 'pairs must hold 1 to 12 [from, to] plaza codes');
  if (!pairs.every((p) => Array.isArray(p) && p.length === 2 && p.every((c) => /^[A-Z]{3}$/.test(c)))) {
    throw new HttpError(400, 'plaza codes are three capital letters');
  }
  const results = await Promise.all(pairs.map(([from, to]) => plusFare(from, to, now).catch(() => undefined)));
  return json({
    currency: 'MYR',
    vehicleClass: 1,
    source: 'PLUS fare service (www.plus.com.my)',
    fares: results.map((r) => r ?? null),
    failed: results.filter((r) => r === undefined).length,
  });
}

function requireDb(env) {
  if (!env.DB) throw new HttpError(501, 'community reports are not configured');
  return env.DB;
}

async function listReports(env, url, now) {
  const db = requireDb(env);
  const box = (url.searchParams.get('bbox') || '').split(',').map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) throw new HttpError(400, 'bbox=minLon,minLat,maxLon,maxLat');
  const [minLon, minLat, maxLon, maxLat] = box;
  if (maxLon <= minLon || maxLat <= minLat || maxLon - minLon > 8 || maxLat - minLat > 8) throw new HttpError(400, 'bbox too large');
  const { results } = await db
    .prepare(
      `SELECT id, kind, lat, lon, heading, created_at, up, down FROM reports
       WHERE expires_at > ? AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT 300`,
    )
    .bind(now, minLon, maxLon, minLat, maxLat)
    .all();
  return json({ reports: results.map((r) => ({ ...r, age: now - r.created_at })) });
}

async function vote(db, id, reporter, up, now) {
  const report = await db.prepare('SELECT id, kind, created_at, expires_at, up, down FROM reports WHERE id = ?').bind(id).first();
  if (!report || report.expires_at <= now) throw new HttpError(404, 'report not found');
  const inserted = await db
    .prepare('INSERT OR IGNORE INTO votes (report_id, reporter, up, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, reporter, up ? 1 : 0, now)
    .run();
  if (!inserted.meta.changes) throw new HttpError(409, 'already voted');
  const ttl = REPORT_TTL_MIN[report.kind] * 60000;
  if (up) {
    const expires = Math.min(now + ttl, Math.max(report.expires_at, now + ttl / 2));
    await db.prepare('UPDATE reports SET up = up + 1, expires_at = ? WHERE id = ?').bind(expires, id).run();
    return { id, up: report.up + 1, down: report.down, expiresAt: expires };
  }
  const down = report.down + 1;
  const expires = down >= 2 && down > report.up ? now : report.expires_at;
  await db.prepare('UPDATE reports SET down = ?, expires_at = ? WHERE id = ?').bind(down, expires, id).run();
  return { id, up: report.up, down, expiresAt: expires, removed: expires <= now };
}

async function createReport(request, env, now) {
  const db = requireDb(env);
  const input = await body(request);
  const kind = String(input.kind || '');
  if (!REPORT_TTL_MIN[kind]) throw new HttpError(400, 'unknown report kind');
  const lon = Number(input.lon);
  const lat = Number(input.lat);
  if (!inRegion(lon, lat)) throw new HttpError(400, 'position is outside Malaysia');
  const heading = input.heading == null || !Number.isFinite(Number(input.heading)) ? null : ((Number(input.heading) % 360) + 360) % 360;
  const reporter = await reporterId(request, env, now);
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created_at > ?')
    .bind(reporter, now - 3600000)
    .first('n');
  if (recent >= MAX_REPORTS_PER_HOUR) throw new HttpError(429, 'too many reports, try again later');
  const near = await db
    .prepare(
      `SELECT id FROM reports WHERE kind = ? AND expires_at > ?
       AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 1`,
    )
    .bind(kind, now, lat - 0.0015, lat + 0.0015, lon - 0.0015, lon + 0.0015)
    .first();
  if (near) {
    try {
      return json({ ...(await vote(db, near.id, reporter, true, now)), merged: true });
    } catch (err) {
      if (err.status === 409) return json({ id: near.id, merged: true });
      throw err;
    }
  }
  const id = crypto.randomUUID();
  const expiresAt = now + REPORT_TTL_MIN[kind] * 60000;
  await db
    .prepare('INSERT INTO reports (id, kind, lat, lon, heading, reporter, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, kind, lat, lon, heading, reporter, now, expiresAt)
    .run();
  await db.prepare('INSERT INTO votes (report_id, reporter, up, created_at) VALUES (?, ?, 1, ?)').bind(id, reporter, now).run();
  return json({ id, kind, lat, lon, heading, expiresAt }, 201);
}

export async function purge(db, now) {
  const cutoff = now - 86400000;
  await db.prepare('DELETE FROM votes WHERE report_id IN (SELECT id FROM reports WHERE expires_at < ?)').bind(cutoff).run();
  await db.prepare('DELETE FROM reports WHERE expires_at < ?').bind(cutoff).run();
}

async function api(request, env, ctx, url) {
  const now = Date.now();
  const { pathname } = url;
  const method = request.method;
  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, traffic: !!env.TOMTOM_API_KEY, reports: !!env.DB, fares: true, search: !!env.TOMTOM_API_KEY });
  }
  if (pathname === '/api/search' && method === 'GET') return search(env, url, now);
  if (pathname === '/api/route' && method === 'POST') return route(request, env);
  if (pathname === '/api/fares' && method === 'POST') return fares(request, now);
  const tile = /^\/api\/traffic\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(pathname);
  if (tile && method === 'GET') return trafficTile(env, ctx, url, tile);
  if (pathname === '/api/reports' && method === 'GET') return listReports(env, url, now);
  if (pathname === '/api/reports' && method === 'POST') return createReport(request, env, now);
  const voting = /^\/api\/reports\/([0-9a-f-]{36})\/vote$/.exec(pathname);
  if (voting && method === 'POST') {
    const db = requireDb(env);
    const input = await body(request);
    return json(await vote(db, voting[1], await reporterId(request, env, now), input.up !== false, now));
  }
  throw new HttpError(404, 'not found');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    try {
      return await api(request, env, ctx, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err?.name === 'TimeoutError') return json({ error: 'upstream timeout' }, 504);
      console.error(err);
      return json({ error: 'internal error' }, 500);
    }
  },
  async scheduled(_event, env) {
    if (env.DB) await purge(env.DB, Date.now());
  },
};
