import { reportError } from './errors.js';
import { KL, MapView, SIGNAL_ZOOM } from './map.js';
import { fmtAgo, fmtClock, fmtDistance, fmtDuration, getLang, setLang, t } from './i18n.js';
import { nearbyPlaces, reversePlace, searchPlaces, withBranchNames } from './search.js';
import { detourTimes, fasterRoute, loadLanes, pickFaster, planRoutes } from './routing.js';
import { Navigator, SPEEDING_MARGIN, timeLeft } from './navigator.js';
import { bannerOf, maneuverIcon, roadName } from './instructions.js';
import { fuelAlongRoute, poisAlongRoute, reportPois, summarize, trafficPois } from './pois.js';
import { attachFares, fareGroups, fareKeys, fetchFares, priceRoute } from './fares.js';
import { bbox, bearing, haversine, locate, pointAt } from './geo.js';
import { REPORT_ICON, REPORT_KINDS, fetchReports, health, postReport, voteReport } from './reports.js';
import { simulate } from './sim.js';
import { MANEUVER, UI, laneIcon } from './icons.js';
import { BUILD, RELEASE } from './version.js';
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
  backend: { traffic: false, reports: false, fares: false, search: false, places: false },
  poiData: null,
  nav: null,
  following: true,
  wakeLock: null,
  installPrompt: null,
  centered: false,
  alertTimer: null,
  toastTimer: null,
  myReports: new Set(),
  backendKnown: false,
  commute: {},
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
const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|MicroMessenger|TikTok/i.test(navigator.userAgent);
const installGuide = inAppBrowser
  ? 'inapp'
  : isIOS
    ? /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent) ? 'iosOther' : 'ios'
    : isMacSafari
      ? 'mac'
      : /Android/i.test(navigator.userAgent)
        ? 'android'
        : null;
const GUIDE_STEPS = {
  ios: ['stepIosShare', 'stepAddHome', 'stepAdd'],
  iosOther: ['stepBarShare', 'stepAddHome', 'stepAdd'],
  android: ['stepMenu', 'stepInstall', 'stepConfirm'],
  mac: ['stepMacShare', 'stepDock', 'stepMacAdd'],
  inapp: ['stepOpenBrowser'],
};
const canInstall = () => !installed() && (!!state.installPrompt || !!installGuide);
const offerInstall = () => canInstall() && (onPhone() || isMacSafari || !!state.installPrompt);
const installSnoozed = () => settings.installSnoozedUntil > Date.now();

const isNight = () => {
  if (settings.night !== 'auto') return settings.night === 'night';
  const h = new Date().getHours();
  return h >= 19 || h < 7;
};

const TRAFFIC_EVERY = 5 * 60000;
const OFFER_MS = 20000;
const QUIET_AFTER_CHANGE = 2 * 60000;
const QUIET_AFTER_DECLINE = 10 * 60000;
const SPEEDING_TONES = [1175];
const PARKING_AT = 1000;
const PARKING_WITHIN = 800;
const PARKING_MS = 30000;
const PARKING_DEST = /park|letak kereta|停车/i;
const COMMUTE_TTL = 10 * 60000;
const COMMUTE_HERE = 300;
const COMMUTE_ACCURACY = 1000;
const STOP_REACHED = 50;
const FUEL_CANDIDATES = 10;
const FUEL_MAX_DETOUR = 600;

const map = createMap();
window.sembilan = { map, state, checkTraffic: () => state.nav && checkTraffic(state.nav) };

function createMap() {
  try {
    return new MapView($('map'), {
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
      onStationClick: ({ name, lon, lat, kind }) => {
        const sub = t(kind === 'fuel' ? 'catFuel' : 'catEv');
        if (state.mode === 'nav' && !state.nav?.alts) return openStopMenu({ name: name || sub, sub, lon, lat });
        if (state.mode !== 'home' && state.mode !== 'place') return;
        selectPlace({ name: name || sub, sub, lon, lat });
      },
      onReportClick: showReportPopup,
    });
  } catch (err) {
    reportError(err);
    return null;
  }
}

function setTheme() {
  const night = isNight();
  document.documentElement.dataset.theme = night ? 'night' : 'day';
  document.querySelector('meta[name="theme-color"]').content = night ? '#0f1729' : '#eef1f4';
  map?.setNight(night);
}

const PRIVACY_SECTIONS = ['Account', 'Phone', 'Trips', 'Reports', 'Errors', 'Hosting'];

function applyTexts() {
  document.documentElement.lang = getLang();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
    node.title = t(node.dataset.i18nLabel);
  }
  $('privacy-body').innerHTML = PRIVACY_SECTIONS.map((k) => `<h3>${esc(t(`privacy${k}Title`))}</h3><p>${esc(t(`privacy${k}`))}</p>`).join('');
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
  body.innerHTML = { home: homeSheet, place: placeSheet, routes: routesSheet, nav: () => (state.nav?.alts ? altsSheet() : navSheet()), arrived: arrivedSheet }[state.mode]();
  if (state.mode === 'nav' && state.nav && state.fix) updateNavSheet(state.nav.navigator.progress(), state.fix);
  document.body.classList.toggle('nav-alts', !!state.nav?.alts);
  $('finder').hidden = !(state.mode === 'home' || state.navSearch);
  document.body.classList.toggle('nav-search', !!state.navSearch);
  if (state.mode !== renderedMode) {
    renderedMode = state.mode;
    body.classList.remove('enter');
    void body.offsetWidth;
    body.classList.add('enter');
  }
  syncSlide();
}

function measureSheet() {
  const sheet = $('sheet');
  const height = !sheet.hidden && window.innerWidth < 900 ? sheet.offsetHeight - slide.offset : 0;
  document.documentElement.style.setProperty('--sheet-h', `${height}px`);
}

function measureBanner() {
  const bottom = window.innerWidth < 900 ? $('banner').getBoundingClientRect().bottom : 0;
  if (bottom > 0) document.documentElement.style.setProperty('--banner-bottom', `${bottom}px`);
  else document.documentElement.style.removeProperty('--banner-bottom');
}

const slide = { offset: 0, max: 0, from: null, base: 0, moved: false, lastY: 0, lastT: 0, speed: 0, raf: 0 };

const homeSlides = () => state.mode === 'home' && !document.body.classList.contains('searching') && window.innerWidth < 900;

function collapseDistance() {
  const sheet = $('sheet');
  const finder = $('finder');
  const padding = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
  return Math.max(0, sheet.offsetHeight - (finder.offsetTop + finder.offsetHeight) - padding);
}

