import { readFile, writeFile } from 'node:fs/promises';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="MY"][admin_level=2]->.my;
node["place"~"^(neighbourhood|quarter|suburb|town|city)$"]["name"](area.my);
out;`;
const LOCAL = new Set(['neighbourhood', 'quarter', 'suburb']);

async function fetchOverpass() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Sembilan area builder' },
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

const round = (n) => Math.round(n * 1e4) / 1e4;

function transform(osm) {
  const seen = new Set();
  const areas = [];
  for (const el of osm.elements || []) {
    const name = (el.tags?.['name:en'] || el.tags?.name || '').trim();
    if (el.type !== 'node' || !name) continue;
    const entry = [round(el.lon), round(el.lat), name, LOCAL.has(el.tags.place) ? 0 : 1];
    const key = entry.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(entry);
  }
  areas.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { generated: osm.osm3s?.timestamp_osm_base || null, attribution: '© OpenStreetMap contributors, ODbL 1.0', areas };
}

const args = process.argv.slice(2);
const from = args.indexOf('--from');
const osm = from >= 0 ? JSON.parse(await readFile(args[from + 1], 'utf8')) : await fetchOverpass();
const data = transform(osm);
await writeFile(new URL('../public/data/areas.json', import.meta.url), JSON.stringify(data));
const local = data.areas.filter((a) => a[3] === 0).length;
console.log(`areas ${data.areas.length} (${local} neighbourhoods/suburbs, ${data.areas.length - local} towns/cities; OSM ${data.generated})`);
