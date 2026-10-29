const ABBREVIATIONS = {
  sg: 'sungai',
  bkt: 'bukit',
  jln: 'jalan',
  bdr: 'bandar',
  kg: 'kampung',
  kpg: 'kampung',
  kampong: 'kampung',
  tg: 'tanjung',
  bt: 'batu',
};
const ALIASES = { 'jambatan pulau pinang': 'penang bridge', 'southville city': 'southville', pedas: 'pedas linggi' };
const PLUS_OPERATOR = /plus|lebuhraya usahasama|lebuhraya utara.?selatan|penang bridge|jambatan pulau pinang|linkedua/i;
const MAX_LOCAL_ROAD = 2000;
const MAX_UNTOLLED = 15000;

export function canonicalPlaza(name) {
  const words = String(name ?? '')
    .toLowerCase()
    .replace(/\(([a-z0-9])\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words[0] === 'plaza' && /^tol+$/.test(words[1] || '')) words.splice(0, 2);
  if (/^tol+$/.test(words[0] || '')) words.shift();
  if (words.at(-2) === 'toll' && words.at(-1) === 'plaza') words.splice(-2, 2);
  const expanded = words.map((w) => ABBREVIATIONS[w] || w).join(' ');
  return (ALIASES[expanded] || expanded)
    .split(' ')
    .map((w) => w.replace(/^(\w{3,}?)s$/, '$1'))
    .join(' ');
}

export function plusIndex(plazas) {
  return new Map(plazas.map((p) => [canonicalPlaza(p.name), p.code]));
}

export function plusCodeFor({ name, nameEn, operator }, index) {
  if (operator && !PLUS_OPERATOR.test(operator)) return null;
  for (const candidate of [name, nameEn]) {
    const code = candidate && index.get(canonicalPlaza(candidate));
    if (code) return code;
  }
  return null;
}

function leftNetwork(route, from, to) {
  let untolled = 0;
  let local = 0;
  for (const s of route.steps) {
    const overlap = Math.min(to, s.along + s.length) - Math.max(from, s.along);
    if (overlap <= 0 || s.toll) continue;
    untolled += overlap;
    if (!s.highway) local += overlap;
  }
  return local > MAX_LOCAL_ROAD || untolled > MAX_UNTOLLED;
}

export function fareGroups(route, pois) {
  const groups = [];
  let current = null;
  const close = () => {
    if (current) groups.push({ from: current[0], to: current.at(-1), plazas: current });
    current = null;
  };
  for (const p of pois) {
    if (p.kind !== 'toll') continue;
    if (!p.plus) {
      close();
      continue;
    }
    if (current && leftNetwork(route, current.at(-1).along, p.along)) close();
    if (current?.at(-1).plus === p.plus) continue;
    (current ??= []).push(p);
  }
  close();
  return groups;
}

export const pairKey = (group) => `${group.from.plus}/${group.to.plus}`;

const legKeys = (group) => group.plazas.slice(1).map((p, i) => `${group.plazas[i].plus}/${p.plus}`);

export function fareKeys(groups) {
  const whole = groups.map(pairKey);
  const legs = groups.filter((g) => g.plazas.length > 2).flatMap(legKeys);
  return [...new Set([...whole, ...legs])];
}

export function priceRoute(groups, fares, pois) {
  let total = 0;
  let missing = 0;
  const items = groups.map((group) => {
    const fare = fares.get(pairKey(group)) ?? null;
    if (fare == null) missing++;
    else total += fare;
    return { ...group, fare };
  });
  return {
    total: Math.round(total * 100) / 100,
    priced: items.length - missing,
    missing,
    other: pois.filter((p) => p.kind === 'toll' && !p.plus).length,
    items,
  };
}

export function attachFares(price, fares) {
  for (const item of price.items) {
    if (item.fare == null) continue;
    if (item.plazas.length <= 2) {
      item.to.fare = item.fare;
      continue;
    }
    const legs = legKeys(item).map((k) => fares.get(k));
    const sum = legs.reduce((total, fare) => total + (fare ?? NaN), 0);
    if (Math.abs(sum - item.fare) < 0.011) {
      item.plazas.slice(1).forEach((p, i) => {
        if (legs[i]) p.fare = legs[i];
      });
    }
  }
}

export async function fetchFares(keys, signal) {
  const res = await fetch('/api/fares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairs: keys.map((k) => k.split('/')) }),
    signal,
  });
  if (!res.ok) throw new Error(`fares ${res.status}`);
  const data = await res.json();
  return new Map(keys.map((k, i) => [k, data.fares?.[i] ?? null]));
}
