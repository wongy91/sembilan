import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAddressLike, mergePlaces, nearbyPlaces, searchPlaces } from '../public/src/search.js';

const NEAR = [101.6806, 3.0905];
const photon = (names) => ({ features: names.map((name, i) => ({ properties: { name, city: 'Kuala Lumpur' }, geometry: { coordinates: [101.68 + i / 100, 3.09] } })) });

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init);
  };
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('spots address-like queries', () => {
  for (const q of ['No.31 Jalan BKD 44', 'jln ampang', 'Taman Desa', 'Lot 5', '75450 Melaka']) assert.ok(isAddressLike(q), q);
  for (const q of ['KLCC', 'Mid Valley', 'Genting Highlands']) assert.ok(!isAddressLike(q), q);
});

test('address queries ask TomTom and Photon together and put TomTom first', async () => {
  const { result, calls } = await withFetch(
    (url) => (url.startsWith('/api/search') ? json({ results: [{ name: '31 Jalan BKD 44', sub: 'Melaka', lon: 102.2869, lat: 2.2195 }] }) : json(photon(['Jalan BKD 44']))),
    () => searchPlaces('No.31 Jalan BKD 44', { near: NEAR, tomtom: true }),
  );
  assert.equal(calls.length, 2);
  assert.equal(result[0].name, '31 Jalan BKD 44');
  assert.ok(result.every((p) => Number.isFinite(p.dist)), 'every result carries a distance');
});

test('place names use Photon alone when it finds enough, and TomTom only as a fallback', async () => {
  const enough = await withFetch(() => json(photon(['KLCC', 'KLCC Park', 'Suria KLCC'])), () => searchPlaces('KLCC', { near: NEAR, tomtom: true }));
  assert.deepEqual(enough.calls.filter((u) => u.startsWith('/api/search')), []);
  const few = await withFetch(
    (url) => (url.startsWith('/api/search') ? json({ results: [{ name: 'Zus Coffee Old Klang Road', sub: '', lon: 101.67, lat: 3.09 }] }) : json(photon([]))),
    () => searchPlaces('zus coffee', { near: NEAR, tomtom: true }),
  );
  assert.equal(few.result[0].name, 'Zus Coffee Old Klang Road');
  const offline = await withFetch(() => json(photon(['A'])), () => searchPlaces('zus coffee', { near: NEAR, tomtom: false }));
  assert.ok(offline.calls.every((u) => !u.startsWith('/api/search')), 'no Worker calls without a TomTom key');
});

test('falls back to TomTom when Photon is down, and still reports failure when both are', async () => {
  const down = await withFetch(
    (url) => (url.startsWith('/api/search') ? json({ results: [{ name: 'Mid Valley Megamall', sub: '', lon: 101.6776, lat: 3.1178 }] }) : json({}, 503)),
    () => searchPlaces('mid valley', { near: NEAR, tomtom: true }),
  );
  assert.equal(down.result[0].name, 'Mid Valley Megamall');
  await assert.rejects(withFetch(() => json({}, 503), () => searchPlaces('mid valley', { near: NEAR, tomtom: true })).then((r) => r.result));
});

test('merges duplicates from both sources', () => {
  const a = [{ name: 'Mid Valley Megamall', lon: 101.6776, lat: 3.1178 }];
  const b = [{ name: 'mid valley megamall', lon: 101.6779, lat: 3.118 }, { name: 'The Gardens Mall', lon: 101.6768, lat: 3.1186 }];
  assert.deepEqual(mergePlaces(a, b).map((p) => p.name), ['Mid Valley Megamall', 'The Gardens Mall']);
});

test('nearby: TomTom results sorted by distance, Photon with a category filter when there is no key', async () => {
  const tomtom = await withFetch(
    () => json({ results: [{ name: 'Far', sub: '', lon: 101.75, lat: 3.09 }, { name: 'Near', sub: '', lon: 101.681, lat: 3.091 }] }),
    () => nearbyPlaces('fuel', { near: NEAR, tomtom: true }),
  );
  assert.deepEqual(tomtom.result.map((p) => p.name), ['Near', 'Far']);
  const feature = (name, lon, lat) => ({ properties: { name, osm_value: 'parking', city: 'Kuala Lumpur' }, geometry: { coordinates: [lon, lat] } });
  const osm = await withFetch(
    () => json({ features: [feature('Galeria Pantai', 101.69, 3.09), feature(undefined, 101.681, 3.0905), feature('Too far', 102.5, 3.09)] }),
    () => nearbyPlaces('parking', { near: NEAR, tomtom: false, label: 'Parking' }),
  );
  const url = new URL(osm.calls[0]);
  assert.equal(url.host, 'photon.komoot.io');
  assert.equal(url.searchParams.get('osm_tag'), 'amenity:parking');
  assert.deepEqual(osm.result.map((p) => p.name), ['Parking', 'Galeria Pantai'], 'unnamed places get the category label; places over 30 km are dropped');
});

test('places that match every word come first: OpenStreetMap, then Overture, then partial matches', async () => {
  const { result } = await withFetch(
    (url) =>
      url.startsWith('/api/places')
        ? json({ results: [{ name: 'Signature Ayu Borneo @ Bloomsvale', sub: 'Petaling', category: 'wellness_service', lon: 101.6606, lat: 3.0759 }, { name: 'Mid Valley Carpark', sub: '', category: 'parking', lon: 101.677, lat: 3.118 }] })
        : json(photon(['Ayu Borneo', 'Ayu Borneo Sepang'])),
    () => searchPlaces('signature ayu borneo', { near: NEAR, places: true }),
  );
  assert.equal(result[0].name, 'Signature Ayu Borneo @ Bloomsvale', 'the only full match leads');
  assert.equal(result[0].sub, 'Petaling · Wellness service');
  assert.deepEqual(result.slice(1, 3).map((p) => p.name), ['Ayu Borneo', 'Ayu Borneo Sepang']);
  const landmark = await withFetch(
    (url) => (url.startsWith('/api/places') ? json({ results: [{ name: 'Mid Valley Carpark', sub: '', category: 'parking', lon: 101.677, lat: 3.118 }] }) : json(photon(['Mid Valley Megamall']))),
    () => searchPlaces('mid valley', { near: NEAR, places: true }),
  );
  assert.deepEqual(landmark.result.map((p) => p.name), ['Mid Valley Megamall', 'Mid Valley Carpark'], 'OpenStreetMap landmarks stay above Overture businesses');
});
