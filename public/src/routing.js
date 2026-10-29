import { attachLanes, laneCatalog } from './lanes.js';
import { distinctRoutes, fromOsrm, fromTomTom, fromValhalla } from './providers.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

function valhalla(from, to, { avoidTolls, avoidHighways, heading, signal }, format) {
  const origin = { lon: from[0], lat: from[1] };
  if (Number.isFinite(heading)) Object.assign(origin, { heading: Math.round(heading), heading_tolerance: 60 });
  const body = {
    locations: [origin, { lon: to[0], lat: to[1] }],
    costing: 'auto',
    costing_options: { auto: { use_tolls: avoidTolls ? 0 : 0.5, use_highways: avoidHighways ? 0 : 1 } },
    alternates: 2,
    units: 'kilometers',
  };
  if (format) body.format = format;
  return getJson(VALHALLA, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
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
      const routes = distinctRoutes(await attempt()).slice(0, 3);
      if (!routes.length) continue;
      valhalla(from, to, options, 'osrm')
        .then((json) => {
          const catalog = laneCatalog(json);
          for (const r of routes) attachLanes(r, catalog);
        })
        .catch(() => {});
      return routes;
    } catch (err) {
      if (options.signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError || new Error('no route');
}
