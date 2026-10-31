import { angleDiff, bbox, bearingAt, nearestOnGrid, segmentGrid, sideOf } from './geo.js';
import { spokenDistance } from './instructions.js';
import { tr } from './i18n.js';

const LIMITS = { tollNode: 20, tollNodeNonOsm: 25, tollWay: 25, camera: 35, rr: 350, report: 40, fuel: 100, signal: 20 };
const FUEL_REACH = 50000;
const SIGNAL_MERGE = 50;
const OSM_BASED = new Set(['valhalla', 'osrm']);
const DIRECTION_HINTS = [
  [/\b(?:northbound|NB)\b|\b(?:arah|hala) utara\b|\(utara\)/i, 0],
  [/\b(?:southbound|SB)\b|\b(?:arah|hala) selatan\b|\(selatan\)/i, 180],
  [/\b(?:eastbound|EB)\b|\b(?:arah|hala) timur\b|\(timur\)/i, 90],
  [/\b(?:westbound|WB)\b|\b(?:arah|hala) barat\b|\(barat\)/i, 270],
];
const grids = new WeakMap();
const nodeNames = new WeakMap();

function plazasWithNodes(data) {
  let names = nodeNames.get(data);
  if (!names) nodeNames.set(data, (names = new Set((data.toll || []).filter((t) => !t[4] && t[2]).map((t) => t[2]))));
  return names;
}

function wrongDirection(route, along, name) {
  if (!name) return false;
  const hint = DIRECTION_HINTS.find(([re]) => re.test(name));
  return !!hint && angleDiff(bearingAt(route.coords, route.cum, along, 50), hint[1]) > 90;
}

function gridFor(route) {
  let g = grids.get(route);
  if (!g) grids.set(route, (g = segmentGrid(route.coords)));
  return g;
}

function dedupe(list) {
  const out = [];
  for (const p of list) {
    const gap = p.kind === 'camera' ? 150 : 1500;
    const dup = out.findLastIndex(
      (q) =>
        q.kind === p.kind &&
        p.along - q.along < gap &&
        (p.kind !== 'toll' || p.along - q.along < 400 || !p.name || !q.name || p.name === q.name),
    );
    const entry = { ...p, id: `${p.kind}:${Math.round(p.along)}` };
    if (dup < 0) out.push(entry);
    else if (p.plus && !out[dup].plus) out[dup] = entry;
  }
  return out;
}

export function poisAlongRoute(route, data) {
  if (!data) return [];
  const index = gridFor(route);
  const [minX, minY, maxX, maxY] = bbox(route.coords);
  const pad = 0.005;
  const match = (p, limit) => {
    if (p[0] < minX - pad || p[0] > maxX + pad || p[1] < minY - pad || p[1] > maxY + pad) return null;
    const hit = nearestOnGrid(route.coords, route.cum, index, p);
    return hit && hit.dist <= limit ? hit : null;
  };
  const out = [];
  const withNodes = plazasWithNodes(data);
  const nodeLimit = OSM_BASED.has(route.provider) ? LIMITS.tollNode : LIMITS.tollNodeNonOsm;
  for (const [lon, lat, name, nameEn, isWay, plus] of data.toll || []) {
    if (isWay && name && withNodes.has(name)) continue;
    const hit = match([lon, lat], isWay ? LIMITS.tollWay : nodeLimit);
    if (hit) out.push({ kind: 'toll', along: hit.along, lon, lat, name: name || null, nameEn: nameEn || null, plus: plus || null });
  }
  for (const [lon, lat, maxspeed, name] of data.camera || []) {
    const hit = match([lon, lat], LIMITS.camera);
    if (hit && !wrongDirection(route, hit.along, name)) {
      out.push({ kind: 'camera', along: hit.along, lon, lat, maxspeed: maxspeed || null, name: name || null });
    }
  }
  for (const [lon, lat, name, bothSides] of data.rr || []) {
    if (!name) continue;
    const p = [lon, lat];
    const hit = match(p, LIMITS.rr);
    if (!hit || wrongDirection(route, hit.along, name)) continue;
    const a = route.coords[hit.index];
    const b = route.coords[hit.index + 1] || a;
    if (!bothSides && hit.dist > 40 && sideOf(a, b, p) < 0) continue;
    out.push({ kind: 'rr', along: hit.along, lon, lat, name });
  }
  return dedupe(out.sort((x, y) => x.along - y.along));
}

