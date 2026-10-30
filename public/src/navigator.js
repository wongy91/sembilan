import { angleDiff, bearing, bearingAt, haversine, indexAt, locate } from './geo.js';
import { SILENT, chain, continueFor, instruction, withDistance } from './instructions.js';
import { ALERT_LEAD, alertText } from './pois.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const SPEEDING_MARGIN = 5;
const SPEEDING_QUIET = 60000;
const TURNED_AWAY = 35;

function timeAfter(route, index, along) {
  const steps = route.steps;
  const cur = steps[index];
  const curEnd = index + 1 < steps.length ? steps[index + 1].along : route.distance;
  const frac = clamp((along - cur.along) / Math.max(1, curEnd - cur.along), 0, 1);
  const last = steps.length - 1;
  const total = route.elapsed[last] + steps[last].duration;
  return Math.max(0, (total - route.elapsed[index] - cur.duration * frac) * route.timeScale);
}

export function timeLeft(route, along) {
  let index = 0;
  while (index + 1 < route.steps.length && route.steps[index + 1].along <= along) index++;
  return timeAfter(route, index, along);
}

export class Navigator {
  constructor(route, { lang = 'ms', pois = [], resumed = false, announce = false } = {}) {
    this.route = route;
    this.lang = lang;
    this.pois = [];
    this.setPois(pois);
    this.along = 0;
    this.segIndex = 0;
    this.stepIndex = 0;
    this.said = new Set();
    this.alerted = new Set();
    this.offCount = 0;
    this.offSince = null;
    this.rerouteRequested = false;
    this.lastOnTime = null;
    this.arrived = false;
    this.started = resumed;
    this.announce = announce;
    this.speeding = false;
    this.speedingAt = -Infinity;
  }

  setPois(pois) {
    this.pois = pois.slice().sort((a, b) => a.along - b.along);
  }

  resetOffRoute() {
    this.offCount = 0;
    this.offSince = null;
    this.rerouteRequested = false;
  }

  nextVoiced(from) {
    const steps = this.route.steps;
    for (let i = from; i < steps.length; i++) if (!SILENT.has(steps[i].kind)) return i;
    return steps.length - 1;
  }

  say(step, opts) {
    return instruction(step, this.lang, { spoken: true, ...opts });
  }

