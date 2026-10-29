import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulative, haversine, pointAt, thin } from '../public/src/geo.js';
import { fasterRoute, pickFaster } from '../public/src/routing.js';
import { fromTomTom } from '../public/src/providers.js';
import { Navigator, timeLeft } from '../public/src/navigator.js';

const line = (n, step = 0.0001) => Array.from({ length: n }, (_, i) => [101.7 + i * step, 3.15]);

function tomtomJson(...durations) {
  const pts = line(5, 0.01);
  return {
    routes: durations.map((travelTimeInSeconds) => ({
      summary: { lengthInMeters: 4400, travelTimeInSeconds },
      legs: [{ points: pts.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) }],
      guidance: { instructions: [{ maneuver: 'DEPART', pointIndex: 0, travelTimeInSeconds: 0 }, { maneuver: 'ARRIVE', pointIndex: 4, travelTimeInSeconds }] },
    })),
  };
}

test('thin keeps both ends and leaves at least the spacing between kept points', () => {
  const coords = line(1001);
  const out = thin(coords, 100);
  assert.deepEqual(out[0], coords[0]);
  assert.deepEqual(out.at(-1), coords.at(-1));
  assert.ok(out.length < 130 && out.length > 90, `${out.length} points for 11 km at 100 m`);
  assert.ok(out.slice(1, -1).every((p, i) => haversine(out[i], p) >= 100));
});

test('time left on a route matches the navigator and runs down to zero at the end', () => {
  const [route] = fromTomTom(tomtomJson(1800));
  assert.equal(timeLeft(route, 0), 1800);
  assert.equal(timeLeft(route, route.distance), 0);
  const half = timeLeft(route, route.distance / 2);
  assert.ok(Math.abs(half - 900) < 1, `${half} s at half way`);
  const nav = new Navigator(route);
  const [lon, lat] = pointAt(route.coords, route.cum, 1500);
  nav.update({ lon, lat, accuracy: 5, speed: 12, heading: 90, time: 0 });
  assert.ok(Math.abs(nav.progress().remainingTime - timeLeft(route, nav.progress().along)) < 0.001);
});

test('a faster route must save at least 3 minutes and 5% of the trip', () => {
  const r = (duration) => ({ duration });
  assert.equal(pickFaster({ current: r(1800), better: [] }), null);
  assert.equal(pickFaster({ current: r(1800), better: [r(1650)] }), null, '2.5 min is too little');
  assert.deepEqual(pickFaster({ current: r(1800), better: [r(1500), r(1400)] }), { route: r(1400), saving: 400 });
  assert.equal(pickFaster({ current: r(7200), better: [r(6900)] }), null, '5 min of a 2-hour trip is under 5%');
  assert.equal(pickFaster({ current: undefined, better: [r(100)] }), null);
});

test('asks the Worker to time the rest of the current route and find a better one', async () => {
  const coords = line(2001);
  const route = { coords, cum: cumulative(coords), distance: cumulative(coords).at(-1) };
  let sent;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return Response.json(tomtomJson(1500, 1100));
  };
  try {
    const { current, better } = await fasterRoute(route, 11000, { avoidTolls: true });
    assert.equal(sent.url, '/api/route');
    assert.equal(sent.body.avoidTolls, true);
    assert.ok(haversine(sent.body.reference[0], pointAt(coords, route.cum, 11000)) < 2, 'starts where the car is on the route');
    assert.deepEqual(sent.body.reference.at(-1), [+coords.at(-1)[0].toFixed(5), 3.15]);
    assert.ok(sent.body.reference.length < 150);
    assert.equal(current.duration, 1500);
    assert.deepEqual(better.map((r) => r.duration), [1100]);
  } finally {
    globalThis.fetch = original;
  }
});
