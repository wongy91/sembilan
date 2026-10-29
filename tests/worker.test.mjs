import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { purge } from '../worker/index.js';
import { createLocalD1 } from '../scripts/d1-local.mjs';

const ctx = { waitUntil() {} };
const KLCC = { lon: 101.712, lat: 3.1579 };

function call(env, path, { method = 'GET', body, ip = '10.0.0.1' } = {}) {
  const init = { method, headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return worker.fetch(new Request(`https://sembilan.test${path}`, init), env, ctx);
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('health reports which optional features are configured', async () => {
  assert.deepEqual(await (await call({}, '/api/health')).json(), { ok: true, traffic: false, reports: false, fares: true });
  const env = { TOMTOM_API_KEY: 'k', DB: createLocalD1() };
  assert.deepEqual(await (await call(env, '/api/health')).json(), { ok: true, traffic: true, reports: true, fares: true });
});

test('route proxy is disabled without a TomTom key', async () => {
  const res = await call({}, '/api/route', { method: 'POST', body: { from: [101.71, 3.15], to: [101.09, 4.59] } });
  assert.equal(res.status, 501);
});

test('route proxy builds a traffic-aware TomTom request and never echoes the key', async () => {
  let seen;
  const res = await withFetch(
    async (url) => {
      seen = new URL(url);
      return Response.json({ formatVersion: '0.0.12', routes: [{ summary: { lengthInMeters: 1 } }] });
    },
    () =>
      call({ TOMTOM_API_KEY: 'secret-key' }, '/api/route', {
        method: 'POST',
        body: { from: [101.712, 3.1579], to: [101.0901, 4.5975], avoidTolls: true, heading: 370 },
      }),
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('secret-key'));
  assert.deepEqual(JSON.parse(text), { routes: [{ summary: { lengthInMeters: 1 } }] });
  assert.equal(seen.pathname, '/routing/1/calculateRoute/3.1579,101.712:4.5975,101.0901/json');
  assert.equal(seen.searchParams.get('traffic'), 'true');
  assert.equal(seen.searchParams.get('maxAlternatives'), '2');
  assert.deepEqual(seen.searchParams.getAll('sectionType'), ['tollRoad', 'traffic', 'motorway', 'speedLimit']);
  assert.deepEqual(seen.searchParams.getAll('avoid'), ['tollRoads']);
  assert.equal(seen.searchParams.get('vehicleHeading'), '10');
});

test('route proxy rejects points outside Malaysia and upstream failures', async () => {
  const env = { TOMTOM_API_KEY: 'k' };
  const outside = await call(env, '/api/route', { method: 'POST', body: { from: [2.35, 48.85], to: [101.09, 4.59] } });
  assert.equal(outside.status, 400);
  const failed = await withFetch(
    async () => new Response('nope', { status: 403 }),
    () => call(env, '/api/route', { method: 'POST', body: { from: [101.71, 3.15], to: [101.09, 4.59] } }),
  );
  assert.equal(failed.status, 502);
});

test('community reports: create, list, merge duplicates, vote away', async () => {
  const env = { DB: createLocalD1(), REPORT_SALT: 'test' };
  const created = await call(env, '/api/reports', { method: 'POST', body: { kind: 'accident', ...KLCC, heading: 90 } });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const list = await (await call(env, '/api/reports?bbox=101.6,3.1,101.8,3.2')).json();
  assert.equal(list.reports.length, 1);
  assert.equal(list.reports[0].id, id);
  assert.equal(list.reports[0].kind, 'accident');
  assert.equal(list.reports[0].reporter, undefined, 'reporter fingerprint stays private');

  const merged = await (await call(env, '/api/reports', { method: 'POST', ip: '10.0.0.2', body: { kind: 'accident', lon: KLCC.lon + 0.0005, lat: KLCC.lat } })).json();
  assert.equal(merged.id, id);
  assert.equal(merged.merged, true);
  assert.equal(merged.up, 1);

  const again = await (await call(env, '/api/reports', { method: 'POST', ip: '10.0.0.2', body: { kind: 'accident', ...KLCC } })).json();
  assert.deepEqual(again, { id, merged: true });

  const first = await (await call(env, `/api/reports/${id}/vote`, { method: 'POST', ip: '10.0.0.3', body: { up: false } })).json();
  assert.equal(first.removed, false);
  const dupVote = await call(env, `/api/reports/${id}/vote`, { method: 'POST', ip: '10.0.0.3', body: { up: false } });
  assert.equal(dupVote.status, 409);
  const second = await (await call(env, `/api/reports/${id}/vote`, { method: 'POST', ip: '10.0.0.4', body: { up: false } })).json();
  assert.equal(second.removed, true);
  assert.equal((await (await call(env, '/api/reports?bbox=101.6,3.1,101.8,3.2')).json()).reports.length, 0);
});

test('community reports: validation and per-reporter rate limit', async () => {
  const env = { DB: createLocalD1() };
  assert.equal((await call(env, '/api/reports', { method: 'POST', body: { kind: 'ufo', ...KLCC } })).status, 400);
  assert.equal((await call(env, '/api/reports', { method: 'POST', body: { kind: 'police', lon: 139.7, lat: 35.7 } })).status, 400);
  assert.equal((await call(env, '/api/reports?bbox=90,0,110,10')).status, 400);
  for (let i = 0; i < 10; i++) {
    const res = await call(env, '/api/reports', { method: 'POST', body: { kind: 'pothole', lon: 101.5 + i * 0.01, lat: 3.1 } });
    assert.equal(res.status, 201);
  }
  const limited = await call(env, '/api/reports', { method: 'POST', body: { kind: 'pothole', lon: 101.0, lat: 3.1 } });
  assert.equal(limited.status, 429);
  const other = await call(env, '/api/reports', { method: 'POST', ip: '10.9.9.9', body: { kind: 'pothole', lon: 101.0, lat: 3.1 } });
  assert.equal(other.status, 201);
});

test('purge drops reports that expired more than a day ago', async () => {
  const db = createLocalD1();
  const env = { DB: db };
  await call(env, '/api/reports', { method: 'POST', body: { kind: 'jam', ...KLCC } });
  await purge(db, Date.now());
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 1);
  await purge(db, Date.now() + 3 * 86400000);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM votes').get().n, 0);
});

test('PLUS fares: batches pairs, parses plain-text amounts, treats empty and failed lookups as null', async () => {
  const seen = [];
  const upstream = async (url) => {
    seen.push(new URL(url).pathname);
    if (url.includes('/JLD/SPP/')) return new Response('20.34', { headers: { 'content-type': 'text/plain' } });
    if (url.includes('/JLD/JLD/')) return new Response('');
    return new Response('boom', { status: 500 });
  };
  const res = await withFetch(upstream, () => call({}, '/api/fares', { method: 'POST', body: { pairs: [['JLD', 'SPP'], ['JLD', 'JLD'], ['QQQ', 'ZZZ']] } }));
  const data = await res.json();
  assert.deepEqual(data.fares, [20.34, null, null]);
  assert.equal(data.failed, 1);
  assert.equal(data.vehicleClass, 1);
  assert.deepEqual(seen, ['/api/tolls/GetTollFare/JLD/SPP/1', '/api/tolls/GetTollFare/JLD/JLD/1', '/api/tolls/GetTollFare/QQQ/ZZZ/1']);
});

test('PLUS fares: cached per pair, so repeat lookups do not hit PLUS again', async () => {
  let calls = 0;
  const upstream = async () => {
    calls++;
    return new Response('5.74');
  };
  for (let i = 0; i < 3; i++) {
    const data = await (await withFetch(upstream, () => call({}, '/api/fares', { method: 'POST', body: { pairs: [['JPP', 'JPP']] } }))).json();
    assert.deepEqual(data.fares, [5.74]);
  }
  assert.equal(calls, 1);
});

test('PLUS fares: rejects malformed requests before calling PLUS', async () => {
  const bad = [{ pairs: [] }, { pairs: [['jld', 'SPP']] }, { pairs: [['JLD']] }, { pairs: Array(13).fill(['JLD', 'SPP']) }, {}];
  await withFetch(
    async () => assert.fail('PLUS must not be called'),
    async () => {
      for (const body of bad) assert.equal((await call({}, '/api/fares', { method: 'POST', body })).status, 400);
    },
  );
});

test('non-API paths go to static assets', async () => {
  const env = { ASSETS: { fetch: async () => new Response('index') } };
  assert.equal(await (await worker.fetch(new Request('https://sembilan.test/'), env, ctx)).text(), 'index');
  assert.equal((await call({}, '/api/nope')).status, 404);
});
