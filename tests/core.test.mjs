import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bearing, cumulative, decodePolyline, encodePolyline, haversine, locate, pointAt, sideOf, slice } from '../public/src/geo.js';
import { instruction, maneuverIcon, spokenDistance, withDistance } from '../public/src/instructions.js';
import { fromOsrm, fromTomTom, fromValhalla, distinctRoutes } from '../public/src/providers.js';
import { poisAlongRoute, reportPois, signalsAlongRoute, summarize } from '../public/src/pois.js';
import { fmtDistance, fmtDuration } from '../public/src/i18n.js';
import { Navigator } from '../public/src/navigator.js';
import { tollFeatures } from '../public/src/map.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const pois = JSON.parse(readFileSync(new URL('../public/data/pois.json', import.meta.url), 'utf8'));

test('decodes Google polyline example at precision 5', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(pts, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  assert.equal(encodePolyline(pts, 5), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  const kl = [[101.7117, 3.1579], [101.700012, 3.160098], [101.6776, 3.1178]];
  assert.deepEqual(decodePolyline(encodePolyline(kl)), kl);
});

test('geometry helpers', () => {
  assert.ok(Math.abs(haversine([101, 3], [101, 4]) - 111195) < 5);
  assert.ok(Math.abs(bearing([101, 3], [101, 4])) < 1e-9);
  const line = [[101, 3], [101, 3.01], [101.01, 3.01]];
  const cum = cumulative(line);
  const hit = locate(line, cum, [100.9995, 3.005]);
  assert.equal(hit.index, 0);
  assert.ok(Math.abs(hit.dist - 55.5) < 1);
  assert.ok(Math.abs(hit.along - cum[1] / 2) < 1);
  assert.ok(sideOf(line[0], line[1], [100.99, 3.005]) > 0, 'west of a northbound segment is on the left');
  assert.deepEqual(pointAt(line, cum, cum[1]), [101, 3.01]);
  const part = slice(line, cum, cum[1] / 2, cum[1] + 100);
  assert.equal(part.length, 3);
  assert.ok(Math.abs(part[0][1] - 3.005) < 1e-9);
});

test('formats distances and durations', () => {
  assert.equal(fmtDistance(42), '40 m');
  assert.equal(fmtDistance(730), '750 m');
  assert.equal(fmtDistance(1440), '1.4 km');
  assert.equal(fmtDistance(203000), '203 km');
  assert.equal(fmtDuration(9452, 'ms'), '2 j 38 min');
  assert.equal(fmtDuration(9452, 'en'), '2 h 38 min');
  assert.equal(fmtDuration(600, 'ms'), '10 min');
});

test('speaks Malay and English maneuvers', () => {
  const turn = { kind: 'turn', modifier: 'left', names: ['Jalan Ampang'], refs: [], toward: [] };
  assert.equal(instruction(turn, 'ms'), 'Belok kiri ke Jalan Ampang');
  assert.equal(withDistance(instruction(turn, 'ms'), 480, 'ms'), 'Dalam 500 meter, belok kiri ke Jalan Ampang');
  assert.equal(withDistance(instruction(turn, 'en'), 480, 'en'), 'In 500 meters, turn left onto Jalan Ampang');
  const exit = { kind: 'exit', modifier: 'left', names: [], refs: [], toward: ['Simpang Pulai', 'Batu Gajah'], exitNumber: '137' };
  assert.equal(instruction(exit, 'ms', { spoken: true }), 'Ambil susur keluar 137 ke arah Simpang Pulai, Batu Gajah');
  assert.equal(instruction(exit, 'en'), 'Take exit 137 toward Simpang Pulai / Batu Gajah');
  const rb = { kind: 'roundabout', roundaboutExit: 3, names: [], refs: [], toward: [] };
  assert.equal(instruction(rb, 'ms'), 'Di bulatan, ambil jalan keluar ketiga');
  assert.equal(instruction(rb, 'en'), 'At the roundabout, take the third exit');
  assert.equal(instruction({ kind: 'arrive', side: 'left' }, 'ms'), 'Destinasi anda di sebelah kiri');
  assert.equal(spokenDistance(1450, 'ms'), '1.5 kilometer');
  assert.equal(spokenDistance(980, 'en'), '1 kilometer');
  assert.equal(spokenDistance(2000, 'en'), '2 kilometers');
  assert.equal(spokenDistance(173600, 'ms'), '174 kilometer');
  assert.equal(spokenDistance(260, 'ms'), '250 meter');
});

test('normalizes a real Valhalla KL to Ipoh response', () => {
  const routes = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  assert.equal(routes.length, 2);
  const [main] = routes;
  assert.ok(Math.abs(main.distance - 203259) < 2000, `distance ${main.distance}`);
  assert.equal(main.steps[0].kind, 'depart');
  assert.equal(main.steps.at(-1).kind, 'arrive');
  assert.ok(main.steps.every((s, i) => i === 0 || s.along >= main.steps[i - 1].along));
  assert.ok(main.hasToll && main.tollDistance > 150000);
  assert.deepEqual(main.via, ['Lebuhraya Utara–Selatan', 'Lebuhraya DUKE']);
  const exit = main.steps.find((s) => s.kind === 'exit');
  assert.equal(exit.exitNumber, '137');
  assert.deepEqual(exit.toward.slice(0, 2), ['Simpang Pulai', 'Batu Gajah']);
  const federal = main.steps.find((s) => s.kind === 'turn' && s.refs.includes('FT1'));
  assert.ok(federal, 'digit-only federal route refs become FT refs');
  assert.equal(instruction(federal, 'ms'), 'Belok kanan ke FT1');
  assert.equal(distinctRoutes([...routes, routes[0]]).length, 2);
});

test('normalizes Valhalla roundabouts in Putrajaya', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const rbs = route.steps.filter((s) => s.kind === 'roundabout');
  assert.deepEqual(rbs.map((s) => s.roundaboutExit), [1, 3]);
  assert.equal(instruction(rbs[0], 'ms'), 'Di bulatan, ambil jalan keluar pertama ke Persiaran Perdana');
});

