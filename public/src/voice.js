const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [];
let enabled = true;
let lang = 'ms';
let preferred = '';
let audio = null;

function refresh() {
  voices = synth ? synth.getVoices() : [];
}

export function init() {
  if (!synth) return;
  refresh();
  synth.addEventListener?.('voiceschanged', refresh);
}

export function configure(options) {
  if ('enabled' in options) enabled = options.enabled;
  if ('lang' in options) lang = options.lang;
  if ('voiceURI' in options) preferred = options.voiceURI;
}

const ORDER = {
  ms: ['ms-my', 'ms', 'id-id', 'id'],
  zh: ['zh-cn', 'zh-hans', 'cmn', 'zh-sg', 'zh-my', 'zh-tw', 'zh-hant', 'zh'],
  en: ['en-gb', 'en-my', 'en-sg', 'en-us', 'en'],
};
const FALLBACK = { ms: 'ms-MY', zh: 'zh-CN', en: 'en-GB' };

const tagOf = (v) => v.lang.replace('_', '-').toLowerCase();
const speaks = (v) => (ORDER[lang] || ORDER.en).some((prefix) => tagOf(v).startsWith(prefix));

export function available() {
  return voices.filter(speaks);
}

export function pick() {
  if (preferred) {
    const v = voices.find((x) => x.voiceURI === preferred && speaks(x));
    if (v) return v;
  }
  const order = ORDER[lang] || ORDER.en;
  for (const prefix of order) {
    const v = voices.find((x) => tagOf(x).startsWith(prefix));
    if (v) return v;
  }
  return null;
}

export function unlock() {
  if (synth) synth.speak(new SpeechSynthesisUtterance(''));
  try {
    audio ??= new AudioContext();
    audio.resume();
  } catch {
    audio = null;
  }
}

export function say(items, { force = false } = {}) {
  if (!synth || (!enabled && !force) || !items.length) return;
  if (items.some((i) => i.priority >= 2)) synth.cancel();
  const voice = pick();
  for (const item of items) {
    if (!item.text) continue;
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = voice?.lang || FALLBACK[lang] || FALLBACK.en;
    if (voice) u.voice = voice;
    u.rate = 1;
    synth.speak(u);
  }
}

export function chime(tones = [880, 1320]) {
  if (!enabled || !audio) return;
  const now = audio.currentTime;
  tones.forEach((freq, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.14);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 0.15);
  });
}

export function stop() {
  synth?.cancel();
}
