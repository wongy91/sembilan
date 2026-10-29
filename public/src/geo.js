const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const f1 = a[1] * RAD;
  const f2 = b[1] * RAD;
  const dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let lat = 0;
  let lon = 0;
  let i = 0;
  while (i < str.length) {
    const deltas = [0, 0];
    for (let axis = 0; axis < 2; axis++) {
      let shift = 0;
      let result = 0;
      let byte;
      do {
        byte = str.charCodeAt(i++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && i < str.length);
      deltas[axis] = result & 1 ? ~(result >> 1) : result >> 1;
    }
    lat += deltas[0];
    lon += deltas[1];
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

export function cumulative(coords) {
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  return cum;
}

export function locate(coords, cum, p, from = 0, to = coords.length - 1) {
  const lo = Math.max(0, Math.min(from, coords.length - 1));
  const hi = Math.max(lo, Math.min(to, coords.length - 1));
  if (hi === lo) return { index: lo, t: 0, dist: haversine(p, coords[lo]), point: coords[lo], along: cum[lo] };
  const kx = Math.cos(p[1] * RAD) * R * RAD;
  const ky = R * RAD;
  let ax = (coords[lo][0] - p[0]) * kx;
  let ay = (coords[lo][1] - p[1]) * ky;
  let best = -1;
  let bestT = 0;
  let bestD2 = Infinity;
  for (let i = lo; i < hi; i++) {
    const b = coords[i + 1];
    const bx = (b[0] - p[0]) * kx;
    const by = (b[1] - p[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const x = ax + t * dx;
    const y = ay + t * dy;
    const d2 = x * x + y * y;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
      bestT = t;
    }
    ax = bx;
    ay = by;
  }
  const a = coords[best];
  const b = coords[best + 1];
  return {
    index: best,
    t: bestT,
    dist: Math.sqrt(bestD2),
    point: [a[0] + bestT * (b[0] - a[0]), a[1] + bestT * (b[1] - a[1])],
    along: cum[best] + bestT * (cum[best + 1] - cum[best]),
  };
}

export function indexAt(cum, along) {
  let lo = 0;
  let hi = cum.length - 1;
  if (along <= 0) return 0;
  if (along >= cum[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function pointAt(coords, cum, along) {
  const n = coords.length - 1;
  if (along <= 0) return coords[0];
  if (along >= cum[n]) return coords[n];
  const i = indexAt(cum, along);
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (along - cum[i]) / seg : 0;
  const a = coords[i];
  const b = coords[i + 1];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export function bearingAt(coords, cum, along, span = 15) {
  const total = cum[cum.length - 1];
  const a = pointAt(coords, cum, Math.max(0, along - span));
  const b = pointAt(coords, cum, Math.min(total, along + span));
  return bearing(a, b);
}

export function slice(coords, cum, fromAlong, toAlong = Infinity) {
  const total = cum[cum.length - 1];
  const start = Math.max(0, Math.min(fromAlong, total));
  const end = Math.max(start, Math.min(toAlong, total));
  const out = [pointAt(coords, cum, start)];
  for (let i = indexAt(cum, start) + 1; i < coords.length && cum[i] < end; i++) out.push(coords[i]);
  out.push(pointAt(coords, cum, end));
  return out;
}

export function bbox(coords) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function sideOf(a, b, p) {
  const kx = Math.cos(p[1] * RAD);
  return (b[0] - a[0]) * kx * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) * kx;
}

export function segmentGrid(coords, cell = 0.01) {
  const grid = new Map();
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(i);
      }
    }
  }
  return { grid, cell };
}

export function nearestOnGrid(coords, cum, index, p) {
  const cx = Math.floor(p[0] / index.cell);
  const cy = Math.floor(p[1] / index.cell);
  let best = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = index.grid.get(`${cx + dx}:${cy + dy}`);
      if (!list) continue;
      for (const i of list) {
        const r = locate(coords, cum, p, i, i + 1);
        if (!best || r.dist < best.dist) best = r;
      }
    }
  }
  return best;
}
