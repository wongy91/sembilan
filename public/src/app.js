import { MapView } from './map.js';
import { fmtAgo, fmtClock, fmtDistance, fmtDuration, getLang, setLang, t } from './i18n.js';
import { reversePlace, searchPlaces } from './search.js';
import { loadLanes, planRoutes } from './routing.js';
import { Navigator } from './navigator.js';
import { instruction, maneuverIcon, roadName } from './instructions.js';
import { poisAlongRoute, reportPois, summarize, trafficPois } from './pois.js';
import { attachFares, fareGroups, fareKeys, fetchFares, priceRoute } from './fares.js';
import { bbox, bearing, haversine } from './geo.js';
import { REPORT_ICON, REPORT_KINDS, fetchReports, health, postReport, voteReport } from './reports.js';
import { simulate } from './sim.js';
import { MANEUVER, UI, laneIcon } from './icons.js';
import * as store from './store.js';
import * as voice from './voice.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const settings = store.load();
const state = {
  mode: 'home',
  place: null,
  routes: [],
  routePois: [],
  prices: [],
  selected: 0,
  planning: false,
  planError: null,
  planAbort: null,
  searchAbort: null,
  fix: null,
  realFix: null,
  backend: { traffic: false, reports: false, fares: false },
  poiData: null,
  nav: null,
  following: true,
  wakeLock: null,
  installPrompt: null,
  centered: false,
  alertTimer: null,
  toastTimer: null,
  myReports: new Set(),
};

setLang(settings.lang);
voice.init();
voice.configure({ enabled: settings.voice, lang: settings.lang, voiceURI: settings.voiceURI });

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
const onPhone = () => matchMedia('(pointer: coarse)').matches;
const isMacSafari =
  /Macintosh/.test(navigator.userAgent) &&
  navigator.maxTouchPoints === 0 &&
  !/Chrome|Chromium|Edg|Firefox|OPR/.test(navigator.userAgent) &&
  Number(/Version\/(\d+)/.exec(navigator.userAgent)?.[1]) >= 17;
const installSteps = isIOS ? 'installIos' : isMacSafari ? 'installMac' : null;
const canInstall = () => !installed() && (!!state.installPrompt || !!installSteps);
const offerInstall = () => canInstall() && (onPhone() || isMacSafari);

const isNight = () => {
  if (settings.night !== 'auto') return settings.night === 'night';
  const h = new Date().getHours();
  return h >= 19 || h < 7;
};

const map = new MapView($('map'), {
  night: isNight(),
  threeD: settings.threeD,
  onLongPress: dropPin,
  onUserMove: () => {
    if (!state.nav) return;
    state.following = false;
    map.setFollow(false);
    $('btn-recenter').hidden = false;
  },
  onRouteClick: selectRoute,
  onReportClick: showReportPopup,
});
window.sembilan = { map, state };

function setTheme() {
  const night = isNight();
  document.documentElement.dataset.theme = night ? 'night' : 'day';
  document.querySelector('meta[name="theme-color"]').content = night ? '#0f1729' : '#eef1f4';
  map.setNight(night);
}

function applyTexts() {
  document.documentElement.lang = getLang();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
    node.title = t(node.dataset.i18nLabel);
  }
  $('report-grid').innerHTML = REPORT_KINDS.map(
    (k) => `<button type="button" class="report-kind" data-kind="${k}"><span>${REPORT_ICON[k]}</span>${esc(t(k))}</button>`,
  ).join('');
}

function toast(text) {
  const node = $('toast');
  node.textContent = text;
  node.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => (node.hidden = true), 3200);
}

function sheetPadding() {
  const sheet = $('sheet');
  const wide = window.innerWidth >= 900;
  return {
    top: 90,
    left: wide && !sheet.hidden ? sheet.offsetWidth + 40 : 30,
    right: 80,
    bottom: !wide && !sheet.hidden ? sheet.offsetHeight + 24 : 40,
  };
}

function placeUrl(place) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('to', `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`);
  url.searchParams.set('n', place.name);
  return url.toString();
}

