import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachFares, canonicalPlaza, fareGroups, fareKeys, pairKey, plusCodeFor, plusIndex, priceRoute } from '../public/src/fares.js';
import { fromValhalla } from '../public/src/providers.js';
import { alertText, poisAlongRoute } from '../public/src/pois.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const plus = read('../public/data/plus-plazas.json');
const pois = read('../public/data/pois.json');
const index = plusIndex(plus.plazas);
const code = (name, extra = {}) => plusCodeFor({ name, ...extra }, index);

test('maps OSM toll plaza names to PLUS plaza codes', () => {
  assert.equal(canonicalPlaza('Plaza Tol Jambatan Pulau Pinang (A)'), canonicalPlaza('Penang Bridge'));
  assert.equal(code('Plaza Tol Jalan Duta'), 'JLD');
  assert.equal(code('Plaza Tol Jambatan Pulau Pinang (A)'), 'JPP');
  assert.equal(code('Plaza Tol Putra Heights'), 'PHT');
  assert.equal(code('Tol Bangunan Sultan Iskandar'), 'BSI');
  assert.equal(code('Plaza Tol Hutan Kampung'), 'HKG');
  assert.equal(code('Plaza Tol Sungai Petani Selatan', { operator: 'Projek Lebuhraya Utara Selatan' }), 'SPS');
  assert.equal(code('Plaza Tol Ipoh Utara'), 'IPU');
  assert.equal(code('x', { nameEn: 'Jalan Duta Toll Plaza' }), 'JLD');
});

test('does not map other operators or look-alike names', () => {
  assert.equal(code('Plaza Toll SMART Sungai Besi'), null);
  assert.equal(code('Plaza Tol Batu'), null);
  assert.equal(code('Plaza Tol Kajang', { operator: 'Grand Saga Sdn Bhd' }), null);
  assert.equal(code('Plaza Toll PLUS Port Dickson (N)'), null);
});

test('prices KL to Ipoh as one PLUS closed-system trip and counts DUKE as another operator', () => {
  const [route] = fromValhalla(read('./fixtures/valhalla_kl_ipoh.json'));
  const found = poisAlongRoute(route, pois);
  const groups = fareGroups(route, found);
  assert.deepEqual(groups.map(pairKey), ['JLD/SPP']);
  const fares = new Map([['JLD/SPP', 20.34]]);
  const price = priceRoute(groups, fares, found);
  assert.deepEqual({ total: price.total, priced: price.priced, missing: price.missing, other: price.other }, { total: 20.34, priced: 1, missing: 0, other: 1 });
  attachFares(price, fares);
  assert.equal(found.find((p) => p.plus === 'SPP').fare, 20.34);
  assert.equal(found.find((p) => p.plus === 'JLD').fare, undefined, 'the closed-system entry is not charged');
});

test('prices KL to Penang Island via the second bridge as Jalan Duta to Bandar Cassia', () => {
  const [route] = fromValhalla(read('./fixtures/valhalla_kl_penang.json'));
  const found = poisAlongRoute(route, pois);
  assert.deepEqual(fareGroups(route, found).map(pairKey), ['JLD/BCS']);
});

test('splits PLUS runs at other operators and where the route leaves the expressways', () => {
  const route = {
    steps: [
      { along: 0, length: 3000, toll: true, highway: true },
      { along: 3000, length: 6000, toll: false, highway: false },
      { along: 9000, length: 21000, toll: true, highway: true },
    ],
  };
  const toll = (along, plus) => ({ kind: 'toll', along, plus, name: plus || 'Other' });
  const list = [toll(1000, 'JLD'), toll(10000, 'JRU'), toll(15000, null), toll(20000, 'BKR'), toll(25000, 'JPP'), toll(25200, 'JPP')];
  const groups = fareGroups(route, list);
  assert.deepEqual(groups.map(pairKey), ['JLD/JLD', 'JRU/JRU', 'BKR/JPP']);
  assert.equal(groups[2].plazas.length, 2, 'repeated booths of one plaza collapse');
  const price = priceRoute(groups, new Map([['BKR/JPP', 7.5]]), list);
  assert.deepEqual({ total: price.total, priced: price.priced, missing: price.missing, other: price.other }, { total: 7.5, priced: 1, missing: 2, other: 1 });
});

test('splits a multi-plaza fare per plaza only when the legs add up to the whole trip', () => {
  const route = { steps: [{ along: 0, length: 400000, toll: true, highway: true }] };
  const run = () => [
    { kind: 'toll', along: 12000, plus: 'JLD' },
    { kind: 'toll', along: 330000, plus: 'JRU' },
    { kind: 'toll', along: 340000, plus: 'JPP' },
  ];
  const groups = fareGroups(route, run());
  assert.deepEqual(fareKeys(groups), ['JLD/JPP', 'JLD/JRU', 'JRU/JPP']);

  const consistent = run();
  const fares = new Map([['JLD/JPP', 41.25], ['JLD/JRU', 35.51], ['JRU/JPP', 5.74]]);
  const price = priceRoute(fareGroups(route, consistent), fares, consistent);
  attachFares(price, fares);
  assert.equal(price.total, 41.25);
  assert.deepEqual(consistent.map((p) => p.fare), [undefined, 35.51, 5.74]);

  const inconsistent = run();
  const odd = new Map([['JLD/JPP', 41.25], ['JLD/JRU', 35.51], ['JRU/JPP', 9.99]]);
  attachFares(priceRoute(fareGroups(route, inconsistent), odd, inconsistent), odd);
  assert.deepEqual(inconsistent.map((p) => p.fare), [undefined, undefined, undefined]);
});

test('speaks the fare when approaching the plaza where it is paid', () => {
  const poi = { kind: 'toll', name: 'Plaza Tol Simpang Pulai', nameEn: 'Simpang Pulai Toll Plaza', fare: 20.34 };
  assert.equal(alertText(poi, 1000, 'ms'), 'Plaza Tol Simpang Pulai dalam 1 kilometer, tol 20 ringgit 34 sen');
  assert.equal(alertText({ ...poi, fare: 5 }, 600, 'en'), 'Simpang Pulai Toll Plaza in 600 meters, toll 5 ringgit');
  assert.equal(alertText({ ...poi, fare: undefined }, 600, 'ms'), 'Plaza Tol Simpang Pulai dalam 600 meter');
});
