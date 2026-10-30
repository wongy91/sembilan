import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detourTimes, planRoutes } from '../public/src/routing.js';
import { fromValhalla } from '../public/src/providers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const KUCHAI = [101.6845, 3.0905];
const KLCC = [101.7123, 3.1579];

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return handler(String(url));
  };
  try {
    return { result: await fn().catch((err) => err), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const valhallaOk = () => new Response(fixture('valhalla_klcc_midvalley.json'));
const fail = () => new Response('', { status: 500 });

test('motorcycle routes come from Valhalla with the motorcycle profile, never from TomTom', async () => {
  const { result, calls } = await withFetch(valhallaOk, () => planRoutes(KUCHAI, KLCC, { motorcycle: true, liveTraffic: true, avoidTolls: true }));
  assert.ok(Array.isArray(result) && result.length >= 1);
  assert.deepEqual(calls.map((c) => new URL(c.url, 'https://x').pathname), ['/route']);
  assert.equal(calls[0].body.costing, 'motorcycle');
  assert.deepEqual(calls[0].body.costing_options, { motorcycle: { use_tolls: 0, use_highways: 1 } });
});

test('a motorcycle trip does not fall back to OSRM, whose demo server only knows car rules', async () => {
  const { result, calls } = await withFetch(fail, () => planRoutes(KUCHAI, KLCC, { motorcycle: true }));
  assert.ok(result instanceof Error);
  assert.equal(calls.length, 1);
  const car = await withFetch(fail, () => planRoutes(KUCHAI, KLCC, {}));
  assert.ok(car.calls.some((c) => c.url.includes('router.project-osrm.org')), 'cars still fall back to OSRM');
});

test('petrol detours for a motorcycle use the motorcycle profile', async () => {
  const [route] = fromValhalla(JSON.parse(fixture('valhalla_klcc_midvalley.json')));
  const cell = (time) => ({ time });
  const { calls } = await withFetch(
    () => new Response(JSON.stringify({ sources_to_targets: [[cell(60), cell(120)]] })),
    () => detourTimes(KUCHAI, [{ lon: 101.7, lat: 3.13, along: 1000 }], route, { motorcycle: true }),
  );
  assert.ok(calls.length === 2 && calls.every((c) => c.body.costing === 'motorcycle'));
});