  update(fix) {
    const out = { speech: [], alerts: [], offRoute: false, arrived: false, speeding: false, progress: null };
    if (this.arrived) {
      out.arrived = true;
      out.progress = this.progress();
      return out;
    }
    const r = this.route;
    const steps = r.steps;
    const p = [fix.lon, fix.lat];
    const speed = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
    const v = Math.max(speed ?? 0, 8);
    const tol = clamp((Number.isFinite(fix.accuracy) ? fix.accuracy : 15) + 25, 40, 90);

    const windowEnd = indexAt(r.cum, this.along + Math.max(1500, v * 60)) + 1;
    let loc = locate(r.coords, r.cum, p, Math.max(0, this.segIndex - 3), windowEnd);
    if (loc.dist > tol) {
      const global = locate(r.coords, r.cum, p);
      const reach = this.lastOnTime == null ? Infinity : ((fix.time - this.lastOnTime) / 1000) * 45 + 300;
      if (global.dist <= tol && global.along >= this.along - 300 && global.along - this.along <= reach) loc = global;
    }
    let wrongWay = false;
    if (speed !== null && speed > 6 && Number.isFinite(fix.heading) && loc.dist <= tol) {
      const a = r.coords[loc.index];
      const b = r.coords[loc.index + 1];
      if (b && haversine(a, b) > 3 && angleDiff(fix.heading, bearing(a, b)) > 110) wrongWay = true;
    }
    if (loc.dist > tol || wrongWay) {
      this.offCount++;
      this.offSince ??= fix.time;
      const turnedAway = !wrongWay && speed !== null && speed > 5 && Number.isFinite(fix.heading) && angleDiff(fix.heading, bearingAt(r.coords, r.cum, loc.along)) > TURNED_AWAY;
      const confirmed = turnedAway ? this.offCount >= 2 && fix.time - this.offSince >= 1000 : this.offCount >= 3 && fix.time - this.offSince >= 4000;
      if (!this.rerouteRequested && confirmed) {
        this.rerouteRequested = true;
        out.offRoute = true;
      }
      out.progress = this.progress(loc, true);
      return out;
    }
    this.offCount = 0;
    this.offSince = null;
    this.lastOnTime = fix.time;
    this.segIndex = loc.index;
    this.along = loc.along >= this.along - 50 ? Math.max(this.along, loc.along) : loc.along;

    const prevStep = this.stepIndex;
    if (steps[this.stepIndex].along > this.along + 3) this.stepIndex = 0;
    while (this.stepIndex + 1 < steps.length && steps[this.stepIndex + 1].along <= this.along + 3) this.stepIndex++;

    const k = this.nextVoiced(this.stepIndex + 1);
    const next = steps[k];
    const dist = Math.max(0, next.along - this.along);
    const key = (stage) => `${k}:${stage}`;

    if (!this.started) {
      this.started = true;
      out.speech.push({ text: this.say(steps[0]), priority: 2 });
    }

    if (next.kind === 'arrive') {
      const toEnd = Math.min(dist, haversine(p, r.coords[r.coords.length - 1]));
      if (toEnd <= 30 || this.along >= r.distance - 25) {
        this.arrived = true;
        out.arrived = true;
        if (!this.said.has(key('now'))) out.speech.push({ text: this.say(next), priority: 2 });
        this.said.add(key('now'));
        out.progress = this.progress(loc);
        return out;
      }
    }

    const after = this.nextVoiced(k + 1);
    const following = after > k && steps[after].along - next.along < 200 && next.kind !== 'arrive' ? steps[after] : null;
    const withThen = (text) => (following ? chain(text, this.say(following), this.lang) : text);
    const far = v > 22 ? 2000 : v > 13 ? 1000 : 0;
    const near = v > 22 ? 800 : v > 13 ? 400 : 180;
    const now = clamp(v * 4.5, 35, 160);
    const passedVoiced = steps.slice(prevStep + 1, this.stepIndex + 1).some((s) => !SILENT.has(s.kind));

    if (!this.said.has(key('now')) && dist <= now && next.kind !== 'continue' && next.kind !== 'arrive') {
      out.speech.push({ text: withThen(this.say(next)), priority: 2 });
      ['now', 'near', 'far'].forEach((s) => this.said.add(key(s)));
    } else if (!this.said.has(key('near')) && dist <= near && dist > now + 30) {
      out.speech.push({ text: withThen(withDistance(this.say(next), dist, this.lang)), priority: 2 });
      ['near', 'far'].forEach((s) => this.said.add(key(s)));
    } else if (far && !this.said.has(key('far')) && dist <= far && dist > near + 200 && next.kind !== 'continue') {
      out.speech.push({ text: withDistance(this.say(next), dist, this.lang), priority: 2 });
      this.said.add(key('far'));
    } else if (passedVoiced && dist > 5000 && !this.said.has(key('post'))) {
      out.speech.push({ text: continueFor(dist, this.lang), priority: 1 });
      this.said.add(key('post'));
    }

    if (this.announce) {
      this.announce = false;
      if (!out.speech.length && next.kind !== 'continue') {
        out.speech.push({ text: withThen(withDistance(this.say(next), dist, this.lang)), priority: 1 });
        if (dist <= near + 200) this.said.add(key('near'));
        if (dist <= Math.max(far, near + 200)) this.said.add(key('far'));
      }
      for (const s of out.speech) s.priority = 1;
    }

    for (const poi of this.pois) {
      const d = poi.along - this.along;
      if (d < -10 || this.alerted.has(poi.id)) continue;
      if (d > 3000) break;
      const lead = ALERT_LEAD[poi.kind];
      if (lead && d <= Math.max(lead[0], v * lead[1])) {
        this.alerted.add(poi.id);
        out.alerts.push({ ...poi, distance: d });
        out.speech.push({ text: alertText(poi, d, this.lang), priority: 1 });
      }
    }

    out.progress = this.progress(loc);
    out.speeding = this.checkSpeed(speed, out.progress.speedLimit, fix.time ?? Date.now());
    return out;
  }

  checkSpeed(speed, limit, time) {
    const kmh = Math.round((speed ?? 0) * 3.6);
    if (!limit || kmh <= limit) {
      this.speeding = false;
      return false;
    }
    if (this.speeding || kmh <= limit + SPEEDING_MARGIN) return false;
    this.speeding = true;
    if (time - this.speedingAt < SPEEDING_QUIET) return false;
    this.speedingAt = time;
    return true;
  }

  progress(loc = null, off = false) {
    const r = this.route;
    const steps = r.steps;
    const along = this.along;
    const k = this.nextVoiced(this.stepIndex + 1);
    const next = steps[k];
    const after = this.nextVoiced(k + 1);
    const following = after > k && steps[after].along - next.along < 300 ? steps[after] : null;
    return {
      along,
      remaining: Math.max(0, r.distance - along),
      remainingTime: timeAfter(r, this.stepIndex, along),
      stepIndex: this.stepIndex,
      next,
      nextIndex: k,
      nextDistance: Math.max(0, next.along - along),
      speedLimit: r.speedLimits?.find((s) => along >= s.from && along < s.to)?.kmh ?? null,
      following,
      snapped: loc && !off ? loc.point : null,
      offRoute: off,
    };
  }
}
