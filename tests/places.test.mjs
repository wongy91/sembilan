import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, chunksFor, searchIndex } from '../worker/places.js';
import { tokenize } from '../public/src/text.js';
import worker from '../worker/index.js';

const BLOOMSVALE = [101.6606, 3.0759];
const PLACES = [
  { name: 'Signature Ayu Borneo @ Bloomsvale', locality: 'Petaling', category: 'wellness_service', lon: 101.66064, lat: 3.07589 },
  { name: 'Ayu Borneo', locality: 'Sepang', category: 'massage', lon: 101.7, lat: 2.8 },
  { name: 'Bloomsvale Shopping Gallery', locality: 'Kuala Lumpur', category: 'shopping_mall', lon: 101.6606, lat: 3.0759 },
  { name: "McDonald's Kuchai Lama DT", locality: 'Kuala Lumpur', category: 'fast_food_restaurant', lon: 101.686, lat: 3.09 },
  { name: "McDonald's Melaka", locality: 'Melaka', category: 'fast_food_restaurant', lon: 102.25, lat: 2.19 },
  { name: 'ZUS Coffee', locality: 'Cheras', category: 'cafe', lon: 101.74, lat: 3.08 },
  { name: 'ZUS Coffee', locality: 'Bangsar', category: 'cafe', lon: 101.67, lat: 3.13 },
  { name: 'Bubble Gum Wax', locality: 'Petaling', category: 'beauty_salon', street: 'No 1-21, Residensi Park, Persiaran Jalil Utama', lon: 101.67312, lat: 3.05233 },
  { name: 'Bubble Gum Wax', locality: 'Kuala Lumpur', category: 'beauty_salon', street: '54, Jalan Maarof, Kuala Lumpur', lon: 101.67232, lat: 3.13211 },
  { name: 'Cheras Leisure Mall', locality: 'Cheras', category: 'shopping_mall', lon: 101.745, lat: 3.085 },
  { name: 'Kedai Kopi Cheras', locality: 'Cheras', category: 'cafe', lon: 101.746, lat: 3.086 },
  { name: 'Kedai Runcit Ali', locality: 'Kajang', category: 'grocery', lon: 101.79, lat: 2.99 },
];

function index(chunkSize = 2, stop = 100) {
  const { manifest, chunks } = buildIndex(PLACES, chunkSize, stop);
  return { manifest, load: async (i) => chunks[i] };
}

test('tokenizes names the way people type them', () => {
  assert.deepEqual(tokenize('Signature Ayu Borneo @ Bloomsvale'), ['signature', 'ayu', 'borneo', 'bloomsvale']);
  assert.deepEqual(tokenize("McDonald's"), ['mcdonalds']);
  assert.deepEqual(tokenize('Café Ñandú'), ['cafe', 'nandu']);
  assert.deepEqual(tokenize('Kopi Street 咖啡街'), ['kopi', 'street', '咖啡街']);
});

test('finds a place by its full name, punctuation and all', async () => {
  const { manifest, load } = index();
  const [top] = await searchIndex(manifest, load, 'signature ayu borneo @ bloomsvale', [101.68, 3.09]);
  assert.equal(top.name, 'Signature Ayu Borneo @ Bloomsvale');
  assert.equal(top.category, 'wellness_service');
  assert.equal(top.sub, 'Petaling');
});

test('matches word prefixes across chunk boundaries and ranks nearer places first', async () => {
  const { manifest, load } = index(1);
  assert.ok(chunksFor(manifest, 'mcdonalds').length >= 2, 'the two McDonalds rows sit in different one-row chunks');
  const names = (await searchIndex(manifest, load, 'mcdon', [101.68, 3.09])).map((p) => p.name);
  assert.deepEqual(names, ["McDonald's Kuchai Lama DT", "McDonald's Melaka"]);
});

test('uses the area name to filter, picking the rarest word to look up', async () => {
  const { manifest, load } = index();
  const results = await searchIndex(manifest, load, 'zus coffee cheras', BLOOMSVALE);
  assert.deepEqual(results.map((p) => p.sub), ['Cheras'], 'only the Cheras branch, matched through its locality');
});

test('names that start with the query rank above names that merely contain it', async () => {
  const { manifest, load } = index();
  const names = (await searchIndex(manifest, load, 'ayu borneo', BLOOMSVALE)).map((p) => p.name);
  assert.deepEqual(names, ['Ayu Borneo', 'Signature Ayu Borneo @ Bloomsvale']);
});

test('very common words are not indexed but still filter', async () => {
  const { manifest, load } = index(2, 1);
  assert.ok(manifest.stop.includes('kedai'));
  assert.deepEqual(await searchIndex(manifest, load, 'kedai', BLOOMSVALE), []);
  assert.deepEqual((await searchIndex(manifest, load, 'kedai runcit', BLOOMSVALE)).map((p) => p.name), ['Kedai Runcit Ali']);
});

test('the Worker serves /api/places from the static index', async () => {
  const { manifest, chunks } = buildIndex(PLACES, 2, 100);
  const files = { '/data/places/index.json': manifest, ...Object.fromEntries(chunks.map((c, i) => [`/data/places/${i}.json`, c])) };
  const env = { ASSETS: { fetch: async (req) => (files[new URL(req.url).pathname] ? new Response(JSON.stringify(files[new URL(req.url).pathname])) : new Response('', { status: 404 })) } };
  const call = (path) => worker.fetch(new Request(`https://sembilan.test${path}`), env, { waitUntil() {} });
  const res = await call('/api/places?q=signature%20ayu%20borneo%20%40%20bloomsvale&lat=3.09&lon=101.68');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).results[0].name, 'Signature Ayu Borneo @ Bloomsvale');
  assert.equal((await call('/api/health').then((r) => r.json())).places, true);
  assert.equal((await call('/api/places?q=x&lat=3.09&lon=101.68')).status, 400);
  assert.equal((await call('/api/places?q=klcc&lat=51.5&lon=-0.1')).status, 400);
});

test('a branch shows its street, so branches with the same name can be told apart', async () => {
  const { manifest, load } = index();
  const results = await searchIndex(manifest, load, 'bubble gum wax', BLOOMSVALE);
  assert.deepEqual(
    results.map((p) => [p.sub, p.category]),
    [
      ['No 1-21, Residensi Park, Persiaran Jalil Utama, Petaling', ''],
      ['54, Jalan Maarof, Kuala Lumpur', ''],
    ],
    'nearest first; the town is not repeated when the street already names it; no category next to a street',
  );
});
