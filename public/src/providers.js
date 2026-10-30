import { bearing, cumulative, decodePolyline, locate } from './geo.js';

const REF = /^(?:[A-Z]{1,3}\s?\d{1,4}[A-Z]?)$/;
const FEDERAL = /^\d{1,4}[A-Z]?$/;

function splitNames(list) {
  const names = [];
  const refs = [];
  for (const raw of list || []) {
    for (const part of String(raw ?? '').split(/;\s*/)) {
      let s = part.trim();
      if (!s) continue;
      if (FEDERAL.test(s)) s = `FT${s}`;
      const bucket = REF.test(s) ? refs : names;
      if (!bucket.includes(s)) bucket.push(s);
    }
  }
  return { names, refs };
}

const signTexts = (elements) => (elements || []).map((e) => String(e.text ?? '').trim()).filter(Boolean);

const VALHALLA = {
  1: ['depart'], 2: ['depart'], 3: ['depart'],
  4: ['arrive'], 5: ['arrive', 'right'], 6: ['arrive', 'left'],
  7: ['name', 'straight'], 8: ['continue', 'straight'],
  9: ['turn', 'slight-right'], 10: ['turn', 'right'], 11: ['turn', 'sharp-right'],
  12: ['uturn', 'right'], 13: ['uturn', 'left'],
  14: ['turn', 'sharp-left'], 15: ['turn', 'left'], 16: ['turn', 'slight-left'],
  17: ['ramp', 'straight'], 18: ['ramp', 'right'], 19: ['ramp', 'left'],
  20: ['exit', 'right'], 21: ['exit', 'left'],
  22: ['keep', 'straight'], 23: ['keep', 'right'], 24: ['keep', 'left'],
  25: ['merge'], 26: ['roundabout'], 27: ['roundabout-exit'],
  28: ['ferry'], 29: ['continue', 'straight'],
  37: ['merge', 'right'], 38: ['merge', 'left'],
};

function step(fields) {
  return {
    kind: 'continue',
    modifier: null,
    side: null,
    names: [],
    refs: [],
    toward: [],
    exitNumber: null,
    roundaboutExit: null,
    bearingAfter: null,
    index: 0,
    along: 0,
    length: 0,
    duration: 0,
    toll: false,
    highway: false,
    ...fields,
  };
}

