import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportPlaces, importPlaces, readPlaces } from '../public/src/store.js';

const klcc = { name: 'KLCC', sub: 'Kuala Lumpur', lon: 101.7117, lat: 3.1579 };
const midValley = { name: 'Mid Valley Megamall', sub: 'Kuala Lumpur', lon: 101.6776, lat: 3.1178 };
const pasarSeni = { name: 'Pasar Seni — 中央艺术坊', sub: '', lon: 101.6953, lat: 3.1424 };

test('a places link round-trips Home, Work and recents, including non-Latin names', () => {
  const link = `https://sembilan.example/#places=${exportPlaces({ home: klcc, work: midValley, recents: [pasarSeni] })}`;
  assert.match(link, /#places=[A-Za-z0-9_-]+$/, 'URL-safe, no padding');
  assert.deepEqual(readPlaces(link), { home: klcc, work: midValley, recents: [pasarSeni] });
});

test('finds the link inside pasted text', () => {
  const pasted = `My Sembilan places https://sembilan.example/#places=${exportPlaces({ home: klcc, work: null, recents: [] })}`;
  assert.deepEqual(readPlaces(pasted)?.home, klcc);
});

test('importing replaces Home and Work and merges recents without duplicates', () => {
  const state = { home: null, work: klcc, recents: [klcc, midValley] };
  importPlaces(state, { home: midValley, work: null, recents: [pasarSeni, { ...midValley, name: 'Mid Valley' }] });
  assert.deepEqual(state.home, midValley);
  assert.deepEqual(state.work, klcc, 'a link without Work keeps the current one');
  assert.deepEqual(state.recents.map((p) => p.name), ['Pasar Seni — 中央艺术坊', 'Mid Valley', 'KLCC']);
});

test('rejects broken or empty links and drops invalid places', () => {
  assert.equal(readPlaces('just a search'), null);
  assert.equal(readPlaces('#places=not-base64-json'), null);
  assert.equal(readPlaces(`#places=${exportPlaces({ home: null, work: null, recents: [] })}`), null);
  const bad = readPlaces(`#places=${exportPlaces({ home: { name: 'Nowhere', lon: 999, lat: 3 }, work: klcc, recents: [{ name: 'x' }, midValley] })}`);
  assert.equal(bad.home, null);
  assert.deepEqual(bad.recents, [midValley]);
});
