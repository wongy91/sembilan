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

export function available() {
  return voices.filter((v) => /^(ms|id|en)/i.test(v.lang));
}

export function pick() {
  if (preferred) {
    const v = voices.find((x) => x.voiceURI === preferred);
    if (v) return v;
  }
  const order = lang === 'ms' ? ['ms-my', 'ms', 'id-id', 'id'] : ['en-gb', 'en-my', 'en-sg', 'en-us', 'en'];
  for (const prefix of order) {
    const v = voices.find((x) => x.lang.replace('_', '-').toLowerCase().startsWith(prefix));
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
    u.lang = voice?.lang || (lang === 'ms' ? 'ms-MY' : 'en-GB');
    if (voice) u.voice = voice;
    u.rate = 1;
    synth.speak(u);
  }
}

export function chime() {
  if (!enabled || !audio) return;
  const now = audio.currentTime;
  [880, 1320].forEach((freq, i) => {
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