export function fuelAlongRoute(route, stations, from = 0, reach = FUEL_REACH) {
  const index = gridFor(route);
  const [minX, minY, maxX, maxY] = bbox(route.coords);
  const pad = 0.005;
  const out = [];
  for (const [lon, lat, name, street] of stations || []) {
    if (lon < minX - pad || lon > maxX + pad || lat < minY - pad || lat > maxY + pad) continue;
    const hit = nearestOnGrid(route.coords, route.cum, index, [lon, lat]);
    if (hit && hit.dist <= LIMITS.fuel && hit.along > from && hit.along - from <= reach) out.push({ name, sub: street, lon, lat, along: hit.along });
  }
  return out.sort((a, b) => a.along - b.along);
}

export function signalsAlongRoute(route, flat) {
  const index = gridFor(route);
  const [minX, minY, maxX, maxY] = bbox(route.coords);
  const pad = 0.001;
  const hits = [];
  for (let i = 0; i + 1 < (flat?.length || 0); i += 2) {
    const lon = flat[i];
    const lat = flat[i + 1];
    if (lon < minX - pad || lon > maxX + pad || lat < minY - pad || lat > maxY + pad) continue;
    const hit = nearestOnGrid(route.coords, route.cum, index, [lon, lat]);
    if (hit && hit.dist <= LIMITS.signal) hits.push({ lon, lat, along: hit.along, dist: hit.dist });
  }
  hits.sort((a, b) => a.along - b.along);
  const junctions = [];
  for (const h of hits) {
    const last = junctions.at(-1);
    if (last && h.along - last.end <= SIGNAL_MERGE) {
      last.end = h.along;
      if (h.dist < last.best.dist) last.best = h;
    } else junctions.push({ end: h.along, best: h });
  }
  return junctions.map(({ best: { lon, lat, along } }) => ({ lon, lat, along }));
}

export function trafficPois(route) {
  return (route.traffic || [])
    .filter((s) => s.category === 'ROAD_WORK' || s.delay >= 120)
    .map((s) => ({ kind: 'traffic', id: `traffic:${Math.round(s.from)}`, along: s.from, delay: s.delay, category: s.category }));
}

export function reportPois(route, reports) {
  const index = gridFor(route);
  const out = [];
  for (const r of reports || []) {
    const hit = nearestOnGrid(route.coords, route.cum, index, [r.lon, r.lat]);
    if (!hit || hit.dist > LIMITS.report) continue;
    if (Number.isFinite(r.heading) && angleDiff(bearingAt(route.coords, route.cum, hit.along), r.heading) > 70) continue;
    out.push({ kind: 'report', id: `report:${r.id}`, reportId: r.id, report: r.kind, along: hit.along, lon: r.lon, lat: r.lat });
  }
  return out;
}

export function summarize(pois) {
  const tolls = pois.filter((p) => p.kind === 'toll');
  return {
    tolls: tolls.length,
    tollNames: tolls.map((p) => p.name).filter(Boolean),
    cameras: pois.filter((p) => p.kind === 'camera').length,
    rr: pois.filter((p) => p.kind === 'rr').length,
  };
}

export const ALERT_LEAD = { camera: [450, 20], toll: [600, 25], report: [600, 25], traffic: [1500, 45] };

export function alertText(poi, meters, lang = 'ms') {
  const dist = spokenDistance(meters, lang);
  switch (poi.kind) {
    case 'camera':
      return poi.maxspeed ? tr(lang, 'alertCameraLimit', { dist, n: poi.maxspeed }) : tr(lang, 'alertCamera', { dist });
    case 'toll': {
      const name = (lang === 'en' ? poi.nameEn || poi.name : poi.name) || tr(lang, 'tollPlaza');
      const text = tr(lang, 'alertToll', { name, dist });
      if (poi.fare == null) return text;
      const ringgit = Math.floor(poi.fare);
      const sen = Math.round((poi.fare - ringgit) * 100);
      return `${text}, ${tr(lang, sen ? 'alertFare' : 'alertFareWhole', { ringgit, sen })}`;
    }
    case 'report':
      return tr(lang, 'alertReport', { label: tr(lang, poi.report), dist });
    case 'traffic':
      return poi.category === 'ROAD_WORK'
        ? tr(lang, 'alertRoadWork', { dist })
        : tr(lang, 'alertJam', { dist, min: Math.max(1, Math.round(poi.delay / 60)) });
    default:
      return '';
  }
}