function setSlide(offset) {
  slide.offset = offset;
  const body = $('sheet-body');
  $('sheet').style.transform = offset ? `translateY(${offset}px)` : '';
  body.style.opacity = offset && slide.max ? String(Math.max(0, 1 - (offset / slide.max) * 1.4)) : '';
  body.style.pointerEvents = offset && offset >= slide.max - 1 ? 'none' : '';
  measureSheet();
}

function fitHomeList() {
  const classes = document.body.classList;
  if (classes.contains('searching')) return;
  classes.remove('home-scrolls');
  if (state.mode !== 'home') return;
  const sheet = $('sheet');
  const body = $('sheet-body');
  const padding = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
  classes.toggle('home-scrolls', body.offsetTop + body.offsetHeight + padding > sheet.clientHeight + 1);
}

function syncSlide() {
  fitHomeList();
  cancelAnimationFrame(slide.raf);
  slide.raf = 0;
  slide.max = homeSlides() ? collapseDistance() : 0;
  setSlide(slide.max && settings.sheetCollapsed ? slide.max : 0);
}

function animateSlide(to) {
  cancelAnimationFrame(slide.raf);
  const from = slide.offset;
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / 260);
    setSlide(from + (to - from) * (1 - (1 - k) ** 3));
    slide.raf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  slide.raf = requestAnimationFrame(step);
}

function collapseHome(collapsed) {
  if (!homeSlides()) return;
  if (settings.sheetCollapsed !== collapsed) changeSetting('sheetCollapsed', collapsed);
  slide.max = collapseDistance();
  animateSlide(collapsed ? slide.max : 0);
}

function commuteText(key) {
  const time = state.commute[key]?.time;
  return time != null ? fmtDuration(time) : '';
}

function shortcut(key) {
  const place = settings[key];
  return `<button class="shortcut" data-action="saved" data-key="${key}">
      <span class="shortcut-icon">${key === 'home' ? '🏠' : '💼'}</span>
      <span><b>${esc(t(key))}</b><small><em class="commute">${esc(place ? commuteText(key) : '')}</em>${esc(place ? place.name : t('notSet'))}</small></span>
    </button>`;
}

function refreshCommute() {
  if (state.mode !== 'home' || !state.fix || !state.backendKnown || state.fix.accuracy > COMMUTE_ACCURACY) return;
  const from = [state.fix.lon, state.fix.lat];
  for (const key of ['home', 'work']) {
    const place = settings[key];
    const old = state.commute[key];
    if (!place || haversine(from, [place.lon, place.lat]) < COMMUTE_HERE) {
      if (old) {
        delete state.commute[key];
        showCommute(key);
      }
      continue;
    }
    if (old && old.key === routeKey(place) && Date.now() - old.at < COMMUTE_TTL && haversine(old.from, from) < 500) continue;
    const entry = { key: routeKey(place), from, at: Date.now(), time: old?.time ?? null, promise: planRoutes(from, [place.lon, place.lat], routeOptions()) };
    state.commute[key] = entry;
    entry.promise
      .then((routes) => {
        entry.time = Math.min(...routes.map((r) => r.duration));
        if (state.commute[key] === entry) showCommute(key);
      })
      .catch(() => {});
  }
}

function showCommute(key) {
  const node = document.querySelector(`.shortcut[data-key="${key}"] .commute`);
  if (node) node.textContent = commuteText(key);
}

function installCard() {
  return `<div class="install-cta">
      <button class="install-close" type="button" data-action="install-later" aria-label="${esc(t('notNow'))}">${UI.close}</button>
      <div class="install-head"><img src="icons/icon-192.png" alt="" width="52" height="52"><div><b>${esc(t('installTitle'))}</b><small>${esc(t('installPitch'))}</small></div></div>
      <button class="btn install-go" type="button" data-action="install">${UI.download}${esc(t('install'))}</button>
    </div>`;
}

function guideStep(key) {
  const icon = (svg) => `<span class="inline-icon">${svg}</span>`;
  return esc(t(key, { share: '{share}', add: '{add}', menu: '{menu}' }))
    .replace('{share}', icon(UI.iosShare))
    .replace('{add}', icon(UI.addSquare))
    .replace('{menu}', icon(UI.kebab));
}

function openInstallGuide() {
  const steps = GUIDE_STEPS[installGuide] || [];
  $('install-guide').innerHTML = steps.map((k, i) => `<li><span class="step-n">${i + 1}</span><span>${guideStep(k)}</span></li>`).join('');
  $('install-copy').hidden = installGuide !== 'inapp';
  $('dlg-install').showModal();
}

function startInstall() {
  if (state.installPrompt) return promptInstall();
  if (installGuide) openInstallGuide();
}

function homeSheet() {
  const recents = settings.recents
    .slice(0, 3)
    .map(
      (p, i) =>
        `<div class="list-row"><button class="list-item" data-action="recent" data-i="${i}"><span class="li-icon">🕘</span><span><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></span></button><button class="icon-btn" data-action="recent-menu" data-i="${i}" aria-label="${esc(t('more'))}">${UI.more}</button></div>`,
    )
    .join('');
  const install = offerInstall() && !installSnoozed() ? installCard() : '';
  const shown = state.showAllSaved ? settings.saved : settings.saved.slice(0, 5);
  const saved = shown
    .map((s, i) => `<button class="list-item" data-action="fav" data-i="${i}"><span class="li-icon">⭐</span><span><b>${esc(s.label)}</b><small>${esc(s.label !== s.name ? s.name : s.sub)}</small></span></button>`)
    .join('');
  const more = shown.length < settings.saved.length ? `<button class="list-more" data-action="fav-all">${esc(t('showAll', { n: settings.saved.length }))}</button>` : '';
  const noMap = map ? '' : `<div class="notice"><b>${esc(t('noMapTitle'))}</b><span>${esc(t('noMapText'))}</span></div>`;
  return `${noMap}${install}<div class="shortcuts">${shortcut('home')}${shortcut('work')}</div>${saved ? `<h3 class="label">${esc(t('savedPlaces'))}</h3>${saved}${more}` : ''}${
    recents ? `<h3 class="label">${esc(t('recent'))}</h3>${recents}` : saved || !map ? '' : `<p class="muted hint small">${esc(t('hint'))}</p>`
  }`;
}

