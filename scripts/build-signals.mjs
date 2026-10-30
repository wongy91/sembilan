import { readFile, writeFile } from 'node:fs/promises';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="MY"][admin_level=2]->.my;
node["highway"="traffic_signals"](area.my);
out skel;`;

async function fetchOverpass() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Sembilan traffic-light builder' },
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
  const points = [];
  for (const el of osm.elements || []) {
    if (el.type !== 'node') continue;
    const point = [round(el.lon), round(el.lat)];
    const key = point.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    generated: osm.osm3s?.timestamp_osm_base || null,
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
    signals: points.flat(),
  };
}

const args = process.argv.slice(2);
const from = args.indexOf('--from');
const osm = from >= 0 ? JSON.parse(await readFile(args[from + 1], 'utf8')) : await fetchOverpass();
const data = transform(osm);
await writeFile(new URL('../public/data/signals.json', import.meta.url), JSON.stringify(data));
console.log(`traffic lights ${data.signals.length / 2} (OSM ${data.generated})`);
