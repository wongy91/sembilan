import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { browserOf, purge } from '../worker/index.js';
import { scrub } from '../public/src/text.js';
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
  assert.deepEqual(await (await call({}, '/api/health')).json(), { ok: true, traffic: false, reports: false, fares: true, search: false, places: false });
  const env = { TOMTOM_API_KEY: 'k', DB: createLocalD1() };
  assert.deepEqual(await (await call(env, '/api/health')).json(), { ok: true, traffic: true, reports: true, fares: true, search: true, places: false });
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

test('route proxy times a reference route and asks TomTom only for better alternatives', async () => {
  let seen;
  const reference = Array.from({ length: 1500 }, (_, i) => [+(101.712 - i * 0.0004).toFixed(5), +(3.1579 - i * 0.0003).toFixed(5)]);
  const res = await withFetch(
    async (url, init) => {
      seen = { url: new URL(url), init };
      return Response.json({ routes: [{ summary: { travelTimeInSeconds: 900 } }, { summary: { travelTimeInSeconds: 600 } }] });
    },
    () => call({ TOMTOM_API_KEY: 'k' }, '/api/route', { method: 'POST', body: { reference, avoidTolls: true } }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).routes.length, 2);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.url.pathname, `/routing/1/calculateRoute/3.1579,101.712:${reference.at(-1)[1]},${reference.at(-1)[0]}/json`);
  assert.equal(seen.url.searchParams.get('alternativeType'), 'betterRoute');
  assert.equal(seen.url.searchParams.get('maxAlternatives'), '1');
  assert.equal(seen.url.searchParams.get('traffic'), 'true');
  assert.deepEqual(seen.url.searchParams.getAll('avoid'), ['tollRoads']);
  const sent = JSON.parse(seen.init.body).supportingPoints;
  assert.equal(sent.length, 1500);
  assert.deepEqual(sent[1], { latitude: 3.1576, longitude: 101.7116 });
});

