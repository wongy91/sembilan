import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bearing, bearingAt, locate, pointAt } from '../public/src/geo.js';
import { fromValhalla } from '../public/src/providers.js';
import { poisAlongRoute } from '../public/src/pois.js';
import { Navigator } from '../public/src/navigator.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const pois = JSON.parse(readFileSync(new URL('../public/data/pois.json', import.meta.url), 'utf8'));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function stepSpeed(route, along) {
  let k = 0;
  while (k + 1 < route.steps.length && route.steps[k + 1].along <= along) k++;
  const s = route.steps[k];
  return clamp(s.duration > 0 ? s.length / s.duration : 12, 4, 33);
}

function drive(route, nav, { dt = 1, until = Infinity, offset = null, reverseHeading = false } = {}) {
  const log = [];
  let along = 0;
  let t = 0;
  let out = null;
  while (along < Math.min(until, route.distance) || (until === Infinity && !out?.arrived)) {
    const v = stepSpeed(route, along);
    along = Math.min(route.distance, along + v * dt);
    const p = pointAt(route.coords, route.cum, along);
    const ahead = pointAt(route.coords, route.cum, Math.min(route.distance, along + 8));
    const h = bearing(p, ahead);
    const pos = offset ? [p[0] + offset, p[1]] : p;
    out = nav.update({ lon: pos[0], lat: pos[1], accuracy: 5, speed: v, heading: reverseHeading ? (h + 180) % 360 : h, time: t * 1000 });
    for (const s of out.speech) log.push({ t, along, text: s.text, priority: s.priority });
    log.last = out;
    t += dt;
    if (out.arrived || t > 20000) break;
  }
  log.t = t;
  return log;
}

test('guides through Putrajaya roundabouts in Malay and arrives', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const log = drive(route, new Navigator(route, { lang: 'ms' }));
  const texts = log.map((l) => l.text);
  assert.equal(texts[0], 'Menuju ke timur laut');
  assert.ok(texts.some((x) => /belok kiri ke Jalan P7 A/i.test(x)), texts.join('\n'));
  assert.ok(texts.some((x) => /Di bulatan, ambil jalan keluar ketiga/i.test(x)), texts.join('\n'));
  assert.equal(texts.at(-1), 'Anda telah tiba di destinasi');
  assert.ok(log.last.arrived);
  for (let i = 1; i < texts.length; i++) assert.notEqual(texts[i], texts[i - 1], `repeated: ${texts[i]}`);
});

test('announces highway exits early, alerts for cameras and tolls, and keeps ETA falling', () => {
  const [route] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  const nav = new Navigator(route, { lang: 'ms', pois: poisAlongRoute(route, pois) });
  const etas = [];
  const log = [];
  let along = 0;
  for (let t = 0; t < 20000; t += 2) {
    const v = stepSpeed(route, along);
    along = Math.min(route.distance, along + v * 2);
    const p = pointAt(route.coords, route.cum, along);
    const out = nav.update({ lon: p[0], lat: p[1], accuracy: 5, speed: v, heading: null, time: t * 1000 });
    log.push(...out.speech.map((s) => s.text));
    etas.push(out.progress.remainingTime);
    if (out.arrived) break;
  }
  assert.ok(log.includes('Dalam 2 kilometer, ambil susur keluar 137 ke arah Simpang Pulai, Batu Gajah'), log.join('\n'));
  assert.ok(log.some((x) => x.startsWith('Kamera had laju dalam')), 'camera alert');
  assert.ok(log.some((x) => x.startsWith('Plaza Tol Jalan Duta dalam')), 'toll alert');
  assert.ok(log.some((x) => /^Terus sejauh 1\d\d kilometer$/.test(x)), 'long-stretch reassurance');
  assert.equal(log.at(-1), 'Anda telah tiba di destinasi');
  const rises = etas.filter((e, i) => i > 0 && e > etas[i - 1] + 1).length;
  assert.equal(rises, 0, 'remaining time never increases while on route');
  assert.ok(etas[0] > 9000 && etas.at(-1) < 60);
});

