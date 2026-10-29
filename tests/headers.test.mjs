import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { headersFor, parseHeaders } from '../scripts/headers.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rules = parseHeaders(read('public/_headers'));
const LINK_ONLY = new Set(['https://github.com', 'https://waze.com', 'https://www.google.com', 'https://sembilan.nav9.workers.dev']);

function policy(path) {
  const header = headersFor(rules, path)['Content-Security-Policy'];
  return Object.fromEntries(header.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
}

test('every static file gets the security headers', () => {
  for (const path of ['/', '/index.html', '/src/app.js', '/sw.js', '/data/places/index.json']) {
    const headers = headersFor(rules, path);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.match(headers['Permissions-Policy'], /geolocation=\(self\)/);
    assert.deepEqual(policy(path)['frame-ancestors'], ["'none'"]);
  }
});

test('the content security policy allows every host the app fetches from', () => {
  const files = [
    ...readdirSync(new URL('../public/src/', import.meta.url)).map((f) => `public/src/${f}`),
    'public/index.html',
    'scripts/sw.template.js',
  ];
  const origins = new Set(files.flatMap((f) => [...read(f).matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0])));
  const csp = policy('/');
  for (const origin of origins) {
    if (!LINK_ONLY.has(origin)) assert.ok(csp['connect-src'].includes(origin), `${origin} is used by the app but missing from connect-src`);
  }
  assert.ok(csp['script-src'].includes('https://cdn.jsdelivr.net'), 'MapLibre is loaded from jsDelivr');
  assert.ok(csp['worker-src'].includes('blob:'), 'MapLibre starts its workers from blob: URLs');
  assert.ok(!csp['script-src'].includes("'unsafe-inline'") && !csp['script-src'].includes("'unsafe-eval'"));
});