function placeSheet() {
  const p = state.place;
  return `<div class="place-head">
      <div><h2>${esc(p.name)}</h2><p class="muted">${esc(p.sub)}</p></div>
      <button class="icon-btn" data-action="close" aria-label="${esc(t('close'))}">${UI.close}</button>
    </div>
    ${map ? `<button class="btn primary big block" data-action="directions">${esc(t('directions'))}${state.placeEta ? ` · ${esc(fmtDuration(state.placeEta))}` : ''}</button>` : handoff(p)}
    <div class="quick-actions">
      <button class="quick" data-action="set-home"><span>🏠</span>${esc(t('setHome'))}</button>
      <button class="quick" data-action="set-work"><span>💼</span>${esc(t('setWork'))}</button>
      ${store.findSaved(settings, p) ? `<button class="quick on" data-action="save-place"><span>★</span>${esc(t('saved'))}</button>` : `<button class="quick" data-action="save-place"><span>☆</span>${esc(t('save'))}</button>`}
      <button class="quick" data-action="share-place"><span>${UI.share}</span>${esc(t('share'))}</button>
    </div>`;
}

function handoff(p) {
  const at = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const link = (app, href, cls) => `<a class="btn big ${cls}" href="${href}" target="_blank" rel="noopener">${app}</a>`;
  return `<p class="muted small handoff-label">${esc(t('navigateWith'))}</p><div class="handoff">${link('Waze', `https://waze.com/ul?ll=${at}&amp;navigate=yes`, 'primary')}${link('Google Maps', `https://www.google.com/maps/dir/?api=1&amp;destination=${at}`, '')}</div>`;
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

const TRAFFIC_COLOR = ['#f5b301', '#f5b301', '#f08c00', '#e03131', '#a61e1e'];

function trafficStrip(route, from) {
  const span = route.distance - from;
  if (route.provider !== 'tomtom' || span <= 0) return '';
  const bars = route.traffic
    .filter((x) => x.to > from)
    .map((x) => {
      const left = (Math.max(0, x.from - from) / span) * 100;
      const width = Math.max(1.5, ((x.to - Math.max(x.from, from)) / span) * 100);
      return `<i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:${TRAFFIC_COLOR[x.magnitude] || TRAFFIC_COLOR[2]}"></i>`;
    })
    .join('');
  return `<span class="alt-strip">${UI.navArrow}<span>${bars}</span></span>`;
}

function altCard(alt, i, current) {
  const diff = current.time - alt.time;
  const diffTag = alt.current ? '' : Math.abs(diff) < 60 ? '' : `<span class="tag ${diff > 0 ? 'good' : ''}">${esc(diff > 0 ? t('faster', { d: fmtDuration(diff) }) : t('slower', { d: fmtDuration(-diff) }))}</span>`;
  const price = state.nav.alts.prices?.[i];
  const toll = price?.priced ? `<span class="tag fare">${esc(t('fare', { amount: price.total.toFixed(2) }))}</span>` : alt.toll ? `<span class="tag toll">${esc(t('tolled'))}</span>` : '';
  return `<div class="alt-card${alt.current ? ' current' : ''}">
      <div class="alt-top">
        <div><b>${esc(fmtDuration(alt.time))}</b><small>${esc(fmtClock(new Date(Date.now() + alt.time * 1000)))} · ${esc(fmtDistance(alt.dist))}</small></div>
        <button class="btn primary" data-action="${alt.current ? 'alts-close' : 'alts-go'}" data-i="${i}">${UI.navArrow}${esc(t(alt.current ? 'resume' : 'go'))}</button>
      </div>
      ${alt.via.length ? `<span class="rc-via">${esc(t('via', { road: alt.via.join(' · ') }))}</span>` : ''}
      ${diffTag || toll ? `<span class="rc-tags">${diffTag}${toll}</span>` : ''}
      ${trafficStrip(alt.route, alt.from)}
    </div>`;
}

function altsSheet() {
  const alts = state.nav.alts;
  const head = `<div class="place-head"><div><h2>${esc(t('routes'))}</h2></div><button class="icon-btn" data-action="alts-close" aria-label="${esc(t('close'))}">${UI.close}</button></div>`;
  if (!alts.list) return `${head}<div class="route-list">${'<div class="route-card skeleton" aria-hidden="true"><span></span><span></span><span></span></div>'.repeat(3)}</div>`;
  const current = alts.list[0];
  const note = alts.list.length === 1 ? `<p class="muted small">${esc(t(alts.failed ? 'noRoute' : 'noAlternatives'))}</p>` : '';
  return `${head}<div class="route-list">${alts.list.map((a, i) => altCard(a, i, current)).join('')}</div>${note}`;
}

function followsRoute(candidate, base, from) {
  return [0.2, 0.5, 0.8].every((f) => {
    const p = pointAt(candidate.coords, candidate.cum, candidate.distance * f);
    const hit = locate(base.coords, base.cum, p);
    return hit.dist < 60 && hit.along >= from - 100;
  });
}

async function openAlternatives() {
  const nav = state.nav;
  const fix = state.fix;
  if (!nav || !fix) return toast(t('needLocation'));
  clearOffer(nav);
  const progress = nav.navigator.progress();
  const route = nav.route;
  const current = {
    current: true,
    route,
    from: progress.along,
    time: remainingTime(nav, progress),
    dist: progress.remaining,
    via: route.via,
    toll: route.tollSections.some(([, end]) => end > progress.along),
  };
  const alts = (nav.alts = { list: null });
  if (!$('nav-more').hidden) toggleMore();
  render();
  try {
    const routes = await planRoutes([fix.lon, fix.lat], [nav.dest.lon, nav.dest.lat], driveOptions(nav, fix));
    if (nav.alts !== alts) return;
    const others = routes
      .filter((r) => !followsRoute(r, route, progress.along))
      .sort((a, b) => a.duration - b.duration)
      .map((r) => ({ route: r, from: 0, time: r.duration, dist: r.distance, via: r.via, toll: r.hasToll }));
    alts.list = [current, ...others];
    drawNavRoutes(nav);
    render();
    if (state.backend.fares && others.length) {
      const pois = others.map((o) => poisAlongRoute(o.route, state.poiData));
      loadPrices(others.map((o) => o.route), pois).then((prices) => {
        if (nav.alts !== alts) return;
        alts.prices = [null, ...prices];
        render();
      });
    }
  } catch {
    if (nav.alts !== alts) return;
    alts.list = [current];
    alts.failed = true;
    render();
  }
}

function closeAlternatives() {
  if (!state.nav?.alts) return;
  state.nav.alts = null;
  drawNavRoutes(state.nav);
  render();
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
      <div class="nav-actions">
        <button class="tile" data-action="alts">${UI.routes}<span>${esc(t('routes'))}</span></button>
        <button class="tile" data-action="overview">${UI.route}<span>${esc(t('overview'))}</span></button>
        <button class="tile" data-action="mute">${soundTile()}</button>
        <button class="tile" data-action="share-eta">${UI.share}<span>${esc(t('share'))}</span></button>
      </div>
      <button class="btn end-trip" data-action="end">${UI.close}<span>${esc(t('endTrip'))}</span></button>
    </div>
    <div id="nav-stop" class="nav-stop" hidden>${UI.pin}<span id="nav-stop-text"></span><button class="icon-btn" type="button" data-action="remove-stop" aria-label="${esc(t('removeStop'))}">${UI.close}</button></div>
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
  syncSlide();
}

function showResults(items) {
  const ul = $('results');
  ul.items = items;
  ul.innerHTML = items
    .map((p, i) =>
      p.msg
        ? `<li class="msg">${esc(p.msg)}</li>`
        : `<li${p.local && !p.tag ? ' class="has-menu"' : ''}><button type="button" data-i="${i}"><span><b>${p.local ? `${{ home: '🏠', work: '💼', saved: '⭐' }[p.tag] || '🕘'} ` : ''}${esc(p.name)}</b><small>${esc(p.sub)}</small></span>${Number.isFinite(p.dist) ? `<em>${esc(fmtDistance(p.dist))}</em>` : ''}</button>${p.local && !p.tag ? `<button class="icon-btn" type="button" data-menu="${i}" aria-label="${esc(t('more'))}">${UI.more}</button>` : ''}</li>`,
    )
    .join('');
  ul.hidden = false;
  document.body.classList.add('has-results');
}

const searchCache = new Map();
const cacheKey = (query) => `${getLang()}|${query.toLowerCase()}`;

function localMatches(query, limit = 3) {
  const q = query.toLowerCase();
  const saved = ['home', 'work'].filter((k) => settings[k]).map((k) => ({ ...settings[k], tag: k }));
  const favs = settings.saved.map((s) => ({ name: s.label, sub: s.label !== s.name ? s.name : s.sub, lon: s.lon, lat: s.lat, tag: 'saved' }));
  const seen = new Set();
  return [...saved, ...favs, ...settings.recents]
    .filter((p) => `${p.name} ${p.sub}`.toLowerCase().includes(q))
    .filter((p) => {
      const key = `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((p) => ({ ...p, local: true }));
}

function showPlaces() {
  const places = localMatches('', Infinity);
  if (places.length) showResults(places);
  else hideResults();
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
    const near = state.fix ? [state.fix.lon, state.fix.lat] : (map?.center() ?? KL);
    const list = await searchPlaces(query, { near, lang: getLang(), signal: ctrl.signal, tomtom: state.backend.search, places: state.backend.places });
    if (ctrl.signal.aborted) return;
    searchCache.set(cacheKey(query), list);
    if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value);
    showMerged(local, list, 'noResults');
  } catch {
    if (!ctrl.signal.aborted) showMerged(local, [], 'searchFailed');
  }
}

const CATEGORY_LABEL = { fuel: 'catFuel', food: 'catFood', parking: 'catParking', ev: 'catEv' };

const detourText = (s) => (s == null ? '' : s < 60 ? t('noDetour') : t('detour', { m: Math.round(s / 60) }));

async function stationsAhead(nav, signal) {
  let stations;
  try {
    state.fuelData ??= fetch('data/fuel.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fuel ${r.status}`))));
    stations = (await state.fuelData).fuel;
  } catch {
    state.fuelData = null;
    return null;
  }
  const route = nav.route;
  const along = nav.navigator.progress().along;
  const list = fuelAlongRoute(route, stations, along).slice(0, FUEL_CANDIDATES);
  let detours = [];
  if (list.length && state.fix) {
    try {
      detours = await detourTimes([state.fix.lon, state.fix.lat], list, route, { ...routeOptions(), heading: state.fix.heading, signal });
    } catch (err) {
      if (signal.aborted) throw err;
    }
  }
  const label = t('catFuel');
  const shown = list
    .map((p, i) => ({ ...p, name: p.name || label, detour: detours[i] ?? null, dist: p.along - along }))
    .filter((p) => p.detour == null || p.detour <= FUEL_MAX_DETOUR);
  return (await withBranchNames(shown)).map((p) => ({ ...p, sub: [detourText(p.detour), p.sub].filter(Boolean).join(' · ') }));
}

