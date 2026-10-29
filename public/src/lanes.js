import { angleDiff, bearing, haversine, locate, pointAt } from './geo.js';

const nearest = (bearings, b) => bearings.reduce((best, x, i) => (angleDiff(x, b) < angleDiff(bearings[best], b) ? i : best), 0);

export function laneCatalog(json) {
  const out = [];
  for (const r of json?.matchings || []) {
    for (const leg of r.legs || []) {
      for (const s of leg.steps || []) {
        for (const x of s.intersections || []) {
          if (!x.lanes?.length || x.in == null || x.out == null || !x.bearings?.length) continue;
          out.push({
            at: x.location,
            bearings: x.bearings,
            in: x.in,
            out: x.out,
            lanes: x.lanes.map((l) => ({
              dirs: l.indications?.length ? l.indications : ['none'],
              on: !!(l.active ?? l.valid),
              use: l.valid_indication || null,
            })),
          });
        }
      }
    }
  }
  return out;
}

export function attachLanes(route, catalog, from = 0, to = Infinity) {
  const { coords, cum, distance } = route;
  for (const step of route.steps) {
    if (step.kind === 'depart' || step.kind === 'arrive' || step.along < from || step.along >= to) continue;
    const p = coords[step.index];
    let best = null;
    let bestDist = 15;
    for (const c of catalog) {
      const near = haversine(p, c.at);
      if (near >= bestDist) continue;
      const hit = locate(coords, cum, c.at, step.index - 25, step.index + 25);
      if (hit.dist > 10) continue;
      const inHeading = bearing(pointAt(coords, cum, hit.along - 20), hit.point);
      const outHeading = bearing(hit.point, pointAt(coords, cum, Math.min(distance, hit.along + 20)));
      if (nearest(c.bearings, (inHeading + 180) % 360) !== c.in || nearest(c.bearings, outHeading) !== c.out) continue;
      best = c;
      bestDist = near;
    }
    const useful = best && best.lanes.length > 1 && best.lanes.some((l) => l.on) && best.lanes.some((l) => !l.on);
    step.lanes = useful ? best.lanes : null;
  }
  return route;
}