test('requests one reroute after sustained off-route driving', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const nav = new Navigator(route);
  const t0 = drive(route, nav, { until: 1000 }).t * 1000;
  const p = pointAt(route.coords, route.cum, 1000);
  const side = (bearingAt(route.coords, route.cum, 1000) + 90) * (Math.PI / 180);
  const off = [p[0] + (250 * Math.sin(side)) / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + (250 * Math.cos(side)) / 110574];
  assert.ok(locate(route.coords, route.cum, off).dist > 150, 'test point must be well away from the whole route');
  let reroutes = 0;
  for (let i = 0; i < 10; i++) {
    const out = nav.update({ lon: off[0], lat: off[1], accuracy: 8, speed: 10, heading: 90, time: t0 + i * 1000 });
    if (out.offRoute) reroutes++;
    assert.ok(!out.arrived);
  }
  assert.equal(reroutes, 1);
  nav.resetOffRoute();
  const again = [0, 1, 2, 3, 4, 5].map(
    (i) => nav.update({ lon: off[0], lat: off[1], accuracy: 8, speed: 10, heading: 90, time: t0 + 20000 + i * 1000 }).offRoute,
  );
  assert.equal(again.filter(Boolean).length, 1);
});

test('treats driving against the route direction as off-route', () => {
  const [route] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  const nav = new Navigator(route);
  const log = drive(route, nav, { until: 60000, reverseHeading: true });
  assert.ok(log.last.progress.offRoute);
});

test('does not flag GPS noise of 25 m as off-route', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const nav = new Navigator(route);
  const log = drive(route, nav, { offset: 0.0002 });
  assert.ok(log.last.arrived);
});

function missTurn(route, nav, { speed = 14, heading = null } = {}) {
  const turn = route.steps.find((s) => s.kind === 'turn' && /^(left|right)$/.test(s.modifier || '') && s.along > 400);
  let along = turn.along - 200;
  let t = 0;
  for (; along < turn.along; along += speed, t++) {
    const p = pointAt(route.coords, route.cum, along);
    nav.update({ lon: p[0], lat: p[1], accuracy: 5, speed, heading: bearingAt(route.coords, route.cum, along), time: t * 1000 });
  }
  const straight = heading ?? bearingAt(route.coords, route.cum, turn.along - 30, 30);
  const corner = pointAt(route.coords, route.cum, turn.along);
  for (let i = 1; i <= 15; i++) {
    const d = speed * i;
    const r = (straight * Math.PI) / 180;
    const p = [corner[0] + (d * Math.sin(r)) / (111320 * Math.cos((corner[1] * Math.PI) / 180)), corner[1] + (d * Math.cos(r)) / 110574];
    if (nav.update({ lon: p[0], lat: p[1], accuracy: 5, speed, heading: straight, time: (t + i) * 1000 }).offRoute) return i;
  }
  return null;
}

test('a missed turn is caught once three fixes head away from the route', () => {
  const [route] = fromValhalla(fixture('valhalla_klcc_midvalley.json'));
  const seconds = missTurn(route, new Navigator(route));
  assert.ok(seconds != null && seconds <= 5, `rerouted ${seconds} s after the turn`);
});

function beside(route, along, metres) {
  const p = pointAt(route.coords, route.cum, along);
  const side = ((bearingAt(route.coords, route.cum, along) + 90) * Math.PI) / 180;
  return [p[0] + (metres * Math.sin(side)) / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + (metres * Math.cos(side)) / 110574];
}

function offFixes(route, nav, { from, n, step = 10, metres, speed = 10, turn = 0 }) {
  const offs = [];
  for (let i = 0; i < n; i++) {
    const along = from + i * step;
    const [lon, lat] = beside(route, along, typeof metres === 'function' ? metres(i) : metres);
    const heading = (bearingAt(route.coords, route.cum, along) + turn * (i % 2 ? 1 : -1) + 360) % 360;
    offs.push(nav.update({ lon, lat, accuracy: 5, speed, heading, time: 2000000 + i * 1000 }).offRoute);
  }
  return offs;
}

test('staying 60 m beside the route, as GPS drift does, waits 10 seconds before rerouting', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const nav = new Navigator(route);
  drive(route, nav, { until: 1000 });
  assert.equal(offFixes(route, nav, { from: 1000, n: 12, metres: 60 }).indexOf(true), 10);
});

test('drifting away from the route steadily is still caught after 4 seconds', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const nav = new Navigator(route);
  drive(route, nav, { until: 1000 });
  assert.equal(offFixes(route, nav, { from: 1000, n: 8, metres: (i) => 50 + i * 8 }).indexOf(true), 4);
});

test('GPS drift with a wobbling heading in slow traffic does not reroute', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const nav = new Navigator(route);
  drive(route, nav, { until: 1000 });
  const offs = offFixes(route, nav, { from: 1000, n: 9, step: 7, speed: 7, turn: 40, metres: (i) => 50 + (i % 3) * 6 });
  assert.equal(offs.indexOf(true), -1);
});