async function runNearby(cat) {
  state.searchAbort?.abort();
  const ctrl = (state.searchAbort = new AbortController());
  const label = t(CATEGORY_LABEL[cat]);
  const onRoute = !!state.nav && cat === 'fuel';
  $('q').value = onRoute ? t('onRoute', { cat: label }) : label;
  $('btn-clear').hidden = false;
  document.body.classList.add('searching');
  syncSlide();
  showResults([{ msg: t('searching') }]);
  try {
    const near = state.fix ? [state.fix.lon, state.fix.lat] : (map?.center() ?? KL);
    const ahead = onRoute ? await stationsAhead(state.nav, ctrl.signal) : null;
    const list = ahead || (await nearbyPlaces(cat, { near, signal: ctrl.signal, tomtom: state.backend.search, label }));
    if (ctrl.signal.aborted) return;
    if (onRoute && !ahead) $('q').value = label;
    showResults(list.length ? list : [{ msg: t(ahead ? 'noneAhead' : 'noResults') }]);
  } catch {
    if (!ctrl.signal.aborted) showResults([{ msg: t('searchFailed') }]);
  }
}

const routeKey = (place) => `${place.lon.toFixed(5)},${place.lat.toFixed(5)}|${+settings.avoidTolls}${+settings.avoidHighways}${+state.backend.traffic}`;

function routeOptions() {
  return { avoidTolls: settings.avoidTolls, avoidHighways: settings.avoidHighways, liveTraffic: state.backend.traffic };
}

function driveOptions(nav, fix) {
  const via = nav.stop && !nav.stop.reached ? [nav.stop.lon, nav.stop.lat] : null;
  return { ...routeOptions(), heading: fix.heading, via };
}

function prefetchRoutes(place) {
  state.prefetch = null;
  if (!state.fix) return;
  const from = [state.fix.lon, state.fix.lat];
  const commute = Object.values(state.commute).find((e) => e.key === routeKey(place) && Date.now() - e.at < 120000 && haversine(e.from, from) < 150);
  const entry = commute || { key: routeKey(place), from, at: Date.now(), promise: planRoutes(from, [place.lon, place.lat], routeOptions()) };
  state.prefetch = entry;
  entry.promise
    .then((routes) => {
      if (state.prefetch !== entry || state.mode !== 'place' || state.place !== place) return;
      state.placeEta = Math.min(...routes.map((r) => r.duration));
      render();
    })
    .catch(() => {});
}

