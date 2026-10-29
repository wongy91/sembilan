import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = 'https://www.plus.com.my/';

async function page() {
  const args = process.argv.slice(2);
  const from = args.indexOf('--from');
  if (from >= 0) return readFile(args[from + 1], 'utf8');
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'Sembilan plaza list builder' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
  return res.text();
}

function extract(html) {
  const start = html.indexOf('selectedState === "');
  const end = html.indexOf('fromDropdown.addEventListener', start);
  if (start < 0 || end < 0) throw new Error('PLUS fare calculator script not found; the page layout changed');
  const script = html.slice(start, end);
  const token = /selectedState\s*===\s*"([A-Z]+)"|value:\s*'([A-Z]{3})',\s*text:\s*'([^']+)'/g;
  const plazas = new Map();
  let state = null;
  for (const m of script.matchAll(token)) {
    if (m[1]) state = m[1];
    else if (state && !plazas.has(m[2])) plazas.set(m[2], { code: m[2], name: m[3].trim(), state });
  }
  if (plazas.size < 50) throw new Error(`only ${plazas.size} plazas found; the page layout changed`);
  return [...plazas.values()].sort((a, b) => a.code.localeCompare(b.code));
}

const plazas = extract(await page());
const data = { source: SOURCE, fetched: new Date().toISOString().slice(0, 10), plazas };
await writeFile(new URL('../public/data/plus-plazas.json', import.meta.url), `${JSON.stringify(data, null, 1)}\n`);
console.log(`${plazas.length} PLUS plazas`);