async function share(text, url) {
  try {
    if (navigator.share) return await navigator.share({ title: 'Sembilan', text, url });
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`.trim());
    toast(t('copied'));
  } catch {
    toast(url);
  }
}

let renderedMode = null;

function render() {
  document.body.dataset.mode = state.mode;
  const body = $('sheet-body');
  body.innerHTML = { home: homeSheet, place: placeSheet, routes: routesSheet, nav: navSheet, arrived: arrivedSheet }[state.mode]();
  $('finder').hidden = !(state.mode === 'home' || state.navSearch);
  document.body.classList.toggle('nav-search', !!state.navSearch);
  if (state.mode !== renderedMode) {
    renderedMode = state.mode;
    body.classList.remove('enter');
    void body.offsetWidth;
    body.classList.add('enter');
  }
  measureSheet();
}

function measureSheet() {
  const sheet = $('sheet');
  const height = !sheet.hidden && window.innerWidth < 900 ? sheet.offsetHeight : 0;
  document.documentElement.style.setProperty('--sheet-h', `${height}px`);
}

function shortcut(key) {
  const place = settings[key];
  return `<button class="shortcut" data-action="saved" data-key="${key}">
      <span class="shortcut-icon">${key === 'home' ? '🏠' : '💼'}</span>
      <span><b>${esc(t(key))}</b><small>${esc(place ? place.name : t('notSet'))}</small></span>
    </button>`;
}

function installStepsText() {
  return esc(t(installSteps, { share: '{share}' })).replace('{share}', `<span class="ios-share">${UI.iosShare}</span>`);
}

function installCard() {
  const ios = !state.installPrompt;
  return `<div class="install-card">
      <img src="icons/icon-192.png" alt="" width="44" height="44">
      <div><b>${esc(t('installTitle'))}</b><small>${ios ? installStepsText() : esc(t('installWhy'))}</small></div>
      ${ios ? '' : `<button class="btn primary" data-action="install">${esc(t('installNow'))}</button>`}
      <button class="icon-btn" data-action="install-later" aria-label="${esc(t('notNow'))}">${UI.close}</button>
    </div>`;
}

function homeSheet() {
  const recents = settings.recents
    .slice(0, 3)
    .map(
      (p, i) =>
        `<button class="list-item" data-action="recent" data-i="${i}"><span class="li-icon">🕘</span><span><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></span></button>`,
    )
    .join('');
  const install = offerInstall() && !settings.installDismissed ? installCard() : '';
  return `${install}<div class="shortcuts">${shortcut('home')}${shortcut('work')}</div>${
    recents ? `<h3 class="label">${esc(t('recent'))}</h3>${recents}` : `<p class="muted hint small">${esc(t('hint'))}</p>`
  }`;
}

function placeSheet() {
  const p = state.place;
  return `<div class="place-head">
      <div><h2>${esc(p.name)}</h2><p class="muted">${esc(p.sub)}</p></div>
      <button class="icon-btn" data-action="close" aria-label="${esc(t('close'))}">${UI.close}</button>
    </div>
    <button class="btn primary big block" data-action="directions">${esc(t('directions'))}</button>
    <div class="quick-actions">
      <button class="quick" data-action="set-home"><span>🏠</span>${esc(t('setHome'))}</button>
      <button class="quick" data-action="set-work"><span>💼</span>${esc(t('setWork'))}</button>
      <button class="quick" data-action="share-place"><span>${UI.share}</span>${esc(t('share'))}</button>
    </div>`;
}

function tollTags(r, i) {
  const sum = summarize(state.routePois[i] || []);
  const price = state.prices[i];
  if (price?.priced) {
    const tags = [`<span class="tag fare">${esc(t('fare', { amount: price.total.toFixed(2) }))}${price.missing ? ' + ?' : ''}</span>`];
    if (price.other) tags.push(`<span class="tag toll">${esc(t(price.other === 1 ? 'fareOtherOne' : 'fareOther', { n: price.other }))}</span>`);
    return tags;
  }
  const tags = [];
  if (price?.items.length) tags.push(`<span class="tag">${esc(t('fareUnavailable'))}</span>`);
  if (sum.tolls) tags.push(`<span class="tag toll">${esc(t(sum.tolls === 1 ? 'tollPlazasOne' : 'tollPlazas', { n: sum.tolls }))}</span>`);
  else tags.push(`<span class="tag ${r.hasToll ? 'toll' : 'free'}">${esc(t(r.hasToll ? 'tolled' : 'noToll'))}</span>`);
  return tags;
}

function routeCard(r, i) {
  const fastest = state.routes[0];
  const sum = summarize(state.routePois[i] || []);
  const diff = r.duration - fastest.duration;
  const tags = tollTags(r, i);
  if (sum.cameras) tags.push(`<span class="tag">📷 ${esc(t(sum.cameras === 1 ? 'camerasOne' : 'cameras', { n: sum.cameras }))}</span>`);
  if (r.trafficDelay > 60) tags.push(`<span class="tag jam">${esc(t('trafficDelay', { d: fmtDuration(r.trafficDelay) }))}</span>`);
  return `<button class="route-card${i === state.selected ? ' selected' : ''}" data-action="route" data-i="${i}">
      <span class="rc-top"><b>${esc(fmtDuration(r.duration))}</b><span class="muted">${esc(fmtDistance(r.distance))}</span>${
        i === 0 ? `<span class="tag good">${esc(t('fastest'))}</span>` : diff >= 60 ? `<span class="tag">${esc(t('slower', { d: fmtDuration(diff) }))}</span>` : ''
      }</span>
      ${r.via.length ? `<span class="rc-via">${esc(t('via', { road: r.via.join(' · ') }))}</span>` : ''}
      <span class="rc-tags">${tags.join('')}</span>
    </button>`;
}

function routesSheet() {
  const head = `<div class="place-head">
      <div><h2>${esc(t('routesTo', { name: state.place.name }))}</h2></div>
      <button class="icon-btn" data-action="close" aria-label="${esc(t('close'))}">${UI.close}</button>
    </div>
    <div class="chips">
      <label class="chip toggle"><input type="checkbox" data-action="avoid-tolls" ${settings.avoidTolls ? 'checked' : ''}> ${esc(t('avoidTolls'))}</label>
      <label class="chip toggle"><input type="checkbox" data-action="avoid-highways" ${settings.avoidHighways ? 'checked' : ''}> ${esc(t('avoidHighways'))}</label>
    </div>`;
  if (state.planning) {
    const card = '<div class="route-card skeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
    return `${head}<p class="muted small loading">${esc(t('planning'))}</p><div class="route-list">${card.repeat(3)}</div>`;
  }
  if (state.planError) return `${head}<p class="error">${esc(state.planError)}</p>`;
  const live = state.routes[0]?.provider === 'tomtom';
  const priced = state.prices.some((p) => p?.priced);
  return `${head}<div class="route-list">${state.routes.map(routeCard).join('')}</div>
    <p class="muted small">${esc(t(live ? 'liveTraffic' : 'noLiveTraffic'))}${priced ? ` · ${esc(t('fareNote'))}` : ''}</p>
    <div class="actions sticky">
      <button class="btn primary big" data-action="start">${esc(t('start'))}</button>
      <button class="btn" data-action="demo">${esc(t('demo'))}</button>
    </div>`;
}

function soundTile() {
  return `${settings.voice ? UI.sound : UI.muted}<span>${esc(t(settings.voice ? 'sound' : 'muted'))}</span>`;
}

function arrivedSheet() {
  return `<div class="arrived">
      <span class="arrived-icon">🏁</span>
      <h2>${esc(t('arrived'))}</h2>
      <p class="muted">${esc(state.place?.name || '')}</p>
      ${state.installAfterTrip && canInstall() ? installCard() : ''}
      <button class="btn primary big block" data-action="close">${esc(t('done'))}</button>
    </div>`;
}

function toggleVoice() {
  changeSetting('voice', !settings.voice);
  if (!settings.voice) voice.stop();
  $('btn-sound').innerHTML = settings.voice ? UI.sound : UI.muted;
  const tile = document.querySelector('[data-action="mute"]');
  if (tile) tile.innerHTML = soundTile();
}

function toggleMore() {
  const more = $('nav-more');
  if (!more) return;
  more.hidden = !more.hidden;
  document.body.classList.toggle('nav-more-open', !more.hidden);
  measureSheet();
}

function navSheet() {
  return `<div class="nav-bar">
      <button class="round" data-action="nav-search" aria-label="${esc(t('search'))}">${UI.search}</button>
      <button class="eta" data-action="more" aria-label="${esc(t('more'))}"><b id="nav-eta">–</b><small id="nav-left"></small></button>
      <button class="round" data-action="more" aria-label="${esc(t('more'))}">${UI.more}</button>
    </div>
    <div id="nav-more" class="nav-more" hidden>
      <button class="tile" data-action="overview">${UI.route}<span>${esc(t('overview'))}</span></button>
      <button class="tile" data-action="mute">${soundTile()}</button>
      <button class="tile" data-action="share-eta">${UI.share}<span>${esc(t('shareEta'))}</span></button>
      <button class="tile danger" data-action="end">${UI.close}<span>${esc(t('end'))}</span></button>
    </div>
    <div id="nav-next" class="next-poi"></div>`;
}

function hideResults() {
  $('results').hidden = true;
  document.body.classList.remove('has-results');
}

function endSearch() {
  document.body.classList.remove('searching');
  if (state.navSearch) {
    state.navSearch = false;
    $('q').value = '';
    render();
  }
  hideResults();
  $('btn-clear').hidden = !$('q').value;
  $('q').blur();
  measureSheet();
}

function showResults(items) {
  const ul = $('results');
  ul.items = items;
  ul.innerHTML = items
    .map((p, i) =>
      p.msg
        ? `<li class="msg">${esc(p.msg)}</li>`
        : `<li><button type="button" data-i="${i}"><b>${p.local ? `${{ home: '🏠', work: '💼' }[p.tag] || '🕘'} ` : ''}${esc(p.name)}</b><small>${esc(p.sub)}</small></button></li>`,
    )
    .join('');
  ul.hidden = false;
  document.body.classList.add('has-results');
}

const searchCache = new Map();
const cacheKey = (query) => `${getLang()}|${query.toLowerCase()}`;

function localMatches(query) {
  const q = query.toLowerCase();
  const saved = ['home', 'work'].filter((k) => settings[k]).map((k) => ({ ...settings[k], tag: k }));
  const seen = new Set();
  return [...saved, ...settings.recents]
    .filter((p) => `${p.name} ${p.sub}`.toLowerCase().includes(q))
    .filter((p) => {
      const key = `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((p) => ({ ...p, local: true }));
}

function showMerged(local, remote, empty) {
  const near = (a, b) => Math.abs(a.lon - b.lon) < 1e-3 && Math.abs(a.lat - b.lat) < 1e-3;
  const items = [...local, ...remote.filter((r) => !local.some((l) => near(l, r)))];
  showResults(items.length ? items : [{ msg: t(empty) }]);
}

async function runSearch(query) {
  state.searchAbort?.abort();
  const local = localMatches(query);
  const cached = searchCache.get(cacheKey(query));
  if (cached) return showMerged(local, cached, 'noResults');
  const ctrl = (state.searchAbort = new AbortController());
  showResults([...local, { msg: t('searching') }]);
  try {
    const near = state.fix ? [state.fix.lon, state.fix.lat] : map.center();
    const list = await searchPlaces(query, { near, lang: getLang(), signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    searchCache.set(cacheKey(query), list);
    if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value);
    showMerged(local, list, 'noResults');
  } catch {
    if (!ctrl.signal.aborted) showMerged(local, [], 'searchFailed');
  }
}

function selectPlace(place) {
  state.planAbort?.abort();
  state.place = place;
  state.mode = 'place';
  state.routes = [];
  map.clearRoutes();
  $('q').value = '';
  endSearch();
  map.showPin([place.lon, place.lat]);
  render();
  map.flyTo([place.lon, place.lat], 15);
}

async function dropPin(lonLat) {
  if (state.nav) return;
  const place = { name: t('droppedPin'), sub: `${lonLat[1].toFixed(5)}, ${lonLat[0].toFixed(5)}`, lon: lonLat[0], lat: lonLat[1] };
  selectPlace(place);
  try {
    const found = await reversePlace(lonLat, { lang: getLang() });
    if (found && state.place === place) selectPlace({ ...found, lon: lonLat[0], lat: lonLat[1] });
  } catch {}
}

function goHome() {
  state.planAbort?.abort();
  state.mode = 'home';
  state.place = null;
  state.routes = [];
  $('q').value = '';
  endSearch();
  map.clearRoutes();
  map.showPin(null);
  render();
}

async function loadPrices(routes, poisList) {
  const groups = routes.map((r, i) => fareGroups(r, poisList[i]));
  const keys = fareKeys(groups.flat()).slice(0, 12);
  let fares = new Map();
  if (keys.length) {
    try {
      fares = await fetchFares(keys);
    } catch {}
  }
  return routes.map((r, i) => {
    const price = priceRoute(groups[i], fares, poisList[i]);
    attachFares(price, fares);
    return price;
  });
}

async function plan() {
  const dest = state.place;
  state.mode = 'routes';
  state.routes = [];
  state.prices = [];
  state.planError = null;
  if (!state.fix) {
    state.planError = t('needLocation');
    render();
    return;
  }
  state.planning = true;
  render();
  state.planAbort?.abort();
  const ctrl = (state.planAbort = new AbortController());
  try {
    const routes = await planRoutes([state.fix.lon, state.fix.lat], [dest.lon, dest.lat], {
      avoidTolls: settings.avoidTolls,
      avoidHighways: settings.avoidHighways,
      liveTraffic: state.backend.traffic,
      signal: ctrl.signal,
    });
    if (ctrl.signal.aborted) return;
    routes.sort((a, b) => a.duration - b.duration);
    state.routes = routes;
    state.routePois = routes.map((r) => poisAlongRoute(r, state.poiData));
    state.selected = 0;
  } catch {
    if (ctrl.signal.aborted) return;
    state.planError = t('noRoute');
  }
  state.planning = false;
  render();
  if (state.routes.length && state.backend.fares) {
    const routes = state.routes;
    loadPrices(routes, state.routePois).then((prices) => {
      if (state.routes !== routes || state.mode !== 'routes') return;
      state.prices = prices;
      render();
    });
  }
  if (state.routes.length) {
    selectRoute(0);
    const corners = state.routes.flatMap((r) => {
      const [a, b, c, d] = bbox(r.coords);
      return [[a, b], [c, d]];
    });
    map.fit(corners, sheetPadding());
  }
}

function selectRoute(i) {
  if (state.mode !== 'routes' || !state.routes[i]) return;
  state.selected = i;
  map.showRoutes(state.routes, i);
  map.setPois(state.routePois[i] || []);
  for (const card of document.querySelectorAll('.route-card')) card.classList.toggle('selected', Number(card.dataset.i) === i);
}

async function acquireWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}

function releaseWakeLock() {
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
}

function startNav(simulated) {
  const route = state.routes[state.selected];
  if (!route) return;
  voice.unlock();
  store.remember(settings, state.place);
  if (simulated) state.realFix = state.fix;
  const basePois = [...(state.routePois[state.selected] || []), ...trafficPois(route)];
  state.nav = {
    route,
    dest: state.place,
    basePois,
    pois: basePois,
    reports: [],
    navigator: new Navigator(route, { lang: getLang(), pois: basePois }),
    simulated,
    stopSim: null,
    lastReroute: 0,
    rerouting: false,
    reportTimer: null,
  };
  fetchNavLanes(state.nav, 0);
  state.routes = [route];
  state.selected = 0;
  state.mode = 'nav';
  state.following = true;
  if (!isIOS && onPhone() && !installed() && !document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
  map.showPin([state.place.lon, state.place.lat]);
  map.showRoutes([route], 0);
  map.setPois(basePois);
  $('banner').hidden = false;
  $('speedo').hidden = false;
  $('btn-report').hidden = !state.backend.reports;
  $('btn-sound').hidden = false;
  $('btn-sound').innerHTML = settings.voice ? UI.sound : UI.muted;
  render();
  acquireWakeLock();
  if (simulated) state.nav.stopSim = simulate(route, handleFix, { speedup: 3 });
  else if (state.fix) navTick(state.fix);
  if (state.backend.reports) {
    refreshReports();
    state.nav.reportTimer = setInterval(refreshReports, 90000);
  }
}

function finishNav(arrived) {
  const nav = state.nav;
  if (!nav) return;
  nav.stopSim?.();
  clearInterval(nav.reportTimer);
  releaseWakeLock();
  if (!arrived) voice.stop();
  state.nav = null;
  if (nav.simulated) state.fix = state.realFix;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  for (const id of ['banner', 'lanes', 'speedo', 'speed-limit', 'btn-sound', 'btn-report', 'btn-recenter', 'alert', 'road-pill']) $(id).hidden = true;
  map.setCallout(null);
  document.body.classList.remove('nav-more-open', 'has-lanes');
  goHome();
  map.stopDrive();
  map.resetCamera();
  if (arrived) {
    state.installAfterTrip = offerInstall() && !settings.installAskedAfterTrip;
    if (state.installAfterTrip) changeSetting('installAskedAfterTrip', true);
    state.mode = 'arrived';
    state.place = nav.dest;
    map.showPin([nav.dest.lon, nav.dest.lat]);
    render();
  }
  if (state.fix) {
    map.setUser([state.fix.lon, state.fix.lat], state.fix.heading, false);
    map.flyTo([state.fix.lon, state.fix.lat], 15);
  }
}

function updateBanner(progress) {
  const step = progress.next;
  $('man-icon').innerHTML = MANEUVER[maneuverIcon(step)] || MANEUVER.straight;
  $('man-dist').textContent = progress.nextDistance < 15 ? t('now') : fmtDistance(progress.nextDistance);
  const shield = step.refs?.[0] && step.names?.[0] ? `<span class="shield">${esc(step.refs[0])}</span> ` : '';
  $('man-text').innerHTML = shield + esc(instruction(step, getLang()));
  const then = progress.following;
  $('man-then').hidden = !then;
  if (then) $('man-then').innerHTML = `<span>${esc(t('then'))}</span>${MANEUVER[maneuverIcon(then)] || ''}`;
}

function fetchNavLanes(nav, from) {
  const route = nav.route;
  nav.lanesTo = Infinity;
  loadLanes(route, from)
    .then((to) => {
      if (nav.route === route) nav.lanesTo = to;
    })
    .catch(() => {});
}

function updateLanes(progress) {
  const nav = state.nav;
  const lanes = progress.next.lanes;
  const reach = nav.route.steps[progress.stepIndex].highway ? 1500 : 600;
  const key = lanes && progress.nextDistance <= reach ? progress.nextIndex : -1;
  if (nav.lanesFor === key) return;
  nav.lanesFor = key;
  $('lanes').hidden = key < 0;
  document.body.classList.toggle('has-lanes', key >= 0);
  if (key >= 0) $('lanes').innerHTML = lanes.map((l) => `<span>${laneIcon(l)}</span>`).join('');
}

function updateNavSheet(progress, fix) {
  const eta = $('nav-eta');
  if (!eta) return;
  eta.textContent = fmtClock(new Date(Date.now() + progress.remainingTime * 1000));
  $('nav-left').textContent = `${fmtDuration(progress.remainingTime)} · ${fmtDistance(progress.remaining)}`;
  const ahead = state.nav.pois.filter((p) => p.along > progress.along);
  const rr = ahead.find((p) => p.kind === 'rr');
  const toll = ahead.find((p) => p.kind === 'toll');
  const parts = [];
  if (toll) {
    const fare = toll.fare != null ? ` · ${t('fare', { amount: toll.fare.toFixed(2) })}` : '';
    parts.push(`🟡 ${toll.name || t('tollPlaza')} · ${fmtDistance(toll.along - progress.along)}${fare}`);
  }
  if (rr) parts.push(`${t('nextRR')}: ${rr.name} · ${fmtDistance(rr.along - progress.along)}`);
  $('nav-next').innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('');
  const kmh = Number.isFinite(fix.speed) ? Math.round(fix.speed * 3.6) : 0;
  const limit = progress.speedLimit;
  $('speed').textContent = String(kmh);
  $('speed-limit').hidden = !limit;
  if (limit) $('speed-limit').textContent = String(limit);
  $('speedo').classList.toggle('over', !!limit && kmh > limit + 5);
}

function alertLabel(a) {
  switch (a.kind) {
    case 'camera':
      return `📷 ${t('speedCamera')}${a.maxspeed ? ` · ${a.maxspeed}` : ''}`;
    case 'toll':
      return `🟡 ${a.name || t('tollPlaza')}`;
    case 'report':
      return `${REPORT_ICON[a.report] || '⚠️'} ${t(a.report)}`;
    case 'traffic':
      return `🚦 ${t('trafficDelay', { d: fmtDuration(a.delay) })}`;
    default:
      return '';
  }
}

function showAlert(a) {
  const node = $('alert');
  const text = `${alertLabel(a)} · ${fmtDistance(a.distance)}`;
  const ask = a.kind === 'report' && a.reportId && !state.myReports.has(a.reportId);
  node.innerHTML = ask
    ? `<span><b>${esc(text)}</b><small>${esc(t('stillThere'))}</small></span><button type="button" data-vote="1" aria-label="${esc(t('yes'))}">👍</button><button type="button" data-vote="0" aria-label="${esc(t('gone'))}">👎</button>`
    : `<span>${esc(text)}</span>`;
  node.dataset.kind = a.kind;
  node.dataset.report = ask ? a.reportId : '';
  node.hidden = false;
  clearTimeout(state.alertTimer);
  state.alertTimer = setTimeout(() => (node.hidden = true), ask ? 12000 : 9000);
}

function navTick(fix) {
  const nav = state.nav;
  const out = nav.navigator.update(fix);
  if (out.speech.length) voice.say(out.speech);
  if (out.alerts.some((a) => a.kind === 'camera')) voice.chime();
  out.alerts.forEach(showAlert);
  const progress = out.progress;
  const position = progress.snapped || [fix.lon, fix.lat];
  map.driveTo(position, fix.heading, fix.speed ?? 0);
  const now = performance.now();
  if (!nav.lineAt || (now - nav.lineAt > 1000 && Math.abs(progress.along - nav.lineAlong) > 20)) {
    map.showRoutes([nav.route], 0, progress.along);
    nav.lineAt = now;
    nav.lineAlong = progress.along;
  }
  updateBanner(progress);
  if (progress.along > nav.lanesTo - 20000 && nav.lanesTo < nav.route.distance) fetchNavLanes(nav, progress.along);
  updateLanes(progress);
  if (nav.calloutFor !== progress.nextIndex) {
    nav.calloutFor = progress.nextIndex;
    const next = progress.next;
    map.setCallout(nav.route.coords[next.index], next.kind === 'arrive' ? '' : roadName(next) || next.toward?.[0] || '');
  }
  const road = roadName(nav.route.steps[progress.stepIndex]);
  $('road-pill').textContent = road;
  $('road-pill').hidden = !road;
  updateNavSheet(progress, fix);
  if (out.offRoute) reroute(fix);
  if (out.arrived) setTimeout(() => finishNav(true), 1500);
}

function useRoute(nav, route) {
  nav.route = route;
  nav.calloutFor = undefined;
  nav.lanesFor = undefined;
  fetchNavLanes(nav, 0);
  nav.lineAt = 0;
  nav.basePois = [...poisAlongRoute(route, state.poiData), ...trafficPois(route)];
  nav.pois = [...nav.basePois, ...reportPois(route, nav.reports)];
  if (state.backend.fares) loadPrices([route], [nav.basePois]);
  nav.navigator = new Navigator(route, { lang: getLang(), pois: nav.pois, resumed: true });
  state.routes = [route];
  map.setPois(nav.pois);
  if (nav.simulated) {
    nav.stopSim?.();
    nav.stopSim = simulate(route, handleFix, { speedup: 3 });
  }
}

async function changeDestination(place) {
  const nav = state.nav;
  const fix = state.fix;
  if (!nav || !fix) return;
  toast(t('rerouting'));
  try {
    const [route] = await planRoutes([fix.lon, fix.lat], [place.lon, place.lat], {
      avoidTolls: settings.avoidTolls,
      avoidHighways: settings.avoidHighways,
      heading: fix.heading,
      liveTraffic: state.backend.traffic,
    });
    if (state.nav !== nav) return;
    nav.dest = place;
    state.place = place;
    store.remember(settings, place);
    map.showPin([place.lon, place.lat]);
    useRoute(nav, route);
    toast(t('routesTo', { name: place.name }));
  } catch {
    if (state.nav === nav) toast(t('noRoute'));
  }
}

async function reroute(fix) {
  const nav = state.nav;
  if (nav.rerouting || Date.now() - nav.lastReroute < 8000) {
    nav.navigator.resetOffRoute();
    return;
  }
  nav.rerouting = true;
  nav.lastReroute = Date.now();
  toast(t('rerouting'));
  try {
    const [route] = await planRoutes([fix.lon, fix.lat], [nav.dest.lon, nav.dest.lat], {
      avoidTolls: settings.avoidTolls,
      avoidHighways: settings.avoidHighways,
      heading: fix.heading,
      liveTraffic: state.backend.traffic,
    });
    if (state.nav !== nav) return;
    useRoute(nav, route);
  } catch {
    if (state.nav === nav) {
      toast(t('rerouteFailed'));
      nav.navigator.resetOffRoute();
    }
  } finally {
    nav.rerouting = false;
  }
}

async function refreshReports() {
  if (!state.backend.reports) return;
  const nav = state.nav;
  try {
    const box = nav ? bbox(nav.route.coords) : map.bounds();
    if (box[2] - box[0] > 8 || box[3] - box[1] > 8) return;
    const reports = await fetchReports(box);
    map.setReports(reports);
    if (nav && state.nav === nav) {
      nav.reports = reports;
      nav.pois = [...nav.basePois, ...reportPois(nav.route, reports)];
      nav.navigator.setPois(nav.pois);
    }
  } catch {}
}

function showReportPopup(report) {
  const node = document.createElement('div');
  node.className = 'report-popup';
  node.innerHTML = `<b>${REPORT_ICON[report.kind] || '⚠️'} ${esc(t(report.kind))}</b>
    <small class="muted">${esc(fmtAgo(report.age ?? 0))}</small>
    <span>${esc(t('stillThere'))}</span>
    <span class="actions"><button class="btn primary" data-up="1">${esc(t('yes'))}</button><button class="btn" data-up="0">${esc(t('gone'))}</button></span>`;
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat([report.lon, report.lat]).setDOMContent(node).addTo(map.map);
  node.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-up]');
    if (!button) return;
    popup.remove();
    try {
      await voteReport(report.id, button.dataset.up === '1');
      toast(t('voted'));
      refreshReports();
    } catch {
      toast(t('reportFailed'));
    }
  });
}