function selectPlace(place) {
  state.planAbort?.abort();
  state.place = place;
  state.placeEta = null;
  state.mode = 'place';
  state.routes = [];
  $('q').value = '';
  endSearch();
  render();
  if (!map) return;
  map.clearRoutes();
  map.showPin([place.lon, place.lat]);
  map.flyTo([place.lon, place.lat], 15);
  prefetchRoutes(place);
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
  map?.clearRoutes();
  map?.showPin(null);
  render();
  refreshCommute();
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
    const here = [state.fix.lon, state.fix.lat];
    const fresh = () => planRoutes(here, [dest.lon, dest.lat], { ...routeOptions(), signal: ctrl.signal });
    const pre = state.prefetch;
    const reuse = pre && pre.key === routeKey(dest) && Date.now() - pre.at < 120000 && haversine(pre.from, here) < 150;
    const routes = await (reuse ? pre.promise.catch(fresh) : fresh());
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
    stop: null,
    basePois,
    pois: basePois,
    reports: [],
    navigator: new Navigator(route, { lang: getLang(), pois: basePois }),
    simulated,
    stopSim: null,
    lastReroute: 0,
    rerouting: false,
    reportTimer: null,
    trafficTimer: null,
    fresh: null,
    offer: null,
    routeChangedAt: Date.now(),
    declinedAt: 0,
    parking: route.distance < 2 * PARKING_AT ? { skipped: true } : null,
  };
  fetchNavLanes(state.nav, 0);
  if (!simulated) saveMapAlong(route);
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
  if (state.backend.traffic) {
    const nav = state.nav;
    nav.trafficTimer = setInterval(() => checkTraffic(nav), TRAFFIC_EVERY);
  }
}

function finishNav(arrived) {
  const nav = state.nav;
  if (!nav) return;
  nav.stopSim?.();
  clearInterval(nav.reportTimer);
  clearInterval(nav.trafficTimer);
  clearOffer(nav);
  hideParking(nav);
  map.showStop(null);
  releaseWakeLock();
  if (!arrived) voice.stop();
  state.nav = null;
  if (nav.simulated) state.fix = state.realFix;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  for (const id of ['banner', 'lanes', 'speedo', 'speed-limit', 'btn-sound', 'btn-report', 'btn-recenter', 'alert', 'road-pill']) $(id).hidden = true;
  map.setCallout(null);
  document.body.classList.remove('nav-more-open');
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
  offerUpdate();
  if (state.fix) {
    map.setUser([state.fix.lon, state.fix.lat], state.fix.heading, false);
    map.flyTo([state.fix.lon, state.fix.lat], 15);
  }
}

function updateBanner(progress) {
  const step = progress.next;
  $('man-icon').innerHTML = MANEUVER[maneuverIcon(step)] || MANEUVER.straight;
  $('man-dist').textContent = progress.nextDistance < 15 ? t('now') : fmtDistance(progress.nextDistance);
  const { text, shield, sign } = bannerOf(step, getLang());
  $('man-text').innerHTML = (shield ? `<span class="shield">${esc(shield)}</span> ` : '') + esc(text);
  $('man-sign').hidden = !sign;
  if (sign) {
    const badges = `${sign.exit ? `<span class="sign-exit">${esc(t('exitSign', { n: sign.exit }))}</span>` : ''}${sign.ref ? `<span class="shield">${esc(sign.ref)}</span>` : ''}`;
    $('man-sign').innerHTML = `${badges}<b>${esc(sign.toward.join(' · '))}</b>`;
  }
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
  if (key >= 0) $('lanes').innerHTML = lanes.map((l) => `<span>${laneIcon(l)}</span>`).join('');
}

function updateNavSheet(progress, fix) {
  const eta = $('nav-eta');
  if (!eta) return;
  const left = remainingTime(state.nav, progress);
  eta.textContent = fmtClock(new Date(Date.now() + left * 1000));
  $('nav-left').textContent = `${fmtDuration(left)} · ${fmtDistance(progress.remaining)}`;
  const stop = state.nav.stop;
  $('nav-stop').hidden = !stop || stop.reached;
  if (!$('nav-stop').hidden) {
    const at = state.nav.route.steps.find((s) => s.kind === 'waypoint');
    $('nav-stop-text').textContent = [stop.name, at && fmtDistance(Math.max(0, at.along - progress.along))].filter(Boolean).join(' · ');
  }
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
  $('speedo').classList.toggle('over', !!limit && kmh > limit + SPEEDING_MARGIN);
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
  if (out.speeding) voice.chime(SPEEDING_TONES);
  out.alerts.forEach(showAlert);
  const progress = out.progress;
  checkStop(nav, progress, fix);
  const position = progress.snapped || [fix.lon, fix.lat];
  map.driveTo(position, fix.heading, fix.speed ?? 0);
  if (!nav.lineAt || (performance.now() - nav.lineAt > 1000 && Math.abs(progress.along - nav.lineAlong) > 20)) drawNavRoutes(nav, progress.along);
  updateBanner(progress);
  if (progress.along > nav.lanesTo - 20000 && nav.lanesTo < nav.route.distance) fetchNavLanes(nav, progress.along);
  updateLanes(progress);
  if (nav.calloutFor !== progress.nextIndex) {
    nav.calloutFor = progress.nextIndex;
    const next = progress.next;
    map.setCallout(nav.route.coords[next.index], next.kind === 'arrive' || next.kind === 'waypoint' ? '' : roadName(next) || next.toward?.[0] || '');
  }
  const road = roadName(nav.route.steps[progress.stepIndex]);
  $('road-pill').textContent = road;
  $('road-pill').hidden = !road;
  updateNavSheet(progress, fix);
  checkParking(nav, progress);
  if (out.offRoute) reroute(fix);
  if (out.arrived) setTimeout(() => finishNav(true), 1500);
}

function drawNavRoutes(nav, along = nav.navigator.progress().along) {
  map.showRoutes([nav.route, ...(nav.alts?.list?.slice(1).map((a) => a.route) || []), ...(nav.offer ? [nav.offer.route] : [])], 0, along);
  nav.lineAt = performance.now();
  nav.lineAlong = along;
}

function useRoute(nav, route) {
  clearOffer(nav);
  nav.fresh = null;
  nav.routeChangedAt = Date.now();
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
  } else saveMapAlong(route);
  if (state.fix) navTick(state.fix);
}

function saveMapAlong(route) {
  if (navigator.connection?.saveData) return;
  const urls = map.tileUrls(route.coords, route.cum);
  if (urls.length) navigator.serviceWorker?.controller?.postMessage({ type: 'save-tiles', urls });
}

