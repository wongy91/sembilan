const KEY = 'sembilan:v1';

const DEFAULTS = {
  lang: 'en',
  voice: true,
  voiceURI: '',
  night: 'auto',
  avoidTolls: false,
  avoidHighways: false,
  threeD: false,
  traffic: false,
  home: null,
  work: null,
  recents: [],
};

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!saved.nightChosen) delete saved.night;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

const samePlace = (a, b) => Math.abs(a.lon - b.lon) < 1e-4 && Math.abs(a.lat - b.lat) < 1e-4;

export function remember(state, place) {
  const entry = { name: place.name, sub: place.sub || '', lon: place.lon, lat: place.lat };
  state.recents = [entry, ...state.recents.filter((p) => !samePlace(p, place))].slice(0, 8);
  save(state);
}

function cleanPlace(p) {
  const lon = Number(p?.lon);
  const lat = Number(p?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { name: String(p.name ?? '').slice(0, 120), sub: String(p.sub ?? '').slice(0, 160), lon, lat };
}

export function exportPlaces(state) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, home: state.home, work: state.work, recents: state.recents }));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readPlaces(text) {
  const match = /#places=([A-Za-z0-9_-]+)/.exec(String(text ?? ''));
  if (!match) return null;
  try {
    const binary = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    const recents = (Array.isArray(data.recents) ? data.recents : []).map(cleanPlace).filter(Boolean).slice(0, 8);
    const places = { home: cleanPlace(data.home), work: cleanPlace(data.work), recents };
    return places.home || places.work || recents.length ? places : null;
  } catch {
    return null;
  }
}

export function importPlaces(state, places) {
  if (places.home) state.home = places.home;
  if (places.work) state.work = places.work;
  state.recents = [...places.recents, ...state.recents.filter((p) => !places.recents.some((q) => samePlace(p, q)))].slice(0, 8);
  save(state);
}