async function sendReport(kind) {
  $('dlg-report').close();
  const fix = state.fix;
  if (!fix) return toast(t('reportNeedsFix'));
  try {
    const res = await postReport({ kind, lon: fix.lon, lat: fix.lat, heading: Number.isFinite(fix.heading) ? fix.heading : null });
    state.myReports.add(res.id);
    toast(t(res.merged ? 'reportMerged' : 'reportSent'));
    refreshReports();
  } catch {
    toast(t('reportFailed'));
  }
}

function handleFix(fix) {
  const prev = state.fix;
  if (prev && !Number.isFinite(fix.heading)) {
    const moved = haversine([prev.lon, prev.lat], [fix.lon, fix.lat]);
    const moving = Number.isFinite(fix.speed) && fix.speed > 2 && moved > Math.max(10, fix.accuracy || 0);
    fix.heading = moving ? bearing([prev.lon, prev.lat], [fix.lon, fix.lat]) : prev.heading;
  }
  state.fix = fix;
  if (state.nav) return navTick(fix);
  map.setUser([fix.lon, fix.lat], fix.heading, false);
  if (!state.centered && state.mode === 'home') {
    state.centered = true;
    map.flyTo([fix.lon, fix.lat], 14);
  }
}

function startGps() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      const fix = {
        lon: c.longitude,
        lat: c.latitude,
        accuracy: c.accuracy,
        speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
        heading: Number.isFinite(c.heading) && c.heading >= 0 && c.speed > 1 ? c.heading : null,
        time: pos.timestamp,
      };
      if (state.nav?.simulated) state.realFix = fix;
      else handleFix(fix);
    },
    (err) => {
      if (err.code === 1) toast(t('locationDenied'));
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
  );
}