function checkParking(nav, progress) {
  if (nav.parking || nav.offer || progress.remaining > PARKING_AT) return;
  const dest = nav.dest;
  if (PARKING_DEST.test(`${dest.name} ${dest.sub}`)) {
    nav.parking = { skipped: true };
    return;
  }
  const parking = (nav.parking = { places: null });
  nearbyPlaces('parking', { near: [dest.lon, dest.lat], tomtom: state.backend.search, label: t('catParking') })
    .then((list) => {
      if (state.nav !== nav || nav.parking !== parking || nav.dest !== dest) return;
      parking.places = list.filter((p) => p.dist <= PARKING_WITHIN).slice(0, 3);
      if (parking.places.length) showParking(nav);
    })
    .catch(() => {});
}

function showParking(nav) {
  const node = $('parking');
  node.style.setProperty('--offer-ms', `${PARKING_MS}ms`);
  node.innerHTML = `<div class="parking-head"><b>🅿️ ${esc(t('parkingNear', { name: nav.dest.name }))}</b><button class="icon-btn" type="button" data-parking="close" aria-label="${esc(t('close'))}">${UI.close}</button></div>
    ${nav.parking.places
      .map(
        (p, i) =>
          `<button class="parking-row" type="button" data-parking="${i}"><span><b>${esc(p.name)}</b><small>${esc(t('fromDest', { d: fmtDistance(p.dist) }))}</small></span><span class="btn primary">${UI.navArrow}${esc(t('go'))}</span></button>`,
      )
      .join('')}
    <i class="offer-timer" aria-hidden="true"></i>`;
  node.hidden = false;
  nav.parkingTimer = setTimeout(() => hideParking(nav), PARKING_MS);
}

function hideParking(nav) {
  clearTimeout(nav.parkingTimer);
  $('parking').hidden = true;
}

function remainingTime(nav, progress) {
  const fresh = nav.fresh;
  if (!fresh) return progress.remainingTime;
  const share = (progress.along - fresh.from) / Math.max(1, nav.route.distance - fresh.from);
  return timeLeft(fresh.route, Math.max(0, Math.min(1, share)) * fresh.route.distance);
}

async function checkTraffic(nav) {
  if (state.nav !== nav || nav.offer || nav.rerouting || nav.checking) return;
  const progress = nav.navigator.progress();
  if (remainingTime(nav, progress) < 300) return;
  const route = nav.route;
  nav.checking = true;
  try {
    const result = await fasterRoute(route, progress.along, { avoidTolls: settings.avoidTolls, avoidHighways: settings.avoidHighways });
    if (state.nav !== nav || nav.route !== route || !result.current) return;
    nav.fresh = { route: result.current, from: progress.along };
    const now = Date.now();
    const quiet = nav.alts || (nav.stop && !nav.stop.reached) || !$('parking').hidden || now - nav.routeChangedAt < QUIET_AFTER_CHANGE || now - nav.declinedAt < QUIET_AFTER_DECLINE || result.current.duration < 600;
    const found = quiet ? null : pickFaster(result);
    if (found) offerFaster(nav, found);
  } catch {
  } finally {
    nav.checking = false;
  }
}

function offerFaster(nav, offer) {
  nav.offer = offer;
  drawNavRoutes(nav);
  const via = offer.route.via?.length ? t('via', { road: offer.route.via.join(' · ') }) : t('fasterTitle');
  const node = $('offer');
  node.style.setProperty('--offer-ms', `${OFFER_MS}ms`);
  node.innerHTML = `<div class="offer-text"><b>${esc(t('faster', { d: fmtDuration(offer.saving) }))}</b><span>${esc(via)}</span></div>
    <button class="btn primary" type="button" data-offer="take">${esc(t('switchRoute'))}</button>
    <button class="btn" type="button" data-offer="keep">${esc(t('keepRoute'))}</button>
    <i class="offer-timer" aria-hidden="true"></i>`;
  node.hidden = false;
  voice.say([{ text: t('fasterSpoken', { m: Math.round(offer.saving / 60) }), priority: 1 }]);
  nav.offerTimer = setTimeout(() => answerOffer(nav, false), OFFER_MS);
}

function clearOffer(nav) {
  clearTimeout(nav.offerTimer);
  const shown = nav.offer;
  nav.offer = null;
  $('offer').hidden = true;
  if (shown) drawNavRoutes(nav);
}

function answerOffer(nav, take) {
  const offer = nav.offer;
  if (!offer || state.nav !== nav) return;
  clearOffer(nav);
  if (!take) {
    nav.declinedAt = Date.now();
    return;
  }
  useRoute(nav, offer.route);
  toast(t('routeChanged'));
}

async function changeDestination(place, parking = false) {
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
    if (!parking) {
      hideParking(nav);
      nav.parking = route.distance < 2 * PARKING_AT ? { skipped: true } : null;
    }
    state.place = place;
    store.remember(settings, place);
    nav.stop = null;
    map.showStop(null);
    map.showPin([place.lon, place.lat]);
    useRoute(nav, route);
    toast(t('routesTo', { name: place.name }));
  } catch {
    if (state.nav === nav) toast(t('noRoute'));
  }
}

async function setStop(place) {
  const nav = state.nav;
  const fix = state.fix;
  if (!nav || !fix) return;
  const old = nav.stop;
  toast(t('rerouting'));
  try {
    const [route] = await planRoutes([fix.lon, fix.lat], [nav.dest.lon, nav.dest.lat], { ...driveOptions(nav, fix), via: place && [place.lon, place.lat] });
    if (state.nav !== nav || nav.stop !== old) return;
    nav.stop = place && { ...place, reached: false };
    map.showStop(place && [place.lon, place.lat]);
    useRoute(nav, route);
    toast(place ? t('stopAdded', { name: place.name }) : t('stopRemoved'));
  } catch {
    if (state.nav === nav) toast(t('noRoute'));
  }
}

function checkStop(nav, progress, fix) {
  const stop = nav.stop;
  if (!stop || stop.reached) return;
  const at = nav.route.steps.find((s) => s.kind === 'waypoint');
  if ((at && progress.along >= at.along - 30) || haversine([fix.lon, fix.lat], [stop.lon, stop.lat]) <= STOP_REACHED) {
    stop.reached = true;
    map.showStop(null);
  }
}

function openStopMenu(place) {
  state.stopTarget = place;
  $('stop-title').textContent = place.name;
  $('stop-sub').textContent = place.sub;
  $('dlg-stop').returnValue = '';
  $('dlg-stop').showModal();
}