function mergeRanges(ranges) {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function viaLabel(steps) {
  const totals = new Map();
  for (const s of steps) {
    const label = s.names[0] || s.refs[0];
    if (!label) continue;
    totals.set(label, (totals.get(label) || 0) + s.length);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
}

export function finalize(route) {
  const { coords, cum } = route;
  const total = cum[cum.length - 1];
  const steps = route.steps.slice().sort((a, b) => a.along - b.along);
  if (!steps.length || steps[steps.length - 1].kind !== 'arrive') {
    steps.push(step({ kind: 'arrive', index: coords.length - 1, along: total }));
  }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const nextAlong = i + 1 < steps.length ? steps[i + 1].along : total;
    s.length = Math.max(0, nextAlong - s.along);
    if (s.kind === 'depart' && !Number.isFinite(s.bearingAfter)) {
      let j = s.index + 1;
      while (j < coords.length - 1 && cum[j] - cum[s.index] < 25) j++;
      if (j < coords.length) s.bearingAfter = bearing(coords[s.index], coords[j]);
    }
  }
  const elapsed = new Float64Array(steps.length);
  for (let i = 1; i < steps.length; i++) elapsed[i] = elapsed[i - 1] + steps[i - 1].duration;
  const stepTime = elapsed[steps.length - 1] + steps[steps.length - 1].duration;
  const tollSections = mergeRanges(route.tollSections || []);
  return {
    provider: route.provider,
    coords,
    cum,
    steps,
    elapsed,
    distance: total,
    duration: route.duration || stepTime,
    timeScale: stepTime > 0 && route.duration ? route.duration / stepTime : 1,
    noTrafficDuration: route.noTrafficDuration ?? null,
    speedLimits: route.speedLimits || [],
    trafficDelay: route.trafficDelay ?? null,
    traffic: route.traffic || [],
    tollSections,
    tollDistance: tollSections.reduce((sum, [a, b]) => sum + (b - a), 0),
    hasToll: route.hasToll ?? tollSections.length > 0,
    hasHighway: route.hasHighway ?? steps.some((s) => s.highway),
    via: viaLabel(steps),
  };
}

function tollRangesFromSteps(steps) {
  return steps.filter((s) => s.toll).map((s) => [s.along, s.along + s.length]);
}

function valhallaTrip(trip) {
  const coords = [];
  const steps = [];
  const legs = trip.legs || [];
  legs.forEach((leg, li) => {
    const shape = decodePolyline(leg.shape, 6);
    const base = coords.length ? coords.length - 1 : 0;
    for (let i = coords.length ? 1 : 0; i < shape.length; i++) coords.push(shape[i]);
    for (const m of leg.maneuvers || []) {
      let [kind, modifier = null] = VALHALLA[m.type] || ['continue', 'straight'];
      if (kind === 'depart' && li > 0) continue;
      if (kind === 'arrive' && li < legs.length - 1) kind = 'waypoint';
      const end = kind === 'arrive' || kind === 'waypoint';
      const sign = m.sign || {};
      const { names, refs } = splitNames(m.street_names?.length ? m.street_names : m.begin_street_names);
      const branch = signTexts(sign.exit_branch_elements).filter((s) => REF.test(s));
      steps.push(step({
        kind,
        modifier: end ? null : modifier,
        side: end ? modifier : null,
        names,
        refs: refs.length ? refs : branch,
        toward: signTexts(sign.exit_toward_elements).filter((s) => !REF.test(s)).slice(0, 3),
        exitNumber: signTexts(sign.exit_number_elements)[0] || null,
        roundaboutExit: m.roundabout_exit_count || null,
        bearingAfter: Number.isFinite(m.bearing_after) ? m.bearing_after : null,
        index: base + m.begin_shape_index,
        duration: m.time || 0,
        length: (m.length || 0) * 1000,
        toll: !!m.toll,
        highway: !!m.highway,
      }));
    }
  });
  const cum = cumulative(coords);
  for (const s of steps) s.along = cum[Math.min(s.index, cum.length - 1)];
  steps.forEach((s, i) => {
    const exit = steps[i + 1];
    if (s.kind === 'roundabout' && !s.names.length && !s.refs.length && exit?.kind === 'roundabout-exit') {
      s.names = exit.names;
      s.refs = exit.refs;
    }
  });
  const summary = trip.summary || {};
  return finalize({
    provider: 'valhalla',
    coords,
    cum,
    steps,
    duration: summary.time,
    hasToll: summary.has_toll,
    hasHighway: summary.has_highway,
    tollSections: tollRangesFromSteps(steps),
  });
}

export function fromValhalla(json) {
  const trips = [json?.trip, ...(json?.alternates || []).map((a) => a.trip)].filter((t) => t?.legs?.length);
  return trips.map(valhallaTrip);
}

const OSRM_MOD = {
  uturn: 'uturn',
  'sharp right': 'sharp-right',
  right: 'right',
  'slight right': 'slight-right',
  straight: 'straight',
  'slight left': 'slight-left',
  left: 'left',
  'sharp left': 'sharp-left',
};

function osrmKind(type, mod) {
  switch (type) {
    case 'depart':
      return 'depart';
    case 'arrive':
      return 'arrive';
    case 'turn':
    case 'end of road':
    case 'roundabout turn':
      if (mod === 'uturn') return 'uturn';
      return mod === 'straight' ? 'continue' : 'turn';
    case 'continue':
      if (mod === 'uturn') return 'uturn';
      return mod === 'straight' ? 'continue' : 'keep';
    case 'new name':
      return 'name';
    case 'merge':
      return 'merge';
    case 'on ramp':
      return 'ramp';
    case 'off ramp':
      return 'exit';
    case 'fork':
      return 'keep';
    case 'roundabout':
    case 'rotary':
      return 'roundabout';
    case 'exit roundabout':
    case 'exit rotary':
      return 'roundabout-exit';
    default:
      return 'continue';
  }
}

function osrmRoute(r) {
  const coords = decodePolyline(r.geometry, 6);
  const cum = cumulative(coords);
  const steps = [];
  let cursor = 0;
  const legs = r.legs || [];
  for (const [li, leg] of legs.entries()) {
    for (const s of leg.steps || []) {
      const m = s.maneuver || {};
      const mod = OSRM_MOD[m.modifier] || 'straight';
      let kind = osrmKind(m.type, mod);
      if (kind === 'depart' && li > 0) continue;
      if (kind === 'arrive' && li < legs.length - 1) kind = 'waypoint';
      const end = kind === 'arrive' || kind === 'waypoint';
      const hit = locate(coords, cum, m.location, cursor, cursor + 5000);
      cursor = hit.index;
      const dest = String(s.destinations || '');
      const towardPart = dest.includes(':') ? dest.slice(dest.indexOf(':') + 1) : dest;
      steps.push(step({
        kind,
        modifier: end || kind === 'uturn' ? null : mod,
        side: end && mod !== 'straight' ? (mod.includes('left') ? 'left' : 'right') : null,
        ...splitNames([s.name, s.ref]),
        toward: towardPart.split(/,\s*/).map((x) => x.trim()).filter((x) => x && !REF.test(x)).slice(0, 3),
        exitNumber: s.exits ? String(s.exits).split(/;\s*/)[0] : null,
        roundaboutExit: kind === 'roundabout' ? m.exit || null : null,
        bearingAfter: Number.isFinite(m.bearing_after) ? m.bearing_after : null,
        index: hit.t > 0.5 ? Math.min(hit.index + 1, coords.length - 1) : hit.index,
        along: hit.along,
        duration: s.duration || 0,
        toll: (s.intersections || []).some((x) => x.classes?.includes('toll')),
        highway: (s.intersections || []).some((x) => x.classes?.includes('motorway')),
      }));
    }
  }
  return finalize({ provider: 'osrm', coords, cum, steps, duration: r.duration, tollSections: tollRangesFromSteps(steps) });
}

export function fromOsrm(json) {
  return (json?.routes || []).filter((r) => r.geometry).map(osrmRoute);
}

const TOMTOM = {
  DEPART: ['depart'], ARRIVE: ['arrive'], ARRIVE_LEFT: ['arrive', 'left'], ARRIVE_RIGHT: ['arrive', 'right'],
  STRAIGHT: ['continue', 'straight'], FOLLOW: ['continue', 'straight'],
  KEEP_RIGHT: ['keep', 'right'], KEEP_LEFT: ['keep', 'left'],
  BEAR_RIGHT: ['turn', 'slight-right'], BEAR_LEFT: ['turn', 'slight-left'],
  TURN_RIGHT: ['turn', 'right'], TURN_LEFT: ['turn', 'left'],
  SHARP_RIGHT: ['turn', 'sharp-right'], SHARP_LEFT: ['turn', 'sharp-left'],
  MAKE_UTURN: ['uturn'], TRY_MAKE_UTURN: ['uturn'],
  ENTER_MOTORWAY: ['merge'], ENTER_FREEWAY: ['merge'], ENTER_HIGHWAY: ['merge'],
  TAKE_EXIT: ['exit'], MOTORWAY_EXIT_LEFT: ['exit', 'left'], MOTORWAY_EXIT_RIGHT: ['exit', 'right'],
  TAKE_FERRY: ['ferry'],
  ROUNDABOUT_CROSS: ['roundabout'], ROUNDABOUT_RIGHT: ['roundabout'], ROUNDABOUT_LEFT: ['roundabout'], ROUNDABOUT_BACK: ['roundabout'],
  SWITCH_PARALLEL_ROAD: ['keep', 'straight'], SWITCH_MAIN_ROAD: ['keep', 'straight'],
  ENTRANCE_RAMP: ['ramp'],
  WAYPOINT_LEFT: ['waypoint', 'left'], WAYPOINT_RIGHT: ['waypoint', 'right'], WAYPOINT_REACHED: ['waypoint'],
};

function tomtomRoute(r) {
  const coords = [];
  for (const leg of r.legs || []) for (const p of leg.points || []) coords.push([p.longitude, p.latitude]);
  const cum = cumulative(coords);
  const last = coords.length - 1;
  const at = (i) => cum[Math.max(0, Math.min(last, i ?? 0))];
  const ins = r.guidance?.instructions || [];
  const steps = ins.map((x, i) => {
    const [kind, modifier = null] = TOMTOM[x.maneuver] || ['continue', 'straight'];
    const end = kind === 'arrive' || kind === 'waypoint';
    const next = ins[i + 1];
    return step({
      kind,
      modifier: end ? null : modifier,
      side: end ? modifier : null,
      ...splitNames([x.street, ...(x.roadNumbers || [])]),
      toward: x.signpostText ? x.signpostText.split(/\s*[,/]\s*/).filter((s) => s && !REF.test(s)).slice(0, 3) : [],
      exitNumber: x.exitNumber || null,
      roundaboutExit: x.roundaboutExitNumber || null,
      index: Math.max(0, Math.min(last, x.pointIndex ?? 0)),
      along: at(x.pointIndex),
      duration: next ? Math.max(0, (next.travelTimeInSeconds ?? 0) - (x.travelTimeInSeconds ?? 0)) : 0,
    });
  });
  const sections = r.sections || [];
  const tollSections = sections.filter((s) => s.sectionType === 'TOLL_ROAD').map((s) => [at(s.startPointIndex), at(s.endPointIndex)]);
  const motorway = sections.filter((s) => s.sectionType === 'MOTORWAY').map((s) => [at(s.startPointIndex), at(s.endPointIndex)]);
  for (const s of steps) {
    s.toll = tollSections.some(([a, b]) => s.along >= a && s.along < b);
    s.highway = motorway.some(([a, b]) => s.along >= a && s.along < b);
  }
  const summary = r.summary || {};
  return finalize({
    provider: 'tomtom',
    coords,
    cum,
    steps,
    duration: summary.travelTimeInSeconds,
    noTrafficDuration: summary.noTrafficTravelTimeInSeconds ?? null,
    trafficDelay: summary.trafficDelayInSeconds ?? null,
    hasToll: tollSections.length > 0,
    hasHighway: motorway.length > 0,
    tollSections,
    speedLimits: sections
      .filter((s) => s.sectionType === 'SPEED_LIMIT' && Number.isFinite(s.maxSpeedLimitInKmh))
      .map((s) => ({ from: at(s.startPointIndex), to: at(s.endPointIndex), kmh: s.maxSpeedLimitInKmh })),
    traffic: sections
      .filter((s) => s.sectionType === 'TRAFFIC')
      .map((s) => ({
        from: at(s.startPointIndex),
        to: at(s.endPointIndex),
        delay: s.delayInSeconds || 0,
        category: s.simpleCategory || 'JAM',
        magnitude: s.magnitudeOfDelay ?? 0,
      })),
  });
}

export function fromTomTom(json) {
  return (json?.routes || []).filter((r) => r.legs?.length).map(tomtomRoute);
}

export function sameRoute(a, b) {
  if (Math.abs(a.distance - b.distance) > Math.max(200, a.distance * 0.01)) return false;
  const probes = [0.25, 0.5, 0.75].map((f) => a.distance * f);
  return probes.every((d) => {
    const i = Math.min(a.coords.length - 1, a.cum.findIndex((c) => c >= d));
    const p = a.coords[i < 0 ? a.coords.length - 1 : i];
    return locate(b.coords, b.cum, p).dist < 60;
  });
}

export function distinctRoutes(routes) {
  const out = [];
  for (const r of routes) if (!out.some((o) => sameRoute(o, r))) out.push(r);
  return out;
}