test('normalizes a real OSRM response', () => {
  const [route] = fromOsrm(fixture('osrm_kl_ipoh.json'));
  assert.ok(Math.abs(route.distance - 202237) < 2500);
  assert.equal(route.steps[0].kind, 'depart');
  assert.equal(route.steps.at(-1).kind, 'arrive');
  assert.ok(route.steps.every((s, i) => i === 0 || s.along >= route.steps[i - 1].along));
  assert.ok(route.steps.some((s) => s.exitNumber === '3305B'));
});

test('normalizes TomTom routing (synthetic response shaped like the documented schema)', () => {
  const pts = [[101.70, 3.15], [101.70, 3.16], [101.70, 3.17], [101.71, 3.17], [101.72, 3.17]];
  const json = {
    routes: [{
      summary: { lengthInMeters: 4500, travelTimeInSeconds: 600, trafficDelayInSeconds: 180, noTrafficTravelTimeInSeconds: 420 },
      legs: [{ points: pts.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) }],
      sections: [
        { sectionType: 'TOLL_ROAD', startPointIndex: 1, endPointIndex: 3 },
        { sectionType: 'TRAFFIC', startPointIndex: 2, endPointIndex: 4, delayInSeconds: 180, simpleCategory: 'JAM', magnitudeOfDelay: 2 },
        { sectionType: 'SPEED_LIMIT', startPointIndex: 0, endPointIndex: 2, maxSpeedLimitInKmh: 60 },
        { sectionType: 'SPEED_LIMIT', startPointIndex: 2, endPointIndex: 4, maxSpeedLimitInKmh: 90 },
      ],
      guidance: {
        instructions: [
          { maneuver: 'DEPART', pointIndex: 0, travelTimeInSeconds: 0, street: 'Jalan Tun Razak' },
          { maneuver: 'TURN_RIGHT', pointIndex: 2, travelTimeInSeconds: 300, street: 'Jalan Ampang', roadNumbers: ['2'] },
          { maneuver: 'ROUNDABOUT_LEFT', pointIndex: 3, travelTimeInSeconds: 450, roundaboutExitNumber: 2 },
          { maneuver: 'ARRIVE_LEFT', pointIndex: 4, travelTimeInSeconds: 600 },
        ],
      },
    }],
  };
  const [route] = fromTomTom(json);
  assert.equal(route.provider, 'tomtom');
  assert.deepEqual(route.steps.map((s) => s.kind), ['depart', 'turn', 'roundabout', 'arrive']);
  assert.deepEqual(route.steps[1].refs, ['FT2']);
  assert.equal(route.steps[3].side, 'left');
  assert.equal(route.trafficDelay, 180);
  assert.equal(route.traffic.length, 1);
  assert.ok(route.hasToll && route.tollSections.length === 1);
  assert.equal(route.steps[1].duration, 150);
  assert.deepEqual(route.speedLimits.map((s) => s.kmh), [60, 90]);
  const nav = new Navigator(route);
  nav.update({ lon: 101.7, lat: 3.165, accuracy: 5, speed: 10, heading: 0, time: 0 });
  assert.equal(nav.progress().speedLimit, 60);
  assert.equal(instruction(route.steps[2], 'ms'), 'Di bulatan, ambil jalan keluar kedua');
});