function fillSettings() {
  $('set-lang').value = settings.lang;
  $('set-voice').checked = settings.voice;
  $('set-night').value = settings.night;
  $('set-3d').checked = settings.threeD;
  $('set-traffic').checked = settings.traffic;
  $('set-tolls').checked = settings.avoidTolls;
  $('set-highways').checked = settings.avoidHighways;
  const voices = voice.available();
  $('set-voice-name').innerHTML =
    `<option value="">${esc(t('voiceAuto'))}</option>` +
    voices.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  $('set-voice-name').value = voices.some((v) => v.voiceURI === settings.voiceURI) ? settings.voiceURI : '';
  $('install-steps').hidden = !installSteps || installed();
  if (installSteps) $('install-steps').innerHTML = `<b>${esc(t('installTitle'))}</b><br>${installStepsText()}`;
  $('app-version').textContent = state.version ? t('version', { v: state.version.release, build: state.version.build }) : '';
}

async function promptInstall() {
  const prompt = state.installPrompt;
  if (!prompt) return;
  state.installPrompt = null;
  $('btn-install').hidden = true;
  prompt.prompt();
  await prompt.userChoice.catch(() => null);
  render();
}

function changeSetting(key, value) {
  settings[key] = value;
  if (key === 'night') settings.nightChosen = true;
  store.save(settings);
  if (key === 'lang') {
    setLang(value);
    voice.configure({ lang: value });
    if (state.nav) state.nav.navigator.lang = value;
    applyTexts();
    fillSettings();
    render();
  }
  if (key === 'voice') voice.configure({ enabled: value });
  if (key === 'voiceURI') voice.configure({ voiceURI: value });
  if (key === 'night') setTheme();
  if (key === 'threeD') {
    map.set3D(value);
    if (!state.nav) map.map.easeTo({ pitch: value ? 55 : 0, duration: 500 });
  }
  if (key === 'traffic') map.setTraffic(value && state.backend.traffic);
  if ((key === 'avoidTolls' || key === 'avoidHighways') && state.mode === 'routes') plan();
}

