const svg = (body, viewBox = '0 0 48 48') =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const mirror = (body) => `<g transform="translate(48 0) scale(-1 1)">${body}</g>`;

const RIGHT = '<path d="M17 42V27a7 7 0 0 1 7-7h15"/><path d="M31 12l8 8-8 8"/>';
const SLIGHT = '<path d="M19 42V29l14-14"/><path d="M22 14h12v12"/>';
const SHARP = '<path d="M17 8v20l16 14"/><path d="M34 30v13H21"/>';
const UTURN = '<path d="M16 42V20a9 9 0 0 1 18 0v14"/><path d="M27 28l7 7 7-7"/>';
const FORK = '<path d="M17 42V24L17 8" opacity=".35"/><path d="M17 30c0-10 7-13 14-18"/><path d="M23 10h9v9"/>';

export const MANEUVER = {
  straight: svg('<path d="M24 42V8"/><path d="M14 18L24 8l10 10"/>'),
  right: svg(RIGHT),
  left: svg(mirror(RIGHT)),
  'slight-right': svg(SLIGHT),
  'slight-left': svg(mirror(SLIGHT)),
  'sharp-right': svg(SHARP),
  'sharp-left': svg(mirror(SHARP)),
  uturn: svg(UTURN),
  'fork-right': svg(FORK),
  'fork-left': svg(mirror(FORK)),
  merge: svg('<path d="M14 42c0-12 10-14 10-24V8"/><path d="M34 42c0-8-5-11-8-13"/><path d="M15 17l9-9 9 9"/>'),
  roundabout: svg('<circle cx="24" cy="19" r="8"/><path d="M24 42V27"/><path d="M30 13l7-7"/><path d="M30 6h7v7"/>'),
  arrive: svg('<path d="M24 44s13-12 13-23a13 13 0 1 0-26 0c0 11 13 23 13 23z"/><circle cx="24" cy="21" r="4.5"/>'),
};

const LANE_RIGHT = {
  straight: '<path d="M12 21V4"/><path d="M7 9l5-5 5 5"/>',
  slight: '<path d="M10 21v-7l7-7"/><path d="M11 7h6v6"/>',
  turn: '<path d="M8 21v-8a4 4 0 0 1 4-4h8"/><path d="M16 5l4 4-4 4"/>',
  sharp: '<path d="M8 21V8l9 9"/><path d="M17 11v6h-6"/>',
  uturn: '<path d="M7 21V10a4.5 4.5 0 0 1 9 0v8"/><path d="M12 14l4 4 4-4"/>',
};
const laneMirror = (body) => `<g transform="translate(24 0) scale(-1 1)">${body}</g>`;
const LANE_ARROW = {
  straight: LANE_RIGHT.straight,
  none: LANE_RIGHT.straight,
  'slight right': LANE_RIGHT.slight,
  merge_to_right: LANE_RIGHT.slight,
  right: LANE_RIGHT.turn,
  'sharp right': LANE_RIGHT.sharp,
  uturn: LANE_RIGHT.uturn,
  'slight left': laneMirror(LANE_RIGHT.slight),
  merge_to_left: laneMirror(LANE_RIGHT.slight),
  left: laneMirror(LANE_RIGHT.turn),
  'sharp left': laneMirror(LANE_RIGHT.sharp),
};

export function laneIcon(lane) {
  const arrows = lane.dirs
    .map((d) => ({ d, on: lane.on && (!lane.use || d === lane.use) }))
    .sort((a, b) => a.on - b.on)
    .map(({ d, on }) => `<g class="${on ? 'on' : 'off'}">${LANE_ARROW[d] || LANE_ARROW.straight}</g>`)
    .join('');
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${arrows}</svg>`;
}

export const UI = {
  menu: svg('<path d="M8 14h32M8 24h32M8 34h32"/>'),
  search: svg('<circle cx="21" cy="21" r="13"/><path d="M31 31l11 11"/>'),
  close: svg('<path d="M12 12l24 24M36 12L12 36"/>'),
  locate: svg('<circle cx="24" cy="24" r="9"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8"/>'),
  report: svg('<path d="M24 6L4 41h40L24 6z"/><path d="M24 19v14M17 26h14"/>'),
  iosShare: svg('<path d="M24 5v25"/><path d="M15 14l9-9 9 9"/><path d="M16 20h-6v23h28V20h-6"/>'),
  more: svg('<circle cx="12" cy="24" r="2"/><circle cx="24" cy="24" r="2"/><circle cx="36" cy="24" r="2"/>'),
  share: svg('<circle cx="36" cy="10" r="5"/><circle cx="12" cy="24" r="5"/><circle cx="36" cy="38" r="5"/><path d="M16.5 21.5l15-9M16.5 26.5l15 9"/>'),
  navArrow: svg('<path d="M24 6l14 34-14-8-14 8z" fill="currentColor" stroke-width="3"/>'),
  routes: svg('<circle cx="24" cy="40" r="4"/><path d="M24 36V24c0-6-12-6-12-14V6"/><path d="M24 24c0-6 12-6 12-14V6"/><path d="M7 11l5-5 5 5M31 11l5-5 5 5"/>'),
  route: svg('<circle cx="12" cy="38" r="5"/><circle cx="36" cy="10" r="5"/><path d="M16 35c8-4 4-12 12-14s6-6 6-6"/>'),
  sound: svg('<path d="M8 18h8l10-8v28l-10-8H8z"/><path d="M33 17a10 10 0 0 1 0 14M38 12a17 17 0 0 1 0 24"/>'),
  muted: svg('<path d="M8 18h8l10-8v28l-10-8H8z"/><path d="M34 19l10 10M44 19L34 29"/>'),
  car: '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="sb-car" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fd0ff"/><stop offset="1" stop-color="#1583f2"/></linearGradient></defs><path d="M24 3l17 39-17-9-17 9z" fill="url(#sb-car)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>',
  dot: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="#1f6feb" fill-opacity=".18"/><circle cx="24" cy="24" r="9" fill="#1f6feb" stroke="#fff" stroke-width="3.5"/></svg>',
  pin: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 46s15-14 15-26a15 15 0 1 0-30 0c0 12 15 26 15 26z" fill="#d92d20" stroke="#fff" stroke-width="2.5"/><circle cx="24" cy="20" r="5.5" fill="#fff"/></svg>',
};
