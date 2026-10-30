import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bearing, haversine, pointAt } from '../public/src/geo.js';
import { fuelAlongRoute } from '../public/src/pois.js';
import { detourTimes } from '../public/src/routing.js';
import { bannerOf, instruction, maneuverIcon } from '../public/src/instructions.js';
import { fromOsrm, fromTomTom, fromValhalla } from '../public/src/providers.js';
import { Navigator } from '../public/src/navigator.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const STOP = [101.677, 3.1175];
const [valhalla] = fromValhalla(fixture('valhalla_kuchai_stop_klcc.json'));
const [osrm] = fromOsrm(fixture('osrm_kuchai_stop_klcc.json'));

for (const [name, route] of [['Valhalla', valhalla], ['OSRM', osrm]]) {
  test(`${name}: a route through a stop has one depart, one stop and one arrival`, () => {
    const kinds = route.steps.map((s) => s.kind);
    assert.equal(kinds.filter((k) => k === 'depart').length, 1);
    assert.equal(kinds.filter((k) => k === 'arrive').length, 1);
    assert.equal(kinds.at(-1), 'arrive');
    const stops = route.steps.filter((s) => s.kind === 'waypoint');
    assert.equal(stops.length, 1);
    assert.equal(stops[0].side, 'left');
    assert.ok(haversine(route.coords[stops[0].index], STOP) < 150, 'the stop step sits at the stop');
    assert.ok(stops[0].along > 0 && stops[0].along < route.distance);
  });
}

test('TomTom waypoint maneuvers become a stop with its side', () => {
  const leg = (pts) => ({ points: pts.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) });
  const json = {
    routes: [{
      summary: { lengthInMeters: 4400, travelTimeInSeconds: 600 },
      legs: [leg([[101.70, 3.15], [101.70, 3.16], [101.70, 3.17]]), leg([[101.70, 3.17], [101.71, 3.17], [101.72, 3.17]])],
      sections: [],
      guidance: {
        instructions: [
          { maneuver: 'DEPART', pointIndex: 0, travelTimeInSeconds: 0 },
          { maneuver: 'WAYPOINT_RIGHT', pointIndex: 2, travelTimeInSeconds: 300 },
          { maneuver: 'TURN_RIGHT', pointIndex: 4, travelTimeInSeconds: 400, street: 'Jalan Ampang' },
          { maneuver: 'ARRIVE', pointIndex: 5, travelTimeInSeconds: 600 },
        ],
      },
    }],
  };
  const [route] = fromTomTom(json);
  assert.deepEqual(route.steps.map((s) => [s.kind, s.side]), [['depart', null], ['waypoint', 'right'], ['turn', null], ['arrive', null]]);
});

test('the stop is spoken and shown like an arrival, in all three languages', () => {
  const left = { kind: 'waypoint', side: 'left', names: [], refs: [] };
  assert.equal(instruction(left, 'en'), 'Your stop is on the left');
  assert.equal(instruction(left, 'ms'), 'Hentian anda di sebelah kiri');
  assert.equal(instruction(left, 'zh'), '经停点在左侧');
  assert.equal(instruction({ kind: 'waypoint', names: [], refs: [] }, 'en'), 'You have reached your stop');
  assert.equal(bannerOf(left, 'en').text, 'Your stop is on the left');
  assert.equal(maneuverIcon(left), 'arrive');
});

test('driving through the stop announces it and carries on to the destination', () => {
  const nav = new Navigator(valhalla, { lang: 'en' });
  const stop = valhalla.steps.find((s) => s.kind === 'waypoint');
  const spoken = [];
  let arrivedAt = null;
  for (let along = 0, t = 0; along <= valhalla.distance + 30; along += 10, t++) {
    const p = pointAt(valhalla.coords, valhalla.cum, along);
    const out = nav.update({ lon: p[0], lat: p[1], accuracy: 5, speed: 10, heading: bearing(p, pointAt(valhalla.coords, valhalla.cum, along + 8)), time: t * 1000 });
    for (const s of out.speech) spoken.push([along, s.text]);
    if (out.arrived && arrivedAt == null) arrivedAt = along;
  }
  const atStop = spoken.filter(([, text]) => /your stop/i.test(text));
  assert.ok(atStop.length >= 1, 'the stop is announced');
  assert.ok(atStop.every(([along]) => along <= stop.along), 'before reaching it');
  assert.ok(arrivedAt > valhalla.distance - 50, 'the trip only ends at the destination');
  assert.match(spoken.at(-1)[1], /destination/);
});

test('petrol on your route: stations within 100 m of the road ahead, in the order you reach them', () => {
  const route = valhalla;
  const at = (m, east = 0) => {
    const [lon, lat] = pointAt(route.coords, route.cum, m);
    return [+(lon + east).toFixed(5), lat];
  };
  const stations = [
    [...at(3000), 'Shell', 'Jalan Klang Lama'],
    [...at(1500, 0.0004), 'Petronas', ''],
    [...at(2000, 0.004), 'Too far off the road', ''],
    [...at(500), 'Behind you', ''],
    [101.0, 4.6, 'Ipoh', ''],
  ];
  const found = fuelAlongRoute(route, stations, 1000);
  assert.deepEqual(found.map((p) => [p.name, Math.round(p.along / 100) / 10]), [['Petronas', 1.5], ['Shell', 3]]);
  assert.equal(found[1].sub, 'Jalan Klang Lama');
  assert.deepEqual(fuelAlongRoute(route, stations, 1000, 1800).map((p) => p.name), ['Petronas'], 'only as far ahead as asked');
});

test('detour minutes: drive to the station and back onto the route, minus staying on it', async () => {
  const places = [{ lon: 101.68, lat: 3.1, along: 1500 }, { lon: 101.69, lat: 3.12, along: 3000 }];
  const original = globalThis.fetch;
  const sent = [];
  const cell = (time) => ({ time });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    const fromHere = [[cell(120), cell(300), cell(400), cell(500)]];
    const back = [[cell(330), cell(9)], [cell(9), { time: null }]];
    return new Response(JSON.stringify({ sources_to_targets: body.sources.length === 1 ? fromHere : back }));
  };
  try {
    const times = await detourTimes([101.6845, 3.0905], places, valhalla, { heading: 30, avoidTolls: true });
    assert.deepEqual(times, [50, null], '120 s there + 330 s back - 400 s straight on = 50 s; a missing leg gives no time');
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(sent.every((s) => /\/sources_to_targets$/.test(s.url)));
  const [fromHere, back] = [sent.find((s) => s.body.sources.length === 1).body, sent.find((s) => s.body.sources.length === 2).body];
  assert.deepEqual(fromHere.sources[0], { lon: 101.6845, lat: 3.0905, heading: 30, heading_tolerance: 60 });
  assert.equal(fromHere.targets.length, 4);
  assert.deepEqual(back.sources, [{ lon: 101.68, lat: 3.1 }, { lon: 101.69, lat: 3.12 }]);
  const rejoin = pointAt(valhalla.coords, valhalla.cum, 3500);
  assert.deepEqual(back.targets[0], { lon: rejoin[0], lat: rejoin[1] }, 'rejoins the route 2 km past the station');
  assert.equal(back.costing_options.auto.use_tolls, 0);
  assert.ok(sent.every((s) => s.body.sources.length * s.body.targets.length <= 100), 'within the public server limit');
});