test('a GPS jump while stopped in a jam does not reroute', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const nav = new Navigator(route);
  drive(route, nav, { until: 1000 });
  assert.equal(offFixes(route, nav, { from: 1000, n: 30, step: 0, speed: 0.5, metres: 70 }).indexOf(true), -1);
});

test('driving through a wide toll plaza, 70 m from the route line, does not reroute', () => {
  const [route] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  const found = poisAlongRoute(route, pois);
  const plaza = found.find((p) => p.kind === 'toll' && p.along > 20000);
  const nav = new Navigator(route, { pois: found });
  drive(route, nav, { until: plaza.along - 250 });
  assert.equal(offFixes(route, nav, { from: plaza.along - 200, n: 40, step: 10, speed: 5, metres: 70 }).indexOf(true), -1);
});

test('after a reroute, the first instruction of the new route is spoken once, queued behind "Rerouting"', () => {
  const [route] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  const nav = new Navigator(route, { lang: 'en', resumed: true, announce: true });
  const start = pointAt(route.coords, route.cum, 20);
  const first = nav.update({ lon: start[0], lat: start[1], accuracy: 5, speed: 14, heading: bearingAt(route.coords, route.cum, 20), time: 0 });
  assert.equal(first.speech.length, 1);
  assert.match(first.speech[0].text, /^In \d/);
  assert.equal(first.speech[0].priority, 1);
  const next = pointAt(route.coords, route.cum, 34);
  assert.equal(nav.update({ lon: next[0], lat: next[1], accuracy: 5, speed: 14, heading: bearingAt(route.coords, route.cum, 34), time: 1000 }).speech.length, 0);
});

function cameraDrive(plan, { limit = 110 } = {}) {
  const [route] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  const camAlong = 60000;
  const nav = new Navigator(route, { lang: 'en', resumed: true, pois: [{ kind: 'camera', id: 'camera:test', along: camAlong, maxspeed: limit }] });
  let along = camAlong - 2000;
  let t = 0;
  const log = { alertAt: null, ticks: [], shown: [], after: undefined };
  for (const [kmh, seconds] of plan) {
    for (let i = 0; i < seconds && along < camAlong + 40; i++, t++) {
      const v = kmh / 3.6;
      along += v;
      const p = pointAt(route.coords, route.cum, along);
      const out = nav.update({ lon: p[0], lat: p[1], accuracy: 5, speed: v, heading: bearingAt(route.coords, route.cum, along), time: t * 1000 });
      if (out.alerts.some((a) => a.kind === 'camera')) log.alertAt = camAlong - along;
      if (out.camera?.tick) log.ticks.push({ tick: out.camera.tick, d: Math.round(out.camera.distance), t, kmh });
      if (out.camera) log.shown.push(Math.round(out.camera.distance));
      log.after = out.camera;
    }
  }
  return log;
}

test('a speed camera is announced about 35 seconds ahead, over 1 km at highway speed', () => {
  const log = cameraDrive([[110, 200]]);
  assert.ok(log.alertAt >= 1000 && log.alertAt <= 1100, `announced ${Math.round(log.alertAt)} m before`);
  assert.ok(cameraDrive([[50, 400]]).alertAt >= 970, 'at least about 1 km even when slow');
});

test('approaching a camera ticks every 100 m, every 50 m in the last 300 m, and the card counts down until you pass', () => {
  const log = cameraDrive([[110, 200]]);
  assert.ok(log.ticks.length >= 12 && log.ticks.length <= 16, `${log.ticks.length} ticks`);
  assert.ok(log.ticks.every((x) => x.tick === 'soft'), 'quiet ticks at the limit');
  const gaps = log.ticks.slice(1).map((x, i) => x.t - log.ticks[i].t);
  assert.ok(Math.max(...gaps) <= 4, 'about every 3 s at 110 km/h');
  assert.deepEqual(log.shown, [...log.shown].sort((a, b) => b - a), 'distance only counts down');
  assert.equal(log.after, null, 'gone once you pass the camera');
});

test('over the camera limit the ticks turn into sharp beeps', () => {
  const log = cameraDrive([[130, 200]]);
  assert.ok(log.ticks.length > 0 && log.ticks.every((x) => x.tick === 'over'));
});

test('stuck in a jam near a camera, the ticks stop', () => {
  const log = cameraDrive([[110, 40], [0, 180], [2, 120], [110, 200]]);
  const jam = log.ticks.filter((x) => x.kmh < 10);
  assert.equal(jam.length, 0, 'no ticks while stopped or crawling');
  assert.ok(log.ticks.some((x) => x.kmh === 110 && x.t > 340), 'ticking resumes once moving');
});
