import { readFile, writeFile } from 'node:fs/promises';
import { haversine } from '../public/src/geo.js';
import { plusCodeFor, plusIndex } from '../public/src/fares.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="MY"][admin_level=2]->.my;
(nwr["barrier"="toll_booth"](area.my);
 node["highway"="speed_camera"](area.my);
 nwr["highway"~"^(services|rest_area)$"](area.my););
out center tags;`;
const RR_NAME = /(r\s*&\s*r|rehat|rest|hentian|service area|perhentian|jejantas|overhead|lay-?by)/i;
const BOTH_SIDES = /(jejantas|overhead)/i;

async function fetchOverpass() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Sembilan POI builder' },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(240_000),
      });
      if (res.ok) return await res.json();
      console.error(`${url}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`${url}: ${err.message}`);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

const round = (n) => Math.round(n * 1e6) / 1e6;
const position = (el) => (el.type === 'node' ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null);
const speedLimit = (s) => {
  const m = /^(\d{2,3})/.exec(String(s ?? ''));
  return m ? Number(m[1]) : null;
};

function resolveAmbiguous(matches, plazas) {
  const names = new Map(plazas.map((p) => [p.code, p.name]));
  for (const [code, list] of matches) {
    const spread = (items) => Math.max(...items.map((m) => haversine([m.entry[0], m.entry[1]], [items[0].entry[0], items[0].entry[1]])));
    if (spread(list) <= 30000) continue;
    const tagged = list.filter((m) => m.operator);
    const keep = tagged.length && spread(tagged) <= 30000 ? new Set(tagged) : new Set();
    for (const m of list) if (!keep.has(m)) m.entry[5] = null;
    console.warn(`${code} (${names.get(code)}): OSM matches are >30 km apart; kept ${keep.size} of ${list.length}`);
  }
  const found = new Set([...matches.values()].flat().filter((m) => m.entry[5]).map((m) => m.entry[5]));
  const missing = plazas.filter((p) => !found.has(p.code)).map((p) => `${p.code} ${p.name}`);
  console.log(`PLUS plazas matched to OSM: ${found.size}/${plazas.length}`);
  if (missing.length) console.log(`not found in OSM: ${missing.join(', ')}`);
}

function transform(osm, plus) {
  const index = plusIndex(plus.plazas);
  const matches = new Map();
  const toll = [];
  const camera = [];
  const rr = [];
  const seen = new Set();
  for (const el of osm.elements || []) {
    const pos = position(el);
    if (!pos) continue;
    const tags = el.tags || {};
    const [lon, lat] = pos.map(round);
    const key = `${lon},${lat},${tags.barrier || tags.highway}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = tags.name || tags['name:ms'] || null;
    if (tags.barrier === 'toll_booth') {
      const code = plusCodeFor({ name, nameEn: tags['name:en'], operator: tags.operator }, index);
      const entry = [lon, lat, name, tags['name:en'] || null, el.type === 'node' ? 0 : 1, code];
      if (code) matches.set(code, [...(matches.get(code) || []), { entry, operator: !!tags.operator }]);
      toll.push(entry);
    } else if (tags.highway === 'speed_camera') {
      camera.push([lon, lat, speedLimit(tags.maxspeed), name]);
    } else if (tags.highway === 'rest_area' || (tags.highway === 'services' && name && RR_NAME.test(name))) {
      rr.push([lon, lat, name, name && BOTH_SIDES.test(name) ? 1 : 0]);
    }
  }
  resolveAmbiguous(matches, plus.plazas);
  const byPosition = (a, b) => a[0] - b[0] || a[1] - b[1];
  return {
    generated: osm.osm3s?.timestamp_osm_base || null,
    attribution: '© OpenStreetMap contributors, ODbL 1.0; PLUS plaza codes from www.plus.com.my',
    toll: toll.sort(byPosition),
    camera: camera.sort(byPosition),
    rr: rr.sort(byPosition),
  };
}

const args = process.argv.slice(2);
const from = args.indexOf('--from');
const osm = from >= 0 ? JSON.parse(await readFile(args[from + 1], 'utf8')) : await fetchOverpass();
const plus = JSON.parse(await readFile(new URL('../public/data/plus-plazas.json', import.meta.url), 'utf8'));
const data = transform(osm, plus);
await writeFile(new URL('../public/data/pois.json', import.meta.url), JSON.stringify(data));
console.log(`toll ${data.toll.length}, camera ${data.camera.length}, rr ${data.rr.length} (OSM ${data.generated})`);
