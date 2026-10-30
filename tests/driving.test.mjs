import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bearing, pointAt, tileOf, tilesAlong } from '../public/src/geo.js';
import { fromValhalla } from '../public/src/providers.js';
import { bannerOf } from '../public/src/instructions.js';
import { Navigator } from '../public/src/navigator.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const [ipoh] = fromValhalla(fixture('valhalla_kl_ipoh.json'));
const [midValley] = fromValhalla(fixture('valhalla_klcc_midvalley.json'));
const [penang] = fromValhalla(fixture('valhalla_kl_penang.json'));

test('highway exits get a sign with the exit number and destinations; the text above it stays short', () => {
  const duke = ipoh.steps.find((s) => s.exitNumber === '3305B');
  assert.deepEqual(bannerOf(duke, 'en'), { text: 'Keep right', shield: '', sign: { exit: '3305B', ref: 'E33', toward: ['Ipoh', 'Klang', 'Petaling Jaya'] } });
  assert.equal(bannerOf(duke, 'ms').text, 'Kekal di sebelah kanan');
  assert.equal(bannerOf(duke, 'zh').text, '靠右行驶');

  const pulai = ipoh.steps.find((s) => s.exitNumber === '137');
  assert.deepEqual(bannerOf(pulai, 'en'), { text: 'Take the exit on the left', shield: '', sign: { exit: '137', ref: '', toward: ['Simpang Pulai', 'Batu Gajah', 'Universiti Teknologi Petronas'] } });

  const ampang = midValley.steps.find((s) => s.exitNumber === '1201A');
  assert.deepEqual(bannerOf(ampang, 'en'), {
    text: 'Keep right onto Lebuhraya Bertingkat Ampang - Kuala Lumpur',
    shield: 'E12',
    sign: { exit: '1201A', ref: '', toward: [] },
  });
});

test('turns and passing an exit keep the plain banner', () => {
  const turn = { kind: 'turn', modifier: 'left', names: ['Jalan Tun Razak'], refs: ['FT1'], toward: [], exitNumber: null };
  assert.deepEqual(bannerOf(turn, 'en'), { text: 'Turn left onto Jalan Tun Razak', shield: 'FT1', sign: null });
  const passing = ipoh.steps.find((s) => s.kind === 'continue' && s.exitNumber === '3301');
  assert.equal(bannerOf(passing, 'en').sign, null);
});

function driveAt(nav, route, plan) {
  const chimes = [];
  let along = 0;
  let t = 0;
  for (const [kmh, seconds] of plan) {
    for (let i = 0; i < seconds; i++, t++) {
      along += kmh / 3.6;
      const p = pointAt(route.coords, route.cum, along);
      const out = nav.update({ lon: p[0], lat: p[1], accuracy: 5, speed: kmh / 3.6, heading: bearing(p, pointAt(route.coords, route.cum, along + 8)), time: t * 1000 });
      if (out.speeding) chimes.push(t);
    }
  }
  return chimes;
}

test('one ding when you go more than 5 km/h over the limit, then quiet for a minute', () => {
  const route = { ...ipoh, speedLimits: [{ from: 0, to: ipoh.distance, kmh: 90 }] };
  const nav = new Navigator(route, { lang: 'en' });
  const chimes = driveAt(nav, route, [
    [90, 10],
    [95, 10],
    [100, 20],
    [85, 5],
    [100, 20],
    [85, 15],
    [100, 5],
  ]);
  assert.deepEqual(chimes, [20, 80]);
});

test('no ding without a known speed limit', () => {
  const route = { ...ipoh, speedLimits: [] };
  assert.deepEqual(driveAt(new Navigator(route, { lang: 'en' }), route, [[140, 30]]), []);
});

test('map tiles are listed along the route, nearest first, covering every point of it', () => {
  assert.deepEqual(tileOf([0, 0], 1), [1, 1]);
  assert.deepEqual(tileOf([101.6869, 3.139], 14), [12819, 8049]);
  const tiles = tilesAlong(midValley.coords, midValley.cum, 14, 400);
  const keys = new Set(tiles.map(([, x, y]) => `${x}/${y}`));
  for (let along = 0; along <= midValley.distance; along += 50) {
    const [x, y] = tileOf(pointAt(midValley.coords, midValley.cum, along), 14);
    assert.ok(keys.has(`${x}/${y}`), `tile missing at ${along} m`);
  }
  const at = (p) => tiles.findIndex(([, x, y]) => `${x}/${y}` === tileOf(p, 14).join('/'));
  assert.ok(at(midValley.coords[0]) < 4);
  assert.ok(at(midValley.coords.at(-1)) >= tiles.length - 4);
  assert.ok(tiles.length < 20, `${tiles.length} tiles for ${Math.round(midValley.distance / 1000)} km`);
  const long = [...tilesAlong(penang.coords, penang.cum, 14, 400), ...tilesAlong(penang.coords, penang.cum, 12, 2000)];
  assert.ok(long.length < 700, `${long.length} tiles for ${Math.round(penang.distance / 1000)} km`);
});
