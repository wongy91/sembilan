import { encodePolyline, slice, thin } from './geo.js';
import { attachLanes, laneCatalog } from './lanes.js';
import { distinctRoutes, fromOsrm, fromTomTom, fromValhalla } from './providers.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const LANE_WINDOW = 190000;
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const REFERENCE_POINTS = 1500;
const FASTER_MIN_SAVING = 180;
const FASTER_MIN_SHARE = 0.05;

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

function valhalla(from, to, { avoidTolls, avoidHighways, heading, via, signal }) {
  const origin = { lon: from[0], lat: from[1] };
  if (Number.isFinite(heading)) Object.assign(origin, { heading: Math.round(heading), heading_tolerance: 60 });
  const stop = via ? [{ lon: via[0], lat: via[1], type: 'break' }] : [];
  const body = {
    locations: [origin, ...stop, { lon: to[0], lat: to[1] }],
    costing: 'auto',
    costing_options: { auto: { use_tolls: avoidTolls ? 0 : 0.5, use_highways: avoidHighways ? 0 : 1 } },
    alternates: 2,
    units: 'kilometers',
  };
  return getJson(`${VALHALLA}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
}

function osrm(from, to, { via, signal }) {
  const path = [from, via, to].filter(Boolean).map(([lon, lat]) => `${lon},${lat}`).join(';');
  return getJson(`${OSRM}/${path}?overview=full&geometries=polyline6&steps=true&alternatives=true`, { signal });
}

function tomtom(from, to, { avoidTolls, avoidHighways, heading, via, signal }) {
  return getJson('/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, via: via || null, to, avoidTolls, avoidHighways, heading: Number.isFinite(heading) ? heading : null }),
    signal,
  });
}

export async function planRoutes(from, to, options = {}) {
  const attempts = [];
  if (options.liveTraffic) attempts.push(async () => fromTomTom(await tomtom(from, to, options)));
  attempts.push(async () => fromValhalla(await valhalla(from, to, options)));
  attempts.push(async () => fromOsrm(await osrm(from, to, options)));
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const routes = distinctRoutes(await attempt());
      if (routes.length) return routes.slice(0, 3);
    } catch (err) {
      if (options.signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError || new Error('no route');
}

export async function fasterRoute(route, along, { avoidTolls, avoidHighways, signal } = {}) {
  const spacing = Math.max(100, (route.distance - along) / REFERENCE_POINTS);
  const reference = thin(slice(route.coords, route.cum, along), spacing).map(([lon, lat]) => [+lon.toFixed(5), +lat.toFixed(5)]);
  const json = await getJson('/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, avoidTolls, avoidHighways }),
    signal,
  });
  const [current, ...better] = fromTomTom(json);
  return { current, better };
}

export function pickFaster({ current, better }) {
  const best = [...(better || [])].sort((a, b) => a.duration - b.duration)[0];
  if (!current || !best) return null;
  const saving = current.duration - best.duration;
  return saving >= FASTER_MIN_SAVING && saving >= current.duration * FASTER_MIN_SHARE ? { route: best, saving } : null;
}

export async function loadLanes(route, from = 0) {
  const to = Math.min(route.distance, from + LANE_WINDOW);
  const json = await getJson(`${VALHALLA}/trace_route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      encoded_polyline: encodePolyline(slice(route.coords, route.cum, from, to)),
      costing: 'auto',
      shape_match: 'map_snap',
      format: 'osrm',
    }),
  });
  attachLanes(route, laneCatalog(json), from, to);
  return to;
}
