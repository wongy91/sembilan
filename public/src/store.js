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

export function remember(state, place) {
  const same = (p) => Math.abs(p.lon - place.lon) < 1e-4 && Math.abs(p.lat - place.lat) < 1e-4;
  const entry = { name: place.name, sub: place.sub || '', lon: place.lon, lat: place.lat };
  state.recents = [entry, ...state.recents.filter((p) => !same(p))].slice(0, 8);
  save(state);
}
