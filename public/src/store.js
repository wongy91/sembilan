const KEY = 'sembilan:v1';

const DEFAULTS = {
  lang: 'en',
  voice: true,
  voiceURI: '',
  night: 'auto',
  avoidTolls: false,
  avoidHighways: false,
  motorcycle: false,
  threeD: false,
  traffic: true,
  home: null,
  work: null,
  recents: [],
  saved: [],
  sheetCollapsed: false,
};

export function deviceLang(languages = globalThis.navigator?.languages || []) {
  for (const tag of languages) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (code === 'en' || code === 'ms' || code === 'zh') return code;
  }
  return DEFAULTS.lang;
}

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!saved.nightChosen) delete saved.night;
    if (!saved.trafficChosen) delete saved.traffic;
    return { ...DEFAULTS, lang: deviceLang(), ...saved };
  } catch {
    return { ...DEFAULTS, lang: deviceLang() };
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

export function forget(state, place) {
  state.recents = state.recents.filter((p) => !samePlace(p, place));
  save(state);
}

const MAX_SAVED = 50;

export function findSaved(state, place) {
  return state.saved.find((s) => samePlace(s, place)) || null;
}

export function savePlace(state, place, label) {
  const entry = { label: String(label ?? '').trim().slice(0, 60) || place.name, name: place.name, sub: place.sub || '', lon: place.lon, lat: place.lat };
  const i = state.saved.findIndex((s) => samePlace(s, place));
  if (i >= 0) state.saved[i] = entry;
  else state.saved = [entry, ...state.saved].slice(0, MAX_SAVED);
  save(state);
  return entry;
}

export function removeSaved(state, place) {
  state.saved = state.saved.filter((s) => !samePlace(s, place));
  save(state);
}

function cleanPlace(p) {
  const lon = Number(p?.lon);
  const lat = Number(p?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { name: String(p.name ?? '').slice(0, 120), sub: String(p.sub ?? '').slice(0, 160), lon, lat };
}

export function exportPlaces(state) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, home: state.home, work: state.work, recents: state.recents, saved: state.saved }));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readPlaces(text) {
  const match = /#places=([A-Za-z0-9_-]+)/.exec(String(text ?? ''));
  if (!match) return null;
  try {
    const binary = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    const recents = (Array.isArray(data.recents) ? data.recents : []).map(cleanPlace).filter(Boolean).slice(0, 8);
    const saved = (Array.isArray(data.saved) ? data.saved : [])
      .map((s) => {
        const p = cleanPlace(s);
        return p && { ...p, label: String(s.label ?? '').trim().slice(0, 60) || p.name };
      })
      .filter(Boolean)
      .slice(0, MAX_SAVED);
    const places = { home: cleanPlace(data.home), work: cleanPlace(data.work), recents, saved };
    return places.home || places.work || recents.length || saved.length ? places : null;
  } catch {
    return null;
  }
}

export function importPlaces(state, places) {
  if (places.home) state.home = places.home;
  if (places.work) state.work = places.work;
  state.recents = [...places.recents, ...state.recents.filter((p) => !places.recents.some((q) => samePlace(p, q)))].slice(0, 8);
  const saved = places.saved || [];
  state.saved = [...saved, ...(state.saved || []).filter((p) => !saved.some((q) => samePlace(p, q)))].slice(0, MAX_SAVED);
  save(state);
}
