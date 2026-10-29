import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromOsrm, fromValhalla } from '../public/src/providers.js';
import { attachLanes, laneCatalog } from '../public/src/lanes.js';
import { laneIcon } from '../public/src/icons.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const catalog = laneCatalog(fixture('valhalla_trace_klcc_midvalley.json'));
const summary = (lanes) => lanes.map((l) => `${l.on ? '*' : ''}${l.dirs.join('+')}`).join(' | ');
const findStep = (route, kind, name) => route.steps.find((s) => s.kind === kind && s.names.includes(name));
const SULTAN_ISMAIL = '*left | straight+right | right';

test('reads lanes from every intersection of a Valhalla trace', () => {
  assert.ok(catalog.length > 10);
  const entry = catalog.find((c) => summary(c.lanes) === SULTAN_ISMAIL);
  assert.ok(entry, 'the Jalan Sultan Ismail left-turn lanes are in the catalog');
  assert.equal(entry.lanes[0].use, 'left');
});

test('attaches traced lanes to the maneuvers of the traced route', () => {
  const [route] = fromValhalla(fixture('valhalla_klcc_midvalley.json'));
  attachLanes(route, catalog);
  assert.equal(summary(findStep(route, 'turn', 'Jalan Sultan Ismail').lanes), SULTAN_ISMAIL);
  assert.equal(route.steps[0].lanes, undefined, 'depart never gets lanes');
  assert.equal(route.steps.filter((s) => s.lanes).length, 4);
});

test('works for routes from any provider once they are traced', () => {
  const [route] = fromOsrm(fixture('osrm_klcc_midvalley.json'));
  attachLanes(route, laneCatalog(fixture('osrm_trace_klcc_midvalley.json')));
  assert.equal(summary(findStep(route, 'turn', 'Jalan Sultan Ismail').lanes), SULTAN_ISMAIL);
  assert.equal(route.steps.filter((s) => s.lanes).length, 4);
});

test('only touches steps inside the traced window', () => {
  const [route] = fromValhalla(fixture('valhalla_klcc_midvalley.json'));
  const turn = findStep(route, 'turn', 'Jalan Sultan Ismail');
  attachLanes(route, catalog, 0, turn.along);
  assert.equal(turn.lanes, undefined);
  attachLanes(route, catalog, turn.along, Infinity);
  assert.equal(summary(turn.lanes), SULTAN_ISMAIL);
});

test('rejects lanes for a different exit road at the same junction', () => {
  const [route] = fromValhalla(fixture('valhalla_klcc_midvalley.json'));
  const entry = catalog.find((c) => summary(c.lanes) === SULTAN_ISMAIL);
  const otherRoad = entry.bearings.findIndex((_, i) => i !== entry.in && i !== entry.out);
  attachLanes(route, [{ ...entry, out: otherRoad }]);
  assert.ok(route.steps.every((s) => !s.lanes));
});

test('skips lane sets that carry no choice', () => {
  const [route] = fromValhalla(fixture('valhalla_klcc_midvalley.json'));
  const entry = catalog.find((c) => summary(c.lanes) === SULTAN_ISMAIL);
  attachLanes(route, [{ ...entry, lanes: entry.lanes.map((l) => ({ ...l, on: true })) }]);
  assert.ok(route.steps.every((s) => !s.lanes));
});

test('draws the used arrow bright and the rest dim', () => {
  const svg = laneIcon({ dirs: ['straight', 'left'], on: true, use: 'left' });
  assert.equal((svg.match(/class="on"/g) || []).length, 1);
  assert.equal((svg.match(/class="off"/g) || []).length, 1);
  assert.ok(svg.lastIndexOf('class="on"') > svg.indexOf('class="off"'), 'the bright arrow is drawn on top');
  const any = laneIcon({ dirs: ['straight', 'left'], on: true, use: null });
  assert.equal((any.match(/class="on"/g) || []).length, 2);
  const off = laneIcon({ dirs: ['right'], on: false, use: null });
  assert.ok(!off.includes('class="on"'));
});
