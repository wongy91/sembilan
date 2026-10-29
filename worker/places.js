import { tokenize } from '../public/src/text.js';

export const CHUNK_SIZE = 1500;
export const STOP_FREQUENCY = 8000;

function dictionary(values) {
  const list = [...new Set(values)].sort();
  const index = new Map(list.map((v, i) => [v, i]));
  return { list, index };
}

export function buildIndex(places, chunkSize = CHUNK_SIZE, stopFrequency = STOP_FREQUENCY) {
  const frequency = new Map();
  const tokensOf = places.map((p) => {
    const tokens = [...new Set(tokenize(p.name))];
    for (const t of tokens) frequency.set(t, (frequency.get(t) || 0) + 1);
    return tokens;
  });
  const stop = [...frequency].filter(([, n]) => n > stopFrequency).map(([t]) => t).sort();
  const stopSet = new Set(stop);
  const localities = dictionary(places.map((p) => p.locality || ''));
  const categories = dictionary(places.map((p) => p.category || ''));
  const rows = [];
  places.forEach((p, i) => {
    const loc = localities.index.get(p.locality || '');
    const cat = categories.index.get(p.category || '');
    for (const t of tokensOf[i]) if (!stopSet.has(t)) rows.push([t, p.name, loc, cat, p.lon, p.lat]);
  });
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) chunks.push(rows.slice(i, i + chunkSize));
  return {
    manifest: { count: places.length, stop, localities: localities.list, categories: categories.list, firsts: chunks.map((c) => c[0][0]) },
    chunks,
  };
}

function chunkSpan(manifest, token) {
  const { firsts } = manifest;
  let n = 1;
  let i = chunksFor(manifest, token, 1)[0] + 1;
  while (i < firsts.length && firsts[i].startsWith(token)) {
    n++;
    i++;
  }
  return n;
}

export function chunksFor(manifest, token, limit = 3) {
  const { firsts } = manifest;
  let lo = 0;
  let hi = firsts.length - 1;
  let start = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (firsts[mid] < token) {
      start = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const out = [start];
  for (let i = start + 1; i < firsts.length && firsts[i].startsWith(token) && out.length < limit; i++) out.push(i);
  return out;
}

function distance([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export async function searchIndex(manifest, loadChunk, query, near, limit = 8) {
  const tokens = [...new Set(tokenize(query))];
  const phrase = tokens.join(' ');
  const stop = new Set(manifest.stop);
  const keys = tokens
    .filter((t) => !stop.has(t))
    .map((t) => ({ t, span: chunkSpan(manifest, t) }))
    .sort((a, b) => a.span - b.span || b.t.length - a.t.length)
    .slice(0, 3)
    .map((k) => k.t);
  const seen = new Set();
  const hits = [];
  for (const key of keys) {
    for (const i of chunksFor(manifest, key)) {
      for (const [token, name, loc, cat, lon, lat] of await loadChunk(i)) {
        if (!token.startsWith(key)) continue;
        const id = `${name}|${lon}|${lat}`;
        if (seen.has(id)) continue;
        const locality = manifest.localities[loc] || '';
        if (tokens.length === 1) {
          seen.add(id);
          const order = name.toLowerCase().replace(/['’`]/g, '').startsWith(key) ? 2 : 1;
          hits.push({ name, sub: locality, category: manifest.categories[cat] || '', lon, lat, inName: 1, order, exact: token === key ? 1 : 0, dist: distance(near, [lon, lat]) });
          continue;
        }
        const hay = `${name} ${locality}`.toLowerCase().replace(/['’`]/g, '');
        if (/^[\x00-\x7f]*$/.test(hay) && !tokens.every((q) => hay.includes(q))) continue;
        const nameTokens = tokenize(name);
        const allTokens = [...nameTokens, ...tokenize(locality)];
        if (!tokens.every((q) => allTokens.some((t) => t.startsWith(q)))) continue;
        seen.add(id);
        const inName = tokens.filter((q) => nameTokens.some((t) => t.startsWith(q))).length;
        const exact = tokens.filter((q) => nameTokens.includes(q)).length;
        const joined = nameTokens.join(' ');
        const order = joined.startsWith(phrase) ? 2 : joined.includes(phrase) ? 1 : 0;
        hits.push({ name, sub: locality, category: manifest.categories[cat] || '', lon, lat, inName, order, exact, dist: distance(near, [lon, lat]) });
      }
    }
    if (hits.length) break;
  }
  hits.sort((a, b) => b.inName - a.inName || b.order - a.order || b.exact - a.exact || a.dist - b.dist);
  return hits.slice(0, limit).map(({ name, sub, category, lon, lat }) => ({ name, sub, category, lon, lat }));
}
