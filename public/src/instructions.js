const PHRASES = {
  ms: {
    dirs: ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'],
    ordinals: ['pertama', 'kedua', 'ketiga', 'keempat', 'kelima', 'keenam', 'ketujuh', 'kelapan', 'kesembilan', 'kesepuluh'],
    depart: 'Menuju ke {dir}',
    departRoad: 'Menuju ke {dir} di {road}',
    arrive: 'Anda telah tiba di destinasi',
    arriveSide: { left: 'Destinasi anda di sebelah kiri', right: 'Destinasi anda di sebelah kanan' },
    turn: {
      left: 'Belok kiri',
      right: 'Belok kanan',
      'slight-left': 'Belok sedikit ke kiri',
      'slight-right': 'Belok sedikit ke kanan',
      'sharp-left': 'Belok tajam ke kiri',
      'sharp-right': 'Belok tajam ke kanan',
      straight: 'Terus lurus',
    },
    keep: { left: 'Kekal di sebelah kiri', right: 'Kekal di sebelah kanan', straight: 'Terus lurus' },
    ramp: { left: 'Ambil susur di sebelah kiri', right: 'Ambil susur di sebelah kanan', straight: 'Ambil susur' },
    exit: { left: 'Ambil susur keluar di sebelah kiri', right: 'Ambil susur keluar di sebelah kanan', straight: 'Ambil susur keluar' },
    exitNumber: 'Ambil susur keluar {n}',
    merge: 'Masuk ke jalan utama',
    mergeRoad: 'Masuk ke {road}',
    roundabout: 'Di bulatan, ambil jalan keluar {ord}',
    roundaboutPlain: 'Masuk ke bulatan',
    roundaboutExit: 'Keluar dari bulatan',
    uturn: 'Buat pusingan U',
    ferry: 'Naik feri',
    continue: 'Terus lurus',
    continueRoad: 'Terus di {road}',
    name: 'Terus ke {road}',
    onto: '{base} ke {road}',
    toward: '{base} ke arah {toward}',
    in: 'Dalam {dist}, {text}',
    then: '{a}, kemudian {b}',
    continueFor: 'Terus sejauh {dist}',
    meters: '{n} meter',
    km: '{n} kilometer',
  },
  en: {
    dirs: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
    ordinals: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],
    depart: 'Head {dir}',
    departRoad: 'Head {dir} on {road}',
    arrive: 'You have arrived at your destination',
    arriveSide: { left: 'Your destination is on the left', right: 'Your destination is on the right' },
    turn: {
      left: 'Turn left',
      right: 'Turn right',
      'slight-left': 'Bear left',
      'slight-right': 'Bear right',
      'sharp-left': 'Make a sharp left',
      'sharp-right': 'Make a sharp right',
      straight: 'Continue straight',
    },
    keep: { left: 'Keep left', right: 'Keep right', straight: 'Continue straight' },
    ramp: { left: 'Take the ramp on the left', right: 'Take the ramp on the right', straight: 'Take the ramp' },
    exit: { left: 'Take the exit on the left', right: 'Take the exit on the right', straight: 'Take the exit' },
    exitNumber: 'Take exit {n}',
    merge: 'Merge',
    mergeRoad: 'Merge onto {road}',
    roundabout: 'At the roundabout, take the {ord} exit',
    roundaboutPlain: 'Enter the roundabout',
    roundaboutExit: 'Exit the roundabout',
    uturn: 'Make a U-turn',
    ferry: 'Take the ferry',
    continue: 'Continue straight',
    continueRoad: 'Continue on {road}',
    name: 'Continue onto {road}',
    onto: '{base} onto {road}',
    toward: '{base} toward {toward}',
    in: 'In {dist}, {text}',
    then: '{a}, then {b}',
    continueFor: 'Continue for {dist}',
    meters: '{n} meters',
    km: '{n} kilometers',
  },
};

export const SILENT = new Set(['name', 'roundabout-exit']);

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const lowerFirst = (s) => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function phrases(lang) {
  return PHRASES[lang] || PHRASES.ms;
}

function sideKey(modifier) {
  if (!modifier) return 'straight';
  if (modifier.includes('left')) return 'left';
  if (modifier.includes('right')) return 'right';
  return 'straight';
}

export function roadName(step) {
  return step.names?.[0] || step.refs?.[0] || '';
}