function bindUi() {
  $('btn-settings').innerHTML = UI.menu;
  $('btn-clear').innerHTML = UI.close;
  $('btn-locate').innerHTML = UI.locate;
  $('btn-report').innerHTML = UI.report;
  document.querySelector('.search-icon').innerHTML = UI.search;
  for (const button of document.querySelectorAll('.dialog-head .icon-btn')) button.innerHTML = UI.close;

  let timer = null;
  $('q').addEventListener('focus', () => {
    document.body.classList.add('searching');
    $('btn-clear').hidden = false;
    measureSheet();
  });
  $('q').addEventListener('input', () => {
    clearTimeout(timer);
    const query = $('q').value.trim();
    if (query.length < 2) return hideResults();
    const local = localMatches(query);
    const cached = searchCache.get(cacheKey(query));
    if (cached) return showMerged(local, cached, 'noResults');
    if (local.length) showResults([...local, { msg: t('searching') }]);
    timer = setTimeout(() => runSearch(query), 200);
  });
  $('q').addEventListener('keydown', (e) => e.key === 'Escape' && endSearch());
  map.map.on('click', () => document.body.classList.contains('searching') && endSearch());
  $('searchbox').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = $('q').value.trim();
    if (query) runSearch(query);
  });
  $('results').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-i]');
    if (!button) return;
    const place = $('results').items[Number(button.dataset.i)];
    if (!state.nav) return selectPlace(place);
    endSearch();
    changeDestination(place);
  });
  $('btn-clear').addEventListener('click', () => {
    $('q').value = '';
    endSearch();
  });
  $('btn-settings').addEventListener('click', () => {
    fillSettings();
    $('dlg-settings').showModal();
  });
  $('set-lang').addEventListener('change', (e) => changeSetting('lang', e.target.value));
  $('set-voice').addEventListener('change', (e) => changeSetting('voice', e.target.checked));
  $('set-voice-name').addEventListener('change', (e) => changeSetting('voiceURI', e.target.value));
  $('set-night').addEventListener('change', (e) => changeSetting('night', e.target.value));
  $('set-3d').addEventListener('change', (e) => changeSetting('threeD', e.target.checked));
  $('set-traffic').addEventListener('change', (e) => changeSetting('traffic', e.target.checked));
  $('set-tolls').addEventListener('change', (e) => changeSetting('avoidTolls', e.target.checked));
  $('set-highways').addEventListener('change', (e) => changeSetting('avoidHighways', e.target.checked));
  $('set-voice-test').addEventListener('click', () => {
    voice.unlock();
    voice.say([{ text: t('voiceTest'), priority: 2 }], { force: true });
  });
  $('btn-install').addEventListener('click', promptInstall);

  $('btn-locate').addEventListener('click', () => {
    if (state.nav) {
      state.following = true;
      $('btn-recenter').hidden = true;
      map.setFollow(true);
    } else if (state.fix) map.flyTo([state.fix.lon, state.fix.lat], 15);
    else toast(t('locationUnavailable'));
  });
  $('btn-recenter').addEventListener('click', () => $('btn-locate').click());
  $('btn-sound').addEventListener('click', toggleVoice);
  $('alert').addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-vote]');
    if (!button) return;
    $('alert').hidden = true;
    try {
      await voteReport($('alert').dataset.report, button.dataset.vote === '1');
      toast(t('voted'));
      refreshReports();
    } catch (err) {
      toast(t(err.status === 409 ? 'voted' : 'reportFailed'));
    }
  });
  let swipeFrom = null;
  $('sheet').addEventListener('pointerdown', (e) => {
    swipeFrom = state.mode === 'nav' ? e.clientY : null;
  });
  window.addEventListener('pointerup', (e) => {
    if (swipeFrom == null) return;
    const dy = e.clientY - swipeFrom;
    swipeFrom = null;
    const more = $('nav-more');
    if (more && ((dy < -30 && more.hidden) || (dy > 30 && !more.hidden))) {
      state.swipedAt = Date.now();
      toggleMore();
    }
  });
  $('btn-report').addEventListener('click', () => (state.fix ? $('dlg-report').showModal() : toast(t('reportNeedsFix'))));
  $('report-grid').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-kind]');
    if (button) sendReport(button.dataset.kind);
  });

  $('sheet').addEventListener('change', (e) => {
    const action = e.target.dataset.action;
    if (action === 'avoid-tolls') changeSetting('avoidTolls', e.target.checked);
    if (action === 'avoid-highways') changeSetting('avoidHighways', e.target.checked);
  });
  $('sheet').addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || target.tagName === 'INPUT') return;
    const i = Number(target.dataset.i);
    switch (target.dataset.action) {
      case 'saved':
        return settings[target.dataset.key] ? selectPlace(settings[target.dataset.key]) : toast(t('setHint'));
      case 'recent':
        return selectPlace(settings.recents[i]);
      case 'close':
        return state.mode === 'routes' ? (map.clearRoutes(), (state.mode = 'place'), render()) : goHome();
      case 'directions':
        return plan();
      case 'set-home':
      case 'set-work':
        changeSetting(target.dataset.action === 'set-home' ? 'home' : 'work', { ...state.place });
        return toast(t('saved'));
      case 'share-place':
        return share(state.place.name, placeUrl(state.place));
      case 'install':
        return promptInstall();
      case 'install-later':
        if (state.mode === 'arrived') state.installAfterTrip = false;
        else changeSetting('installDismissed', true);
        return render();
      case 'route':
        return selectRoute(i);
      case 'start':
        return startNav(false);
      case 'demo':
        return startNav(true);
      case 'end':
        return finishNav(false);
      case 'mute':
        return toggleVoice();
      case 'nav-search':
        state.navSearch = true;
        render();
        return $('q').focus();
      case 'more':
        if (Date.now() - (state.swipedAt || 0) < 400) return;
        return toggleMore();
      case 'overview':
        state.following = false;
        map.setFollow(false);
        $('btn-recenter').hidden = false;
        return map.fit(state.nav.route.coords, sheetPadding());
      case 'share-eta': {
        const progress = state.nav.navigator.progress();
        const eta = fmtClock(new Date(Date.now() + progress.remainingTime * 1000));
        return share(t('shareText', { name: state.nav.dest.name, eta }), placeUrl(state.nav.dest));
      }
    }
  });

  let moveTimer = null;
  map.map.on('moveend', () => {
    if (state.nav || !state.backend.reports || map.map.getZoom() < 9) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(refreshReports, 600);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      if (state.updateReady && !state.nav) location.reload();
      return;
    }
    setTheme();
    if (state.nav) acquireWakeLock();
  });
  new ResizeObserver(measureSheet).observe($('sheet'));
  window.addEventListener('resize', measureSheet);
  window.addEventListener('offline', () => toast(t('offline')));
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    $('btn-install').hidden = false;
    if (state.mode === 'home') render();
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    $('btn-install').hidden = true;
    render();
  });
  setInterval(setTheme, 5 * 60 * 1000);
}

function openFromUrl() {
  const params = new URLSearchParams(location.search);
  const to = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(params.get('to') || '');
  if (!to) return;
  const lat = Number(to[1]);
  const lon = Number(to[2]);
  selectPlace({ name: params.get('n') || `${lat}, ${lon}`, sub: '', lon, lat });
}

applyTexts();
setTheme();
bindUi();
render();
startGps();
openFromUrl();
fetch('data/pois.json')
  .then((r) => r.json())
  .then((data) => (state.poiData = data))
  .catch(() => {});
health().then((backend) => {
  state.backend = backend;
  $('row-traffic').hidden = !backend.traffic;
  if (backend.traffic && settings.traffic) map.setTraffic(true);
  map.ready.then(refreshReports);
});
if ('serviceWorker' in navigator) {
  const sw = navigator.serviceWorker;
  const updating = !!sw.controller;
  sw.addEventListener('controllerchange', () => (state.updateReady = updating));
  sw.addEventListener('message', (e) => {
    if (e.data?.release) state.version ??= e.data;
  });
  sw.register('sw.js').catch(() => {});
  if (sw.controller) sw.controller.postMessage('version');
  else sw.ready.then((reg) => reg.active?.postMessage('version'));
}
