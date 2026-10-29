import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, fmtClock, fmtDistance, fmtDuration, tr } from '../public/src/i18n.js';
import { chain, instruction, spokenDistance, withDistance } from '../public/src/instructions.js';
import { alertText, poisAlongRoute } from '../public/src/pois.js';
import { bearing, pointAt } from '../public/src/geo.js';
import { fromValhalla } from '../public/src/providers.js';
import { Navigator } from '../public/src/navigator.js';
import { deviceLang } from '../public/src/store.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const HAN = /\p{Script=Han}/u;

test('Chinese, Malay and English have the same keys and the same {placeholders}', () => {
  const keys = Object.keys(STRINGS.en).sort();
  for (const lang of ['ms', 'zh']) {
    assert.deepEqual(Object.keys(STRINGS[lang]).sort(), keys, `${lang} keys`);
    for (const key of keys) assert.deepEqual(placeholders(STRINGS[lang][key]), placeholders(STRINGS.en[key]), `${lang}.${key}`);
  }
});

test('Chinese turn-by-turn phrases keep Malaysian road names', () => {
  assert.equal(instruction({ kind: 'turn', modifier: 'left', names: ['Jalan Tun Razak'] }, 'zh'), '左转，进入 Jalan Tun Razak');
  assert.equal(instruction({ kind: 'roundabout', roundaboutExit: 3 }, 'zh'), '在环岛从第三个出口驶出');
  assert.equal(instruction({ kind: 'exit', exitNumber: '137', toward: ['Simpang Pulai'] }, 'zh', { spoken: true }), '从 137 号出口驶出，前往 Simpang Pulai');
  assert.equal(instruction({ kind: 'arrive', side: 'right' }, 'zh'), '目的地在右侧');
  assert.equal(instruction({ kind: 'depart', bearingAfter: 90 }, 'zh'), '向东出发');
  assert.equal(withDistance('左转', 500, 'zh'), '500米后，左转');
  assert.equal(withDistance('右转', 2000, 'zh'), '2公里后，右转');
  assert.equal(spokenDistance(1500, 'zh'), '1.5公里');
  assert.equal(chain('左转', '右转', 'zh'), '左转，然后右转');
  assert.equal(tr('zh', 'voiceTest'), withDistance(instruction({ kind: 'turn', modifier: 'left', names: ['Jalan Tun Razak'] }, 'zh'), 500, 'zh'));
});

test('Chinese alerts, distances, durations and clock', () => {
  assert.equal(alertText({ kind: 'camera', maxspeed: 90 }, 800, 'zh'), '前方800米有测速相机，限速90');
  assert.equal(alertText({ kind: 'toll', name: 'Plaza Tol Sungai Besi', fare: 1.6 }, 1000, 'zh'), '前方1公里是 Plaza Tol Sungai Besi, 过路费1令吉60仙');
  assert.equal(fmtDistance(450, 'zh'), '450 米');
  assert.equal(fmtDistance(12400, 'zh'), '12 公里');
  assert.equal(fmtDistance(12400, 'en'), '12 km');
  assert.equal(fmtDuration(75 * 60, 'zh'), '1 小时 15 分钟');
  assert.match(fmtClock(new Date(2026, 9, 29, 18, 40), 'zh'), /^下午\s?6:40$/);
  assert.match(fmtClock(new Date(2026, 9, 29, 18, 40), 'en'), /^6:40\s?pm$/i);
});

test('a whole drive is spoken in Chinese, never falling back to Malay', () => {
  const [route] = fromValhalla(fixture('valhalla_putrajaya.json'));
  const nav = new Navigator(route, { lang: 'zh', pois: poisAlongRoute(route, { toll: [], camera: [], rr: [] }) });
  const texts = [];
  let along = 0;
  for (let t = 0; t < 5000; t++) {
    along = Math.min(route.distance, along + 12);
    const p = pointAt(route.coords, route.cum, along);
    const out = nav.update({ lon: p[0], lat: p[1], accuracy: 5, speed: 12, heading: bearing(p, pointAt(route.coords, route.cum, Math.min(route.distance, along + 8))), time: t * 1000 });
    texts.push(...out.speech.map((s) => s.text));
    if (out.arrived) break;
  }
  assert.ok(texts.length > 5, texts.join('\n'));
  assert.equal(texts[0], '向东北出发');
  assert.ok(texts.some((x) => x.includes('在环岛从第三个出口驶出')), texts.join('\n'));
  assert.equal(texts.at(-1), '您已到达目的地');
  for (const text of texts) {
    assert.ok(HAN.test(text), `not Chinese: ${text}`);
    assert.ok(!/\b(belok|bulatan|kemudian|Menuju|meter)\b/i.test(text), `Malay leaked: ${text}`);
  }
});

test("a first visit starts in the phone's language when Sembilan speaks it", () => {
  assert.equal(deviceLang(['zh-MY', 'en-MY']), 'zh');
  assert.equal(deviceLang(['zh-Hant-TW']), 'zh');
  assert.equal(deviceLang(['ms-MY']), 'ms');
  assert.equal(deviceLang(['fr-FR', 'en-GB']), 'en');
  assert.equal(deviceLang(['ja-JP']), 'en');
  assert.equal(deviceLang([]), 'en');
});
