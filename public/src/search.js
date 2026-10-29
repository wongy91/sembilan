import { haversine } from './geo.js';
import { tokenize } from './text.js';

const PHOTON = 'https://photon.komoot.io';
const ADDRESS_LIKE = /\d|\b(jalan|jln|lorong|lrg|taman|tmn|persiaran|lebuh|lot|no|blok|block|kampung|kg|bandar|seksyen|section)\b/i;
const OSM_NEARBY = {
  fuel: ['petrol', 'amenity:fuel'],
  food: ['restaurant', 'amenity:restaurant'],
  parking: ['parking', 'amenity:parking'],
  ev: ['charging station', 'amenity:charging_station'],
};
const NEARBY_LIMIT_M = 30000;
const BBOX = '99.5,0.8,119.5,7.5';
const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function toPlace(feature) {
  const p = feature.properties || {};
  const [lon, lat] = feature.geometry.coordinates;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || street || p.district || p.city || p.state || '';
  const parts = [p.name ? street : '', p.district, p.city, p.state].filter(Boolean);
  const sub = parts.filter((x, i) => x !== name && parts.indexOf(x) === i).join(', ');
  return { name, sub, lon, lat };
}

export const isAddressLike = (query) => ADDRESS_LIKE.test(query);

const withDistance = (places, near) => places.map((p) => ({ ...p, dist: near ? haversine(near, [p.lon, p.lat]) : null }));

export function mergePlaces(first, second, limit = 8) {
  const out = [];
  for (const p of [...first, ...second]) {
    const dup = out.some((q) => haversine([p.lon, p.lat], [q.lon, q.lat]) < 80 && (q.name.toLowerCase() === p.name.toLowerCase() || haversine([p.lon, p.lat], [q.lon, q.lat]) < 15));
    if (!dup) out.push(p);
  }
  return out.slice(0, limit);
}

const prettyCategory = (c) => (c ? c.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase()) : '');

async function overtureSearch(query, near, signal) {
  const res = await fetch(`/api/places?${nearParams(near, { q: query })}`, { signal });
  if (!res.ok) throw new Error(`places ${res.status}`);
  return ((await res.json()).results || []).map(({ category, ...p }) => ({ ...p, sub: [p.sub, prettyCategory(category)].filter(Boolean).join(' · ') }));
}

async function tomtomSearch(params, signal) {
  const res = await fetch(`/api/search?${params}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return (await res.json()).results || [];
}

const nearParams = (near, extra) => new URLSearchParams({ ...extra, lat: near[1].toFixed(5), lon: near[0].toFixed(5) });

export async function searchPlaces(query, { near, lang, signal, tomtom = false, places = false } = {}) {
  const coord = COORD.exec(query);
  if (coord) {
    const lat = Number(coord[1]);
    const lon = Number(coord[2]);
    return [{ name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, sub: '', lon, lat }];
  }
  const remote = () => tomtomSearch(nearParams(near, { q: query }), signal).catch(() => []);
  const addressy = isAddressLike(query);
  const early = tomtom && addressy ? remote() : null;
  const overture = places ? overtureSearch(query, near, signal).catch(() => []) : Promise.resolve([]);
  let osm = [];
  let failure = null;
  try {
    osm = await photonSearch(query, { near, lang, signal });
  } catch (err) {
    if (!tomtom || signal?.aborted) throw err;
    failure = err;
  }
  const pois = await overture;
  const words = tokenize(query);
  const full = (p) => {
    const tokens = tokenize(`${p.name} ${p.sub}`);
    return words.every((q) => tokens.some((t) => t.startsWith(q)));
  };
  let list = mergePlaces([...osm.filter(full), ...pois.filter(full), ...osm.filter((p) => !full(p)), ...pois.filter((p) => !full(p))], []);
  if (early) list = mergePlaces(await early, list);
  else if (tomtom && list.length < 3) list = mergePlaces(list, await remote());
  if (!list.length && failure) throw failure;
  return withDistance(list, near);
}

export async function nearbyPlaces(cat, { near, signal, tomtom = false, label = '' } = {}) {
  if (tomtom) {
    try {
      return withDistance(await tomtomSearch(nearParams(near, { cat }), signal), near).sort((a, b) => a.dist - b.dist);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  const [q, tag] = OSM_NEARBY[cat];
  const params = new URLSearchParams({ q, osm_tag: tag, lat: near[1].toFixed(4), lon: near[0].toFixed(4), zoom: '14', location_bias_scale: '0.2', limit: '15', bbox: BBOX });
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`nearby ${res.status}`);
  const places = ((await res.json()).features || []).map((f) => ({ ...toPlace(f), name: f.properties?.name || label }));
  return withDistance(places, near)
    .filter((p) => p.dist <= NEARBY_LIMIT_M)
    .sort((a, b) => a.dist - b.dist);
}

async function photonSearch(query, { near, lang, signal }) {
  const params = new URLSearchParams({ q: query, limit: '8', bbox: BBOX });
  if (near) {
    params.set('lat', near[1].toFixed(4));
    params.set('lon', near[0].toFixed(4));
    params.set('zoom', '10');
    params.set('location_bias_scale', '0.6');
  }
  if (lang === 'en') params.set('lang', 'en');
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  return (data.features || []).map(toPlace).filter((p) => {
    const key = `${p.name}|${p.sub}`;
    if (!p.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function reversePlace([lon, lat], { lang, signal } = {}) {
  const params = new URLSearchParams({ lon: String(lon), lat: String(lat), limit: '1' });
  if (lang === 'en') params.set('lang', 'en');
  const res = await fetch(`${PHOTON}/reverse?${params}`, { signal });
  if (!res.ok) throw new Error(`reverse ${res.status}`);
  const feature = (await res.json()).features?.[0];
  return feature ? { ...toPlace(feature), lon, lat } : null;
}
