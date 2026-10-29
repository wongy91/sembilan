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