function closeStopMenu() {
  const place = state.stopTarget;
  state.stopTarget = null;
  if (!place || !state.nav) return;
  if ($('dlg-stop').returnValue === 'stop') setStop(place);
  if ($('dlg-stop').returnValue === 'dest') changeDestination(place);
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
    const [route] = await planRoutes([fix.lon, fix.lat], [nav.dest.lon, nav.dest.lat], driveOptions(nav, fix));
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
  if (state.mode === 'place' && !state.prefetch) prefetchRoutes(state.place);
  refreshCommute();
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
  $('btn-install').hidden = !canInstall();
  $('app-version').textContent = t('version', { v: RELEASE, build: BUILD });
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

function keepStorage() {
  navigator.storage?.persisted?.().then((kept) => kept || navigator.storage.persist()).catch(() => {});
}

function copyPlaces() {
  if (!settings.home && !settings.work && !settings.recents.length && !settings.saved.length) return toast(t('noPlaces'));
  share(t('placesShareText'), `${location.origin}${location.pathname}#places=${store.exportPlaces(settings)}`);
}

function importPlacesFrom(text) {
  const places = store.readPlaces(text);
  if (!places) return false;
  const n = (places.home ? 1 : 0) + (places.work ? 1 : 0) + places.recents.length + places.saved.length;
  if (!confirm(t('importConfirm', { n }))) return true;
  store.importPlaces(settings, places);
  keepStorage();
  toast(t('placesAdded'));
  if (state.mode === 'home') render();
  return true;
}

function openSaveDialog(place) {
  const saved = store.findSaved(settings, place);
  state.saveTarget = place;
  $('save-title').textContent = t(saved ? 'editSaved' : 'savePlace');
  $('save-name').value = saved ? saved.label : place.name;
  $('save-sub').textContent = [saved && saved.label !== place.name ? place.name : '', place.sub].filter(Boolean).join(' · ');
  $('save-remove').hidden = !saved;
  $('dlg-save').returnValue = '';
  $('dlg-save').showModal();
}

function closeSaveDialog() {
  const place = state.saveTarget;
  state.saveTarget = null;
  const action = $('dlg-save').returnValue;
  if (!place || !action) return;
  if (action === 'save') {
    store.savePlace(settings, place, $('save-name').value);
    keepStorage();
    toast(t('placeSaved'));
  } else if (action === 'remove') {
    store.removeSaved(settings, place);
    toast(t('placeRemoved'));
  }
  render();
}

function openRecentMenu(place) {
  if (!place) return;
  state.recentTarget = place;
  $('recent-title').textContent = place.name;
  $('recent-sub').textContent = place.sub;
  $('dlg-recent').returnValue = '';
  $('dlg-recent').showModal();
}

function closeRecentMenu() {
  const place = state.recentTarget;
  state.recentTarget = null;
  if (!place || $('dlg-recent').returnValue !== 'remove') return;
  store.forget(settings, place);
  toast(t('recentRemoved'));
  render();
  if (document.body.classList.contains('searching')) $('q').dispatchEvent(new Event('input'));
}

function loadSignals() {
  if (state.signals || map.map.getZoom() < SIGNAL_ZOOM - 1) return;
  state.signals = fetch('data/signals.json')
    .then((r) => r.json())
    .then((data) => map.setSignals(data.signals))
    .catch(() => (state.signals = null));
}

function checkForUpdate() {
  navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
}

async function offerUpdate() {
  if (!state.updateReady || state.updateDeclined || state.nav || !$('update').hidden) return;
  let release = '';
  try {
    release = /RELEASE = '([^']+)'/.exec(await (await fetch('src/version.js')).text())?.[1] || '';
  } catch {}
  $('update-text').textContent = t('updateReady', { v: release }).replace('  ', ' ');
  $('update').hidden = false;
}