export function roadLabel(step) {
  const name = step.names?.[0];
  const ref = step.refs?.[0];
  if (name && ref) return `${ref} ${name}`;
  return name || ref || '';
}

function towardText(step, spoken) {
  const list = (step.toward || []).slice(0, 2);
  const text = list.join(spoken ? ', ' : ' / ');
  return spoken ? text.replace(/\s*\/\s*/g, ', ') : text;
}

function withTarget(P, base, step, spoken) {
  const toward = towardText(step, spoken);
  if (toward) return fill(P.toward, { base, toward });
  const road = roadName(step);
  if (road) return fill(P.onto, { base, road });
  return base;
}

export function instruction(step, lang = 'ms', { spoken = false } = {}) {
  const P = phrases(lang);
  const road = roadName(step);
  switch (step.kind) {
    case 'depart': {
      const dir = Number.isFinite(step.bearingAfter) ? P.dirs[Math.round(step.bearingAfter / 45) % 8] : null;
      if (!dir) return road ? fill(P.continueRoad, { road }) : P.continue;
      return road ? fill(P.departRoad, { dir, road }) : fill(P.depart, { dir });
    }
    case 'arrive':
      return step.side && P.arriveSide[step.side] ? P.arriveSide[step.side] : P.arrive;
    case 'turn': {
      const base = P.turn[step.modifier] || P.turn.straight;
      return road ? fill(P.onto, { base, road }) : base;
    }
    case 'keep':
      return withTarget(P, P.keep[sideKey(step.modifier)], step, spoken);
    case 'ramp':
      return withTarget(P, P.ramp[sideKey(step.modifier)], step, spoken);
    case 'exit': {
      const base = step.exitNumber ? fill(P.exitNumber, { n: step.exitNumber }) : P.exit[sideKey(step.modifier)];
      return withTarget(P, base, step, spoken);
    }
    case 'merge':
      return road ? fill(P.mergeRoad, { road }) : P.merge;
    case 'roundabout': {
      const n = step.roundaboutExit;
      const base = n ? fill(P.roundabout, { ord: P.ordinals[n - 1] || String(n) }) : P.roundaboutPlain;
      return road ? fill(P.onto, { base, road }) : base;
    }
    case 'roundabout-exit':
      return road ? fill(P.onto, { base: P.roundaboutExit, road }) : P.roundaboutExit;
    case 'uturn':
      return road ? fill(P.onto, { base: P.uturn, road }) : P.uturn;
    case 'ferry':
      return P.ferry;
    case 'name':
      return road ? fill(P.name, { road }) : P.continue;
    default:
      return road ? fill(P.continueRoad, { road }) : P.continue;
  }
}

export function spokenDistance(meters, lang = 'ms') {
  const P = phrases(lang);
  if (meters >= 950) {
    const km = meters >= 9750 ? Math.round(meters / 1000) : Math.max(1, Math.round(meters / 500) / 2);
    const n = Number.isInteger(km) ? String(km) : km.toFixed(1);
    if (lang === 'en' && km === 1) return '1 kilometer';
    return fill(P.km, { n });
  }
  const n = meters >= 300 ? Math.round(meters / 100) * 100 : Math.max(50, Math.round(meters / 50) * 50);
  return fill(P.meters, { n });
}

export function withDistance(text, meters, lang = 'ms') {
  return fill(phrases(lang).in, { dist: spokenDistance(meters, lang), text: lowerFirst(text) });
}

export function chain(a, b, lang = 'ms') {
  return fill(phrases(lang).then, { a, b: lowerFirst(b) });
}

export function continueFor(meters, lang = 'ms') {
  return fill(phrases(lang).continueFor, { dist: spokenDistance(meters, lang) });
}

export function maneuverIcon(step) {
  const side = sideKey(step.modifier);
  switch (step.kind) {
    case 'arrive':
      return 'arrive';
    case 'roundabout':
    case 'roundabout-exit':
      return 'roundabout';
    case 'uturn':
      return 'uturn';
    case 'merge':
      return 'merge';
    case 'ramp':
    case 'exit':
    case 'keep':
      return side === 'straight' ? 'straight' : `fork-${side}`;
    case 'turn':
      return step.modifier && step.modifier !== 'straight' ? step.modifier : 'straight';
    default:
      return 'straight';
  }
}