test('a TomTom exit takes its side from the turn angle, so the arrow points the way out', () => {
  const pts = [[101.70, 3.15], [101.70, 3.16], [101.70, 3.17], [101.71, 3.18]];
  const exit = (turnAngleInDecimalDegrees) => fromTomTom({
    routes: [{
      summary: { lengthInMeters: 3500, travelTimeInSeconds: 300 },
      legs: [{ points: pts.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) }],
      guidance: {
        instructions: [
          { maneuver: 'DEPART', pointIndex: 0, travelTimeInSeconds: 0 },
          { maneuver: 'TAKE_EXIT', junctionType: 'REGULAR', turnAngleInDecimalDegrees, exitNumber: '231', street: 'Ayer Keroh Interchange', pointIndex: 2, travelTimeInSeconds: 200 },
          { maneuver: 'ARRIVE', pointIndex: 3, travelTimeInSeconds: 300 },
        ],
      },
    }],
  })[0].steps[1];
  assert.equal(maneuverIcon(exit(-45)), 'fork-left');
  assert.equal(maneuverIcon(exit(45)), 'fork-right');
  assert.equal(maneuverIcon(exit(undefined)), 'straight');
});

test('a toll stretch blends from blue to jade and back over 150 m, with TOL every kilometre', () => {
  const coords = [[101.7, 3.15], [101.7, 3.17]];
  const cum = cumulative(coords);
  const route = { coords, cum, distance: cum.at(-1), tollSections: [[500, 1800]] };
  const lines = (along) => tollFeatures(route, along).filter((f) => f.geometry.type === 'LineString');
  const labels = (along) => tollFeatures(route, along).filter((f) => f.geometry.type === 'Point');
  const ts = lines(0).map((f) => f.properties.t);
  const fadeIn = ts.filter((_, i) => i % 2 === 0 && i < 16);
  assert.deepEqual(fadeIn, [...fadeIn].sort((x, y) => x - y), 'blue to jade, step by step');
  assert.ok(fadeIn[0] < 0.1 && fadeIn.at(-1) > 0.9);
  assert.equal(ts.filter((t) => t === 1).length, 1);
  const ends = lines(0).map((f) => [locate(coords, cum, f.geometry.coordinates[0]).along, locate(coords, cum, f.geometry.coordinates.at(-1)).along]).sort((x, y) => x[0] - y[0]);
  assert.ok(Math.abs(ends[0][0] - 425) < 1 && Math.abs(ends.at(-1)[1] - 1875) < 1);
  for (let i = 1; i < ends.length; i++) assert.ok(Math.abs(ends[i][0] - ends[i - 1][1]) < 1, 'no gaps between colour steps');
  assert.deepEqual(labels(0).map((f) => Math.round(locate(coords, cum, f.geometry.coordinates).along)), [575, 1575]);
  assert.ok(lines(1000).every((f) => locate(coords, cum, f.geometry.coordinates[0]).along >= 999), 'nothing behind the car');
  assert.equal(labels(1000).length, 1);
});

