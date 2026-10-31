import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="MY"][admin_level=2]->.my;
nwr["amenity"="charging_station"](area.my);
out center tags;`;
const BRANDS = [
  [/tesla|supercharger/i, 'Tesla'],
  [/gentari/i, 'Gentari'],
  [/charge\s?sini/i, 'ChargeSini'],
  [/jomcharge/i, 'JomCharge'],
  [/chargee?v/i, 'ChargEV'],
  [/dc\s?handal/i, 'DC Handal'],
  [/shell/i, 'Shell Recharge'],
  [/tnb\s?electron/i, 'TNB Electron'],
  [/charge\s?\+/i, 'CHARGE+'],
];

async function fetchOverpass() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Sembilan EV charger builder' },
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

const round = (n) => Math.round(n * 1e5) / 1e5;

export function brandOf(tags = {}) {
  for (const key of ['network', 'brand', 'name', 'operator']) {
    const hits = BRANDS.map(([re, brand]) => [(tags[key] || '').search(re), brand]).filter(([at]) => at >= 0);
    if (hits.length) return hits.sort((x, y) => x[0] - y[0])[0][1];
  }
  return '';
}

export function transform(osm) {
  const seen = new Set();
  const chargers = [];
  for (const el of osm.elements || []) {
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const tags = el.tags || {};
    const entry = [round(lon), round(lat), brandOf(tags), (tags.name || tags.brand || tags.operator || '').trim()];
    const key = `${entry[0]},${entry[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chargers.push(entry);
  }
  chargers.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { generated: osm.osm3s?.timestamp_osm_base || null, attribution: '© OpenStreetMap contributors, ODbL 1.0', ev: chargers };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const from = args.indexOf('--from');
  const osm = from >= 0 ? JSON.parse(await readFile(args[from + 1], 'utf8')) : await fetchOverpass();
  const data = transform(osm);
  await writeFile(new URL('../public/data/ev.json', import.meta.url), JSON.stringify(data));
  console.log(`EV chargers ${data.ev.length}, ${data.ev.filter((c) => c[2]).length} with a brand (OSM ${data.generated})`);
}
