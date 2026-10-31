import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brandOf, transform } from '../scripts/build-ev.mjs';

test('a charger gets its network from the brand, network, operator or name tag', () => {
  assert.equal(brandOf({ operator: 'ChargeSini' }), 'ChargeSini', 'no name, operator only');
  assert.equal(brandOf({ name: 'Charge Sini @ Pavilion' }), 'ChargeSini');
  assert.equal(brandOf({ network: 'TNB Electron' }), 'TNB Electron');
  assert.equal(brandOf({ name: 'ChargeEV Suria' }), 'ChargEV');
  assert.equal(brandOf({ name: 'Gentari', operator: 'Shell' }), 'Gentari', 'the charging network wins over the site');
  assert.equal(brandOf({ brand: 'ABB', name: 'ABB Terra CJG' }), '', 'hardware makers are not networks');
  assert.equal(brandOf({ name: 'JomCharge', brand: 'Gentari', operator: 'Gentari', network: 'JomCharge' }), 'JomCharge', 'the network tag is what drivers use');
  assert.equal(brandOf({ network: 'ChargEV;JomCharge;Gentari Go' }), 'ChargEV', 'the first network listed');
});

test('every charger in the bundled data keeps its place, and named networks are labelled even without a name', () => {
  const data = transform({ elements: [{ type: 'node', lon: 101.71, lat: 3.15, tags: { amenity: 'charging_station', operator: 'ChargeSini' } }, { type: 'way', center: { lon: 101.72, lat: 3.16 }, tags: { name: 'Mall EV' } }] });
  assert.deepEqual(data.ev, [[101.71, 3.15, 'ChargeSini', 'ChargeSini'], [101.72, 3.16, '', 'Mall EV']], 'no name falls back to brand, then operator, like the map tiles');
  const bundled = JSON.parse(readFileSync(new URL('../public/data/ev.json', import.meta.url), 'utf8'));
  assert.ok(bundled.ev.length > 100 && bundled.ev.every(([lon, lat]) => lon > 99 && lon < 120 && lat > 0 && lat < 8));
});