test('marks one traffic light per junction the route drives through, not lights beside a slip road', () => {
  const coords = [[101.7, 3.15], [101.7, 3.16]];
  const east = (m) => 101.7 + m / 111140;
  const tomtom = { provider: 'tomtom', coords, cum: cumulative(coords) };
  const valhalla = { ...tomtom, provider: 'valhalla' };
  const flat = [
    101.7, 3.152,
    east(2), 3.15218,
    east(7.6), 3.155,
    east(4), 3.158,
    east(15), 3.159,
    101.75, 3.155,
  ];
  const shown = (route) => signalsAlongRoute(route, flat).map((s) => [+s.lon.toFixed(6), s.lat]);
  assert.deepEqual(shown(tomtom), [[101.7, 3.152], [+east(4).toFixed(6), 3.158]], 'within 5 m of a TomTom route, one per junction; 7.6 m away is a slip road');
  assert.deepEqual(shown(valhalla), [[101.7, 3.152]], 'OSM-based routes run on the same nodes as the lights, so 3 m');
  assert.deepEqual(signalsAlongRoute(tomtom, null), []);
});

test('finds toll plazas, cameras and R&R along KL to Ipoh', () => {
  const [route] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  const found = poisAlongRoute(route, pois);
  const sum = summarize(found);
  assert.ok(sum.tollNames.includes('Plaza Tol Jalan Duta'));
  assert.ok(sum.tollNames.includes('Plaza Tol Simpang Pulai'));
  const cameras = found.filter((p) => p.kind === 'camera');
  assert.ok(cameras.length >= 2);
  assert.ok(cameras.every((c) => !/southbound/i.test(c.name || '')), 'opposite-direction cameras are dropped');
  const rr = found.filter((p) => p.kind === 'rr');
  assert.ok(rr.every((p) => p.name));
  assert.ok(rr.some((p) => p.name === 'Kawasan Rehat Rawang Arah Utara'));
  assert.ok(found.every((p, i) => i === 0 || p.along >= found[i - 1].along));
});

test('counts only toll plazas the route drives through (closed system: entry and exit)', () => {
  const [route] = fromValhalla(fixture('valhalla_kl_penang.json'));
  const tolls = poisAlongRoute(route, pois).filter((p) => p.kind === 'toll').map((p) => p.name);
  assert.deepEqual(tolls, ['Plaza Tol Batu', 'Plaza Tol Jalan Duta', 'Plaza Tol Bandar Cassia (A)']);
});

test('matches community reports to the route by position and heading', () => {
  const [route] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
  const p = pointAt(route.coords, route.cum, 100000);
  const q = pointAt(route.coords, route.cum, 100050);
  const h = bearing(p, q);
  const reports = [
    { id: 'a', kind: 'police', lon: p[0], lat: p[1], heading: h },
    { id: 'b', kind: 'accident', lon: p[0], lat: p[1], heading: (h + 180) % 360 },
    { id: 'c', kind: 'hazard', lon: p[0] + 0.01, lat: p[1] },
  ];
  const matched = reportPois(route, reports);
  assert.deepEqual(matched.map((m) => m.reportId), ['a']);
  assert.ok(Math.abs(matched[0].along - 100000) < 5);
});
