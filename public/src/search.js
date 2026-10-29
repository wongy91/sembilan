const PHOTON = 'https://photon.komoot.io';
const BBOX = '99.5,0.8,119.5,7.5';
const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function toPlace(feature) {
  const p = feature.properties || {};
  const [lon, lat] = feature.geometry.coordinates;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || street || p.district || p.city || p.state || '';
  const parts = [p.name ? street : '', p.district, p.city, p.state].filter(Boolean);
  const sub = parts.filter((x, i) => x !== name && parts.indexOf(x) === i).join(', ');
  return { name, sub, lon, lat };
}

export async function searchPlaces(query, { near, lang, signal } = {}) {
  const coord = COORD.exec(query);
  if (coord) {
    const lat = Number(coord[1]);
    const lon = Number(coord[2]);
    return [{ name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, sub: '', lon, lat }];
  }
  const params = new URLSearchParams({ q: query, limit: '8', bbox: BBOX });
  if (near) {
    params.set('lat', near[1].toFixed(4));
    params.set('lon', near[0].toFixed(4));
    params.set('zoom', '10');
    params.set('location_bias_scale', '0.6');
  }
  if (lang === 'en') params.set('lang', 'en');
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  return (data.features || []).map(toPlace).filter((p) => {
    const key = `${p.name}|${p.sub}`;
    if (!p.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function reversePlace([lon, lat], { lang, signal } = {}) {
  const params = new URLSearchParams({ lon: String(lon), lat: String(lat), limit: '1' });
  if (lang === 'en') params.set('lang', 'en');
  const res = await fetch(`${PHOTON}/reverse?${params}`, { signal });
  if (!res.ok) throw new Error(`reverse ${res.status}`);
  const feature = (await res.json()).features?.[0];
  return feature ? { ...toPlace(feature), lon, lat } : null;
}
