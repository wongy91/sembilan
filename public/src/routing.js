import { encodePolyline, slice } from './geo.js';
import { attachLanes, laneCatalog } from './lanes.js';
import { distinctRoutes, fromOsrm, fromTomTom, fromValhalla } from './providers.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const LANE_WINDOW = 190000;
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

function valhalla(from, to, { avoidTolls, avoidHighways, heading, signal }) {
  const origin = { lon: from[0], lat: from[1] };
  if (Number.isFinite(heading)) Object.assign(origin, { heading: Math.round(heading), heading_tolerance: 60 });
  const body = {
    locations: [origin, { lon: to[0], lat: to[1] }],
    costing: 'auto',
    costing_options: { auto: { use_tolls: avoidTolls ? 0 : 0.5, use_highways: avoidHighways ? 0 : 1 } },
    alternates: 2,
    units: 'kilometers',
  };
  return getJson(`${VALHALLA}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
}

function osrm(from, to, { signal }) {
  const path = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  return getJson(`${OSRM}/${path}?overview=full&geometries=polyline6&steps=true&alternatives=true`, { signal });
}

function tomtom(from, to, { avoidTolls, avoidHighways, heading, signal }) {
  return getJson('/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, avoidTolls, avoidHighways, heading: Number.isFinite(heading) ? heading : null }),
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
