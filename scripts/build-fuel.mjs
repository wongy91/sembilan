import { readFile, writeFile } from 'node:fs/promises';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="MY"][admin_level=2]->.my;
nwr["amenity"="fuel"](area.my);
out center tags;`;

async function fetchOverpass() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Sembilan petrol-station builder' },
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

function transform(osm) {
  const seen = new Set();
  const stations = [];
  for (const el of osm.elements || []) {
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const tags = el.tags || {};
    const entry = [round(lon), round(lat), (tags.name || tags.brand || '').trim(), (tags['addr:street'] || '').trim()];
    const key = `${entry[0]},${entry[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stations.push(entry);
  }
  stations.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { generated: osm.osm3s?.timestamp_osm_base || null, attribution: '© OpenStreetMap contributors, ODbL 1.0', fuel: stations };
}

const args = process.argv.slice(2);
const from = args.indexOf('--from');
const osm = from >= 0 ? JSON.parse(await readFile(args[from + 1], 'utf8')) : await fetchOverpass();
const data = transform(osm);
await writeFile(new URL('../public/data/fuel.json', import.meta.url), JSON.stringify(data));
console.log(`petrol stations ${data.fuel.length} (OSM ${data.generated})`);