function changeSetting(key, value) {
  settings[key] = value;
  if (key === 'night') settings.nightChosen = true;
  if (key === 'traffic') settings.trafficChosen = true;
  store.save(settings);
  if (key === 'lang') {
    setLang(value);
    voice.configure({ lang: value });
    if (state.nav) state.nav.navigator.lang = value;
    applyTexts();
    fillSettings();
    render();
  }
  if ((key === 'home' || key === 'work') && value) keepStorage();
  if (key === 'voice') voice.configure({ enabled: value });
  if (key === 'voiceURI') voice.configure({ voiceURI: value });
  if (key === 'night') setTheme();
  if (key === 'threeD' && map) {
    map.set3D(value);
    if (!state.nav) map.map.easeTo({ pitch: value ? 55 : 0, duration: 500 });
  }
  if (key === 'traffic') map?.setTraffic(value && state.backend.traffic);
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
    syncSlide();
  });
  $('q').addEventListener('input', () => {
    clearTimeout(timer);
    const query = $('q').value.trim();
    if (query.includes('#places=') && importPlacesFrom(query)) {
      $('q').value = '';
      return endSearch();
    }
    if (query.length < 2) return state.navSearch ? showPlaces() : hideResults();
    const local = localMatches(query);
    const cached = searchCache.get(cacheKey(query));
    if (cached) return showMerged(local, cached, 'noResults');
    if (local.length) showResults([...local, { msg: t('searching') }]);
    timer = setTimeout(() => runSearch(query), 200);
  });
  $('q').addEventListener('keydown', (e) => e.key === 'Escape' && endSearch());
  map?.map.on('click', () => document.body.classList.contains('searching') && endSearch());
  $('searchbox').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = $('q').value.trim();
    if (query) runSearch(query);
  });
  $('results').addEventListener('click', (e) => {
    const menu = e.target.closest('button[data-menu]');
    if (menu) return openRecentMenu($('results').items[Number(menu.dataset.menu)]);
    const button = e.target.closest('button[data-i]');
    if (!button) return;
    const place = $('results').items[Number(button.dataset.i)];
    if (!state.nav) return selectPlace(place);
    endSearch();
    openStopMenu(place);
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
  $('btn-install').addEventListener('click', () => {
    $('dlg-settings').close();
    startInstall();
  });
  $('install-copy').addEventListener('click', () => share(t('installTitle'), `${location.origin}/`));
  $('btn-copy-places').addEventListener('click', copyPlaces);
  $('btn-privacy').addEventListener('click', () => $('dlg-privacy').showModal());
  $('offer').addEventListener('click', (e) => {
    const button = e.target.closest('[data-offer]');
    if (button && state.nav) answerOffer(state.nav, button.dataset.offer === 'take');
  });
  $('parking').addEventListener('click', (e) => {
    const button = e.target.closest('[data-parking]');
    const nav = state.nav;
    if (!button || !nav) return;
    hideParking(nav);
    const place = nav.parking?.places?.[Number(button.dataset.parking)];
    if (place) changeDestination(place, true);
  });
  $('dlg-save').addEventListener('close', closeSaveDialog);
  $('update-later').innerHTML = UI.close;
  $('update-restart').addEventListener('click', () => location.reload());
  $('update-later').addEventListener('click', () => {
    state.updateDeclined = true;
    $('update').hidden = true;
  });
  $('save-cancel').addEventListener('click', () => $('dlg-save').close(''));
  $('dlg-recent').addEventListener('close', closeRecentMenu);
  $('recent-cancel').addEventListener('click', () => $('dlg-recent').close(''));
  $('dlg-stop').addEventListener('close', closeStopMenu);
  $('stop-cancel').addEventListener('click', () => $('dlg-stop').close(''));

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
    if (!homeSlides() || (document.body.classList.contains('home-scrolls') && $('sheet-body').contains(e.target))) return;
    Object.assign(slide, { from: e.clientY, base: slide.offset, moved: false, lastY: e.clientY, lastT: e.timeStamp, speed: 0, max: collapseDistance() });
  });
  window.addEventListener('pointermove', (e) => {
    if (slide.from == null) return;
    const dy = e.clientY - slide.from;
    if (!slide.moved) {
      if (Math.abs(dy) < 6) return;
      slide.moved = true;
      cancelAnimationFrame(slide.raf);
    }
    if (e.timeStamp > slide.lastT) slide.speed = (e.clientY - slide.lastY) / (e.timeStamp - slide.lastT);
    slide.lastY = e.clientY;
    slide.lastT = e.timeStamp;
    setSlide(Math.min(slide.max, Math.max(0, slide.base + dy)));
  });
  const endSlide = (e) => {
    if (slide.from == null) return;
    slide.from = null;
    if (!slide.moved) return;
    state.swipedAt = Date.now();
    const speed = e.timeStamp - slide.lastT > 120 ? 0 : slide.speed;
    collapseHome(speed > 0.4 || (speed > -0.4 && slide.offset > slide.max / 2));
  };
  window.addEventListener('pointerup', endSlide);
  window.addEventListener('pointercancel', endSlide);
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
  document.querySelector('.grab').addEventListener('click', () => {
    if (Date.now() - (state.swipedAt || 0) < 400 || state.mode !== 'home') return;
    collapseHome(!settings.sheetCollapsed);
  });
  $('sheet').addEventListener('click', (e) => {
    if (state.mode === 'home' && Date.now() - (state.swipedAt || 0) < 400) return;
    const target = e.target.closest('[data-action]');
    if (!target || target.tagName === 'INPUT') return;
    const i = Number(target.dataset.i);
    switch (target.dataset.action) {
      case 'saved':
        return settings[target.dataset.key] ? selectPlace(settings[target.dataset.key]) : toast(t('setHint'));
      case 'recent':
        return selectPlace(settings.recents[i]);
      case 'recent-menu':
        return openRecentMenu(settings.recents[i]);
      case 'fav': {
        const s = settings.saved[i];
        return s && selectPlace({ name: s.label, sub: s.label !== s.name ? s.name : s.sub, lon: s.lon, lat: s.lat });
      }
      case 'fav-all':
        state.showAllSaved = true;
        return render();
      case 'save-place':
        return openSaveDialog(state.place);
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
      case 'nearby':
        return runNearby(target.dataset.cat);
      case 'install':
        return startInstall();
      case 'install-later':
        if (state.mode === 'arrived') state.installAfterTrip = false;
        else changeSetting('installSnoozedUntil', Date.now() + 7 * 86400000);
        return render();
      case 'route':
        return selectRoute(i);
      case 'start':
        return startNav(false);
      case 'demo':
        return startNav(true);
      case 'end':
        return finishNav(false);
      case 'remove-stop':
        return setStop(null);
      case 'mute':
        return toggleVoice();
      case 'nav-search':
        state.navSearch = true;
        render();
        showPlaces();
        return $('q').focus();
      case 'more':
        if (Date.now() - (state.swipedAt || 0) < 400) return;
        return toggleMore();
      case 'alts':
        return openAlternatives();
      case 'alts-close':
        return closeAlternatives();
      case 'alts-go': {
        const alt = state.nav?.alts?.list?.[i];
        if (!alt) return;
        state.nav.alts = null;
        useRoute(state.nav, alt.route);
        render();
        return toast(t('routeChanged'));
      }
      case 'overview':
        state.following = false;
        map.setFollow(false);
        $('btn-recenter').hidden = false;
        return map.fit(state.nav.route.coords, sheetPadding());
      case 'share-eta': {
        const progress = state.nav.navigator.progress();
        const eta = fmtClock(new Date(Date.now() + remainingTime(state.nav, progress) * 1000));
        return share(t('shareText', { name: state.nav.dest.name, eta }), placeUrl(state.nav.dest));
      }
    }
  });

  let moveTimer = null;
  map?.map.on('moveend', () => {
    if (state.nav || !state.backend.reports || map.map.getZoom() < 9) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(refreshReports, 600);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      if (state.updateReady && !state.updateDeclined && !state.nav) location.reload();
      return;
    }
    checkForUpdate();
    setTheme();
    refreshCommute();
    if (state.nav) acquireWakeLock();
  });
  new ResizeObserver(() => slide.from == null && !slide.raf && syncSlide()).observe($('sheet'));
  new ResizeObserver(measureBanner).observe($('banner'), { box: 'border-box' });
  window.addEventListener('resize', measureSheet);
  window.addEventListener('resize', measureBanner);
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
  if (location.hash.startsWith('#places=')) {
    importPlacesFrom(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const params = new URLSearchParams(location.search);
  const to = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(params.get('to') || '');
  if (!to) return;
  const lat = Number(to[1]);
  const lon = Number(to[2]);
  selectPlace({ name: params.get('n') || `${lat}, ${lon}`, sub: '', lon, lat });
}

document.body.classList.toggle('no-map', !map);
applyTexts();
setTheme();
bindUi();
render();
if (map) startGps();
openFromUrl();
fetch('data/pois.json')
  .then((r) => r.json())
  .then((data) => (state.poiData = data))
  .catch(() => {});
map?.map.on('zoomend', loadSignals);
health().then((backend) => {
  state.backend = backend;
  state.backendKnown = true;
  refreshCommute();
  $('row-traffic').hidden = !backend.traffic || !map;
  if (!map) return;
  if (backend.traffic && settings.traffic) map.setTraffic(true);
  map.ready.then(refreshReports);
});
if ('serviceWorker' in navigator) {
  let installedBefore = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    state.updateReady = installedBefore;
    installedBefore = true;
    offerUpdate();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
  setInterval(checkForUpdate, 30 * 60 * 1000);
}
