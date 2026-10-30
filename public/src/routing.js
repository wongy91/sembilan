import { encodePolyline, pointAt, slice, thin } from './geo.js';
import { attachLanes, laneCatalog } from './lanes.js';
import { distinctRoutes, fromOsrm, fromTomTom, fromValhalla } from './providers.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const LANE_WINDOW = 190000;
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const REFERENCE_POINTS = 1500;
const FASTER_MIN_SAVING = 180;
const FASTER_MIN_SHARE = 0.05;
const REJOIN_AFTER = 2000;

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

function costing({ avoidTolls, avoidHighways, motorcycle }) {
  const mode = motorcycle ? 'motorcycle' : 'auto';
  return { costing: mode, costing_options: { [mode]: { use_tolls: avoidTolls ? 0 : 0.5, use_highways: avoidHighways ? 0 : 1 } } };
}

function valhalla(from, to, { avoidTolls, avoidHighways, heading, via, motorcycle, signal }) {
  const origin = { lon: from[0], lat: from[1] };
  if (Number.isFinite(heading)) Object.assign(origin, { heading: Math.round(heading), heading_tolerance: 60 });
  const stop = via ? [{ lon: via[0], lat: via[1], type: 'break' }] : [];
  const body = {
    locations: [origin, ...stop, { lon: to[0], lat: to[1] }],
    ...costing({ avoidTolls, avoidHighways, motorcycle }),
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
  if (options.liveTraffic && !options.motorcycle) attempts.push(async () => fromTomTom(await tomtom(from, to, options)));
  attempts.push(async () => fromValhalla(await valhalla(from, to, options)));
  if (!options.motorcycle) attempts.push(async () => fromOsrm(await osrm(from, to, options)));
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

export async function detourTimes(here, places, route, { avoidTolls, avoidHighways, motorcycle, heading, signal } = {}) {
  const origin = { lon: here[0], lat: here[1] };
  if (Number.isFinite(heading)) Object.assign(origin, { heading: Math.round(heading), heading_tolerance: 60 });
  const stops = places.map((p) => ({ lon: p.lon, lat: p.lat }));
  const rejoin = places.map((p) => {
    const [lon, lat] = pointAt(route.coords, route.cum, Math.min(route.distance, p.along + REJOIN_AFTER));
    return { lon, lat };
  });
  const matrix = async (sources, targets) => {
    const json = await getJson(`${VALHALLA}/sources_to_targets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources, targets, ...costing({ avoidTolls, avoidHighways, motorcycle }) }),
      signal,
    });
    return json.sources_to_targets || [];
  };
  const [fromHere, back] = await Promise.all([matrix([origin], [...stops, ...rejoin]), matrix(stops, rejoin)]);
  const n = places.length;
  return places.map((_, i) => {
    const times = [fromHere[0]?.[i]?.time, back[i]?.[i]?.time, fromHere[0]?.[n + i]?.time];
    return times.every(Number.isFinite) ? Math.max(0, times[0] + times[1] - times[2]) : null;
  });
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