test('route proxy validates reference routes', async () => {
  const env = { TOMTOM_API_KEY: 'k' };
  const post = (reference) => call(env, '/api/route', { method: 'POST', body: { reference } });
  assert.equal((await post([[101.7, 3.1]])).status, 400, 'one point is not a route');
  assert.equal((await post(Array.from({ length: 2001 }, () => [101.7, 3.1]))).status, 400, 'too many points');
  assert.equal((await post([[101.7, 3.1], [-0.12, 51.5]])).status, 400, 'outside Malaysia');
  assert.equal((await post('nope')).status, 400);
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

const TOMTOM_SEARCH = {
  results: [
    {
      type: 'Point Address',
      address: { streetNumber: '31', streetName: 'Jalan BKD 44', municipalitySubdivision: 'Taman Bukit Katil Damai 2', municipality: 'Melaka', countrySubdivision: 'Melaka', freeformAddress: '31 Jalan BKD 44, Taman Bukit Katil Damai 2, 75450 Melaka' },
      position: { lat: 2.2195, lon: 102.2869 },
    },
    {
      type: 'POI',
      poi: { name: 'Petronas Taman Desa' },
      address: { streetName: 'Jalan Desa Utama', municipality: 'Kuala Lumpur', countrySubdivision: 'Kuala Lumpur' },
      position: { lat: 3.1012, lon: 101.6835 },
      entryPoints: [{ type: 'main', position: { lat: 3.1014, lon: 101.6838 } }],
    },
    { type: 'Geography', address: {}, position: {} },
  ],
};

test('search proxy builds a TomTom fuzzy search near the user, caches it and never echoes the key', async () => {
  const seen = [];
  const env = { TOMTOM_API_KEY: 'secret-key' };
  const fake = async (url) => {
    seen.push(new URL(url));
    return new Response(JSON.stringify(TOMTOM_SEARCH));
  };
  const path = '/api/search?q=No.31%20Jalan%20BKD%2044&lat=2.22&lon=102.28';
  const res = await withFetch(fake, () => call(env, path));
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes('secret-key'));
  assert.equal(seen[0].pathname, '/search/2/search/No.31%20Jalan%20BKD%2044.json');
  assert.equal(seen[0].searchParams.get('countrySet'), 'MY,SG');
  assert.equal(seen[0].searchParams.get('typeahead'), 'true');
  assert.equal(seen[0].searchParams.get('lat'), '2.22');
  const { results } = JSON.parse(text);
  assert.deepEqual(results[0], { name: '31 Jalan BKD 44', sub: 'Taman Bukit Katil Damai 2, Melaka', lon: 102.2869, lat: 2.2195 });
  assert.deepEqual(results[1], { name: 'Petronas Taman Desa', sub: 'Jalan Desa Utama, Kuala Lumpur', lon: 101.6838, lat: 3.1014 }, 'POIs route to their entrance');
  assert.equal(results.length, 2, 'results without a position are dropped');
  await withFetch(fake, () => call(env, path));
  assert.equal(seen.length, 1, 'the second identical search is served from cache');
});

test('nearby search asks TomTom for a category within 10 km', async () => {
  let seen;
  const res = await withFetch(
    async (url) => {
      seen = new URL(url);
      return new Response(JSON.stringify({ results: [] }));
    },
    () => call({ TOMTOM_API_KEY: 'k' }, '/api/search?cat=fuel&lat=3.1&lon=101.68'),
  );
  assert.equal(res.status, 200);
  assert.equal(seen.pathname, '/search/2/nearbySearch/.json');
  assert.equal(seen.searchParams.get('categorySet'), '7311');
  assert.equal(seen.searchParams.get('radius'), '10000');
});

test('search proxy validates input and needs a TomTom key', async () => {
  assert.equal((await call({}, '/api/search?q=klcc&lat=3.1&lon=101.7')).status, 501);
  const env = { TOMTOM_API_KEY: 'k' };
  assert.equal((await call(env, '/api/search?q=k&lat=3.1&lon=101.7')).status, 400);
  assert.equal((await call(env, '/api/search?q=klcc&lat=51.5&lon=-0.1')).status, 400);
  assert.equal((await call(env, '/api/search?cat=casino&lat=3.1&lon=101.7')).status, 400);
  const failed = await withFetch(async () => new Response('', { status: 500 }), () => call(env, '/api/search?q=jalan%20ampang&lat=3.1&lon=101.7'));
  assert.equal(failed.status, 502);
});

test('error reports drop coordinates, IP addresses and URL queries before they are logged', () => {
  assert.equal(
    scrub('Route failed at 3.15791,101.71234 via https://router.project-osrm.org/route/v1/driving/101.712,3.1579;101.09,4.59?overview=full#x'),
    'Route failed at #,# via https://router.project-osrm.org/route/v1/driving/#,#;#,#',
  );
  assert.equal(scrub('plan@https://sembilan.nav9.workers.dev/src/app.js:712:9'), 'plan@https://sembilan.nav9.workers.dev/src/app.js:712:9');
  assert.equal(scrub('blocked 203.0.113.7'), 'blocked #');
  assert.equal(scrub('x'.repeat(900)).length, 600);
});

test('error log: records a scrubbed report with a coarse browser name, never the raw user agent', async () => {
  const logged = [];
  const original = console.error;
  console.error = (entry) => logged.push(entry);
  try {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
    const res = await worker.fetch(
      new Request('https://sembilan.test/api/log', {
        method: 'POST',
        headers: { 'user-agent': ua },
        body: JSON.stringify({ message: 'Failed near 3.1579123', stack: 'at x (https://a.test/src/app.js:1:2)', release: '0.11.0', build: 'abc1234', mode: '<script>' }),
      }),
      {},
      ctx,
    );
    assert.equal(res.status, 204);
    assert.deepEqual(logged, [
      { event: 'client-error', message: 'Failed near #', stack: 'at x (https://a.test/src/app.js:1:2)', release: '0.11.0', build: 'abc1234', mode: '', browser: 'Safari 26 on iOS 26' },
    ]);
    assert.equal((await call({}, '/api/log', { method: 'POST', body: { message: '' } })).status, 400);
  } finally {
    console.error = original;
  }
});

test('coarse browser names for the error log', () => {
  const chromeAndroid = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
  const homeScreen = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  assert.equal(browserOf(chromeAndroid), 'Chrome 131 on Android 15');
  assert.equal(browserOf(edge), 'Edge 131 on Windows');
  assert.equal(browserOf(homeScreen), 'iOS 26');
  assert.equal(browserOf(''), 'other');
});

test('rate limits: each visitor gets its own budget per endpoint, and a spent budget answers 429', async () => {
  const keys = [];
  const limiter = (max) => {
    const counts = new Map();
    return {
      async limit({ key }) {
        keys.push(key);
        counts.set(key, (counts.get(key) || 0) + 1);
        return { success: counts.get(key) <= max };
      },
    };
  };
  const env = { TOMTOM_API_KEY: 'k', API_LIMIT: limiter(1), TILE_LIMIT: limiter(1) };
  const upstream = async (url) => (String(url).includes('/traffic/') ? new Response('png') : Response.json({ results: [], routes: [] }));
  const search = '/api/search?q=rate%20limit%20test&lat=3.1&lon=101.7';
  const route = { method: 'POST', body: { from: [101.712, 3.1579], to: [101.0901, 4.5975] } };
  await withFetch(upstream, async () => {
    assert.equal((await call(env, search)).status, 200);
    assert.equal((await call(env, search)).status, 429);
    assert.equal((await call(env, search, { ip: '10.0.0.2' })).status, 200, 'another visitor is not affected');
    assert.equal((await call(env, '/api/route', route)).status, 200, 'routing has its own budget');
    assert.equal((await call(env, '/api/traffic/10/806/494.png')).status, 200);
    assert.equal((await call(env, '/api/traffic/10/806/494.png')).status, 429);
    assert.equal((await call(env, '/api/health')).status, 200, 'health is never limited');
  });
  assert.deepEqual(keys, ['search:10.0.0.1', 'search:10.0.0.1', 'search:10.0.0.2', 'route:10.0.0.1', 'tile:10.0.0.1', 'tile:10.0.0.1']);
});

test('non-API paths go to static assets', async () => {
  const env = { ASSETS: { fetch: async () => new Response('index') } };
  assert.equal(await (await worker.fetch(new Request('https://sembilan.test/'), env, ctx)).text(), 'index');
  assert.equal((await call({}, '/api/nope')).status, 404);
});
