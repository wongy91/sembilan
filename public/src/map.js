import { slice, tilesAlong } from './geo.js';
import { UI } from './icons.js';
import { REPORT_ICON } from './reports.js';

const STYLES = {
  day: 'https://tiles.openfreemap.org/styles/liberty',
  night: 'https://tiles.openfreemap.org/styles/dark',
};
export const KL = [101.6869, 3.139];
export const SIGNAL_ZOOM = 15.5;
const STATION_NAME = ['downcase', ['coalesce', ['get', 'name'], '']];
const brandOf = (brands) => ['case', ...brands.flatMap(([words, brand]) => [['any', ...words.map((w) => ['in', w, STATION_NAME])], brand]), ''];
const stationLabel = (brand) => ['step', ['zoom'], brand, 16, ['case', ['!=', brand, ''], brand, ['coalesce', ['get', 'name'], '']]];
const STATIONS = [
  {
    id: 'sb-fuel',
    kind: 'fuel',
    color: '#344054',
    label: stationLabel(brandOf([[['petronas'], 'Petronas'], [['petron'], 'Petron'], [['shell'], 'Shell'], [['bhp', 'bh petrol'], 'BHPetrol'], [['caltex'], 'Caltex']])),
  },
  {
    id: 'sb-ev',
    kind: 'charging_station',
    color: '#079455',
    label: stationLabel(
      brandOf([[['tesla', 'supercharger'], 'Tesla'], [['gentari'], 'Gentari'], [['chargesini', 'charge sini'], 'ChargeSini'], [['jomcharge'], 'JomCharge'], [['chargev'], 'ChargEV'], [['dc handal'], 'DC Handal'], [['shell'], 'Shell Recharge']]),
    ),
  },
];
const EMPTY = { type: 'FeatureCollection', features: [] };
const LINE = { 'line-cap': 'round', 'line-join': 'round' };
const ROUTE_WIDTH = [[8, 3], [12, 4.5], [15, 7], [18, 12], [20, 18]];
const width = (scale = 1, extra = 0) => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  ...ROUTE_WIDTH.flatMap(([zoom, w]) => [zoom, Math.round((w * scale + extra) * 10) / 10]),
];
const FLOW_CLOSED = ['any', ['has', 'road_closure'], ['<', ['get', 'traffic_level'], 0.15]];
const FLOW_SLOW = ['any', ['has', 'road_closure'], ['<', ['get', 'traffic_level'], 0.75]];
const FLOW_COLOR = ['case', FLOW_CLOSED, '#7a271a', ['<', ['get', 'traffic_level'], 0.35], '#d92d20', '#f79009'];
const FLOW_WIDTH = ['interpolate', ['linear'], ['zoom'], 8, 1.5, 12, 2.5, 15, 4, 18, 7];
const FLOW_SIDE = ['case', ['!=', ['get', 'traffic_road_coverage'], 'one_side'], 0, ['has', 'left_hand_traffic'], -1, 1];
const FLOW_OFFSET = ['interpolate', ['linear'], ['zoom'], 8, ['*', FLOW_SIDE, 1], 12, ['*', FLOW_SIDE, 1.5], 15, ['*', FLOW_SIDE, 2.5], 18, ['*', FLOW_SIDE, 4.5]];
const ROUTE_COLORS = {
  day: { glow: '#1aa0ff', casing: '#0a5ec2', main: '#1aa0ff', alt: '#9aa8ba' },
  night: { glow: '#2fb4ff', casing: '#e3f3ff', main: '#2fb4ff', alt: '#5d6f8f' },
};
const PALETTE = {
  day: {
    fills: {
      background: '#eef1f4',
      water: '#9fd3f7',
      park: '#d3ebcd',
      landcover_grass: '#d3ebcd',
      landcover_wood: '#c9e5c2',
      landuse_residential: '#e7eaef',
      building: '#dde2e8',
    },
    lines: { waterway_river: '#9fd3f7', waterway_other: '#9fd3f7' },
    roads: {
      motorway: ['#ffc94d', '#e2a630'],
      motorway_link: ['#ffd77a', '#e2a630'],
      trunk_primary: ['#ffe8a3', '#e3c36d'],
      secondary_tertiary: ['#ffffff', '#c9d1db'],
      link: ['#ffffff', '#c9d1db'],
      minor: ['#ffffff', '#d3d9e0'],
      street: ['#ffffff', '#d3d9e0'],
      service_track: ['#ffffff', '#dde2e7'],
    },
  },
  night: {
    fills: {
      background: '#0f1729',
      water: '#0b2440',
      landuse_park: '#13241f',
      landcover_wood: '#13241f',
      landuse_residential: '#121c30',
      building: '#182238',
    },
    lines: {
      waterway: '#0b2440',
      highway_minor: '#253150',
      highway_major_casing: '#1c2742',
      highway_major_inner: '#33406a',
      highway_major_subtle: '#253150',
      highway_motorway_casing: '#26335a',
      highway_motorway_inner: '#4b5d8c',
      highway_motorway_subtle: '#253150',
    },
    roads: {},
  },
};

const angleDelta = (from, to) => ((to - from + 540) % 360) - 180;

function declutter(m) {
  for (const id of ['poi_r1', 'poi_r7', 'poi_r20']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
  if (m.getLayer('poi_transit')) m.setLayerZoomRange('poi_transit', 16, 24);
}

function applyPalette(m, night) {
  const p = PALETTE[night ? 'night' : 'day'];
  for (const { id, type } of m.getStyle().layers) {
    if (type === 'background') m.setPaintProperty(id, 'background-color', p.fills.background);
    else if (type === 'fill' && p.fills[id]) m.setPaintProperty(id, 'fill-color', p.fills[id]);
    else if (type === 'line' && p.lines[id]) m.setPaintProperty(id, 'line-color', p.lines[id]);
    else if (type === 'line') {
      const road = /^(?:road|bridge)_(.+?)(_casing)?$/.exec(id);
      const colors = road && p.roads[road[1]];
      if (colors) m.setPaintProperty(id, 'line-color', colors[road[2] ? 1 : 0]);
    }
  }
}

function overlayAnchor(style) {
  const layers = style.layers;
  const lastBase = layers.reduce((last, l, i) => (['transportation', 'building'].includes(l['source-layer']) ? i : last), -1);
  return layers.find((l, i) => i > lastBase && l.type === 'symbol')?.id;
}

function signalIcon() {
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 44;
  const g = canvas.getContext('2d');
  g.fillStyle = '#2b2f36';
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(1, 1, 18, 42, 6);
  g.fill();
  g.stroke();
  for (const [color, y] of [['#f04438', 11], ['#fdb022', 22], ['#12b76a', 33]]) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(10, y, 4.5, 0, Math.PI * 2);
    g.fill();
  }
  return g.getImageData(0, 0, 20, 44);
}

function stationIcon({ kind, color }) {
  const canvas = document.createElement('canvas');
  canvas.width = 44;
  canvas.height = 44;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(22, 22, 19.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#fff';
  if (kind === 'charging_station') {
    g.beginPath();
    for (const [x, y] of [[25, 8], [13, 24], [21, 24], [18, 36], [31, 19], [23, 19]]) g.lineTo(x, y);
    g.closePath();
    g.fill();
    return g.getImageData(0, 0, 44, 44);
  }
  g.beginPath();
  g.roundRect(13, 11, 12, 21, 2);
  g.fill();
  g.fillRect(11, 30, 16, 3);
  g.fillStyle = color;
  g.fillRect(15, 14, 8, 6);
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(25, 14);
  g.lineTo(30, 18);
  g.lineTo(30, 27);
  g.quadraticCurveTo(30, 29, 28, 29);
  g.lineTo(25, 29);
  g.stroke();
  return g.getImageData(0, 0, 44, 44);
}

function el(tag, className, html = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

const line = (coords, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } });

export class MapView {
  constructor(container, { night = false, threeD = true, ...handlers } = {}) {
    this.night = night;
    this.threeD = threeD;
    this.handlers = handlers;
    this.data = { routes: EMPTY, toll: EMPTY, traffic: EMPTY };
    this.trafficOn = false;
    this.styled = false;
    this.poiMarkers = [];
    this.reportMarkers = [];
    this.lastLongPress = 0;
    this.map = new maplibregl.Map({
      container,
      style: STYLES[night ? 'night' : 'day'],
      center: KL,
      zoom: 11,
      maxPitch: 70,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      attributionControl: false,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    this.map.once('load', () => container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
    this.ready = new Promise((resolve) => this.map.once('load', resolve));
    this.map.on('style.load', () => this.restore());
    this.user = new maplibregl.Marker({ element: el('div', 'puck', UI.dot), rotationAlignment: 'map', pitchAlignment: 'map' });
    this.car = false;
    this.pin = new maplibregl.Marker({ element: el('div', 'pin', UI.pin), anchor: 'bottom' });
    this.stopPin = new maplibregl.Marker({ element: el('div', 'pin stop-pin', UI.pin), anchor: 'bottom' });
    const zoomClass = () => container.classList.toggle('zoomed-out', this.map.getZoom() < 10);
    this.map.on('zoomend', zoomClass);
    this.map.once('load', zoomClass);
    this.bindGestures();
  }

  resetCamera() {
    if (this.car) {
      this.car = false;
      this.user.getElement().innerHTML = UI.dot;
      this.user.setRotation(0);
    }
    this.map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, bearing: 0, pitch: 0, duration: 600 });
  }

  bindGestures() {
    const m = this.map;
    let timer = null;
    let start = null;
    const cancel = () => clearTimeout(timer);
    const longPress = (lngLat) => {
      if (Date.now() - this.lastLongPress < 800) return;
      this.lastLongPress = Date.now();
      this.handlers.onLongPress?.([lngLat.lng, lngLat.lat]);
    };
    m.on('touchstart', (e) => {
      cancel();
      if (e.originalEvent.touches.length !== 1) return;
      start = e.point;
      const at = e.lngLat;
      timer = setTimeout(() => longPress(at), 550);
    });
    m.on('touchmove', (e) => {
      if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 8) cancel();
    });
    m.on('touchend', cancel);
    m.on('touchcancel', cancel);
    m.on('contextmenu', (e) => longPress(e.lngLat));
    const surface = m.getCanvasContainer();
    surface.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.drive) return;
        this.drive.held = (this.drive.held || 0) + 1;
        this.drive.downAt = [e.clientX, e.clientY];
      },
      { capture: true },
    );
    surface.addEventListener(
      'pointermove',
      (e) => {
        const d = this.drive;
        if (d?.held && d.follow && Math.hypot(e.clientX - d.downAt[0], e.clientY - d.downAt[1]) > 6) this.handlers.onUserMove?.();
      },
      { capture: true },
    );
    const release = () => {
      if (!this.drive?.held) return;
      this.drive.held -= 1;
      this.kick();
    };
    window.addEventListener('pointerup', release, { capture: true });
    window.addEventListener('pointercancel', release, { capture: true });
    surface.addEventListener('wheel', () => this.drive?.follow && this.handlers.onUserMove?.(), { capture: true, passive: true });
    for (const name of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
      m.on(name, (e) => {
        if (e.originalEvent) this.handlers.onUserMove?.();
      });
    }
    m.on('click', 'sb-routes-alt', (e) => this.handlers.onRouteClick?.(e.features[0].properties.i));
    for (const { id, kind } of STATIONS) {
      m.on('click', id, (e) => {
        const f = e.features[0];
        const [lon, lat] = f.geometry.coordinates;
        this.handlers.onStationClick?.({ name: f.properties.name || '', lon, lat, kind });
      });
    }
    m.on('mouseenter', 'sb-routes-alt', () => (m.getCanvas().style.cursor = 'pointer'));
    m.on('mouseleave', 'sb-routes-alt', () => (m.getCanvas().style.cursor = ''));
  }

  restore() {
    const m = this.map;
    applyPalette(m, this.night);
    declutter(m);
    const before = overlayAnchor(m.getStyle());
    for (const id of ['sb-routes', 'sb-toll', 'sb-traffic']) {
      if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: this.data[id.slice(3)] });
    }
    if (this.night && !m.getLayer('sb-3d')) {
      m.addLayer(
        {
          id: 'sb-3d',
          type: 'fill-extrusion',
          source: 'openmaptiles',
          'source-layer': 'building',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#1f2a42',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.85,
          },
        },
        before,
      );
    }
    if (this.trafficOn) this.addTrafficLayer(before);
    const add = (layer) => !m.getLayer(layer.id) && m.addLayer(layer, before);
    const c = ROUTE_COLORS[this.night ? 'night' : 'day'];
    const selected = ['get', 'selected'];
    add({ id: 'sb-routes-alt', type: 'line', source: 'sb-routes', filter: ['!', selected], layout: LINE, paint: { 'line-color': c.alt, 'line-width': width(0.75), 'line-opacity': 0.9 } });
    add({ id: 'sb-routes-glow', type: 'line', source: 'sb-routes', filter: selected, layout: LINE, paint: { 'line-color': c.glow, 'line-width': width(1, 6), 'line-blur': width(0.4), 'line-opacity': this.night ? 0.3 : 0.15 } });
    add({ id: 'sb-routes-casing', type: 'line', source: 'sb-routes', filter: selected, layout: LINE, paint: { 'line-color': c.casing, 'line-width': width(1, 2.5) } });
    add({ id: 'sb-routes-main', type: 'line', source: 'sb-routes', filter: selected, layout: LINE, paint: { 'line-color': c.main, 'line-width': width() } });
    add({ id: 'sb-traffic', type: 'line', source: 'sb-traffic', layout: LINE, paint: { 'line-color': ['match', ['get', 'level'], 1, '#f79009', 2, '#e8590c', 3, '#d92d20', '#7a271a'], 'line-width': width() } });
    add({ id: 'sb-toll', type: 'line', source: 'sb-toll', layout: LINE, paint: { 'line-color': '#ffcc00', 'line-width': width(0.3), 'line-dasharray': [1, 2] } });
    this.addSignals(before);
    this.addStations();
    this.apply3D();
    this.styled = true;
  }

  addStations() {
    const m = this.map;
    if (!m.getSource('openmaptiles')) return;
    const font = m.getStyle().layers.find((l) => l['source-layer'] === 'poi' && l.layout?.['text-font'])?.layout['text-font'] || ['Noto Sans Regular'];
    for (const station of STATIONS) {
      if (m.getLayer(station.id)) continue;
      if (!m.hasImage(station.id)) m.addImage(station.id, stationIcon(station), { pixelRatio: 2 });
      m.addLayer({
        id: station.id,
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'poi',
        minzoom: 14,
        filter: ['==', ['get', 'subclass'], station.kind],
        layout: {
          'icon-image': station.id,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 17, 1.05],
          'icon-allow-overlap': true,
          'text-field': station.label,
          'text-font': font,
          'text-size': 12,
          'text-anchor': 'top',
          'text-offset': [0, 1.1],
          'text-max-width': 8,
          'text-optional': true,
        },
        paint: { 'text-color': this.night ? '#e4e7ec' : '#344054', 'text-halo-color': this.night ? '#101419' : '#fff', 'text-halo-width': 1.5 },
      });
    }
  }

  setSignals(flat) {
    const features = [];
    for (let i = 0; i < flat.length; i += 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [flat[i], flat[i + 1]] } });
    this.signals = { type: 'FeatureCollection', features };
    if (this.styled) this.addSignals(overlayAnchor(this.map.getStyle()));
  }

  addSignals(before) {
    const m = this.map;
    if (!this.signals) return;
    if (!m.hasImage('sb-signal')) m.addImage('sb-signal', signalIcon(), { pixelRatio: 2 });
    if (!m.getSource('sb-signals')) m.addSource('sb-signals', { type: 'geojson', data: this.signals });
    if (!m.getLayer('sb-signals')) {
      m.addLayer(
        { id: 'sb-signals', type: 'symbol', source: 'sb-signals', minzoom: SIGNAL_ZOOM, layout: { 'icon-image': 'sb-signal', 'icon-size': ['interpolate', ['linear'], ['zoom'], SIGNAL_ZOOM, 0.75, 18, 1.1], 'icon-padding': 0 } },
        before,
      );
    }
  }

  addTrafficLayer(before) {
    const m = this.map;
    if (!m.getSource('sb-flow')) {
      m.addSource('sb-flow', {
        type: 'vector',
        tiles: [`${location.origin}/api/traffic/{z}/{x}/{y}.pbf`],
        minzoom: 6,
        maxzoom: 15,
        attribution: '© TomTom',
      });
    }
    if (!m.getLayer('sb-flow')) {
      m.addLayer(
        { id: 'sb-flow', type: 'line', source: 'sb-flow', 'source-layer': 'Traffic flow', filter: FLOW_SLOW, layout: LINE, paint: { 'line-color': FLOW_COLOR, 'line-width': FLOW_WIDTH, 'line-offset': FLOW_OFFSET } },
        m.getLayer('sb-routes-alt') ? 'sb-routes-alt' : before,
      );
    }
  }

  setTraffic(on) {
    this.trafficOn = on;
    const m = this.map;
    if (!this.styled) return;
    if (on) this.addTrafficLayer(overlayAnchor(m.getStyle()));
    else if (m.getLayer('sb-flow')) m.removeLayer('sb-flow');
  }

  setNight(night) {
    if (night === this.night) return;
    this.night = night;
    this.styled = false;
    this.map.setStyle(STYLES[night ? 'night' : 'day'], { diff: false });
  }

  set3D(on) {
    this.threeD = on;
    this.apply3D();
  }

  apply3D() {
    const m = this.map;
    for (const id of ['building-3d', 'sb-3d']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', this.threeD ? 'visible' : 'none');
    }
  }

  update(id, data) {
    this.data[id] = data;
    this.map.getSource(`sb-${id}`)?.setData(data);
  }

  showRoutes(routes, selected, along = 0) {
    const features = routes.map((r, i) => line(i === selected ? slice(r.coords, r.cum, along) : r.coords, { i, selected: i === selected }));
    features.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected));
    this.update('routes', { type: 'FeatureCollection', features });
    const route = routes[selected];
    const sections = (list) =>
      route
        ? list
            .filter(([, b]) => b > along)
            .map(([a, b, props = {}]) => line(slice(route.coords, route.cum, Math.max(a, along), b), props))
        : [];
    this.update('toll', { type: 'FeatureCollection', features: sections(route?.tollSections || []) });
    const traffic = (route?.traffic || []).map((s) => [s.from, s.to, { level: Math.min(4, Math.max(1, s.magnitude || 1)) }]);
    this.update('traffic', { type: 'FeatureCollection', features: sections(traffic) });
  }

  clearRoutes() {
    for (const id of ['routes', 'toll', 'traffic']) this.update(id, EMPTY);
    this.setPois([]);
  }

  setPois(pois) {
    this.poiMarkers.forEach((m) => m.remove());
    this.poiMarkers = pois
      .filter((p) => p.kind === 'toll' || p.kind === 'camera' || p.kind === 'rr')
      .map((p) => {
        const label = p.kind === 'toll' ? 'TOL' : p.kind === 'camera' ? '📷' : 'R&R';
        const node = el('div', `poi poi-${p.kind}`, label);
        if (p.name) node.title = p.name;
        return new maplibregl.Marker({ element: node }).setLngLat([p.lon, p.lat]).addTo(this.map);
      });
  }

  setReports(reports) {
    this.reportMarkers.forEach((m) => m.remove());
    this.reportMarkers = reports.map((r) => {
      const node = el('button', 'report-pin', REPORT_ICON[r.kind] || '⚠️');
      node.type = 'button';
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onReportClick?.(r);
      });
      return new maplibregl.Marker({ element: node }).setLngLat([r.lon, r.lat]).addTo(this.map);
    });
  }

  setUser(lonLat, heading, driving) {
    if (driving !== this.car) {
      this.car = driving;
      this.user.getElement().innerHTML = driving ? UI.car : UI.dot;
    }
    this.user.setLngLat(lonLat);
    if (!this.userShown) {
      this.user.addTo(this.map);
      this.userShown = true;
    }
    this.user.setRotation(driving && Number.isFinite(heading) ? heading : 0);
  }

  showPin(lonLat) {
    if (lonLat) this.pin.setLngLat(lonLat).addTo(this.map);
    else this.pin.remove();
  }

  showStop(lonLat) {
    if (lonLat) this.stopPin.setLngLat(lonLat).addTo(this.map);
    else this.stopPin.remove();
  }

  driveTo(lonLat, heading, speed) {
    if (!this.car) {
      this.car = true;
      this.user.getElement().innerHTML = UI.car;
    }
    if (!this.userShown) {
      this.user.setLngLat(lonLat).addTo(this.map);
      this.userShown = true;
    }
    const now = performance.now();
    if (!this.drive) {
      this.drive = { follow: true, cam: null, car: null, last: 0, raf: null };
      this.map.setPadding({ top: this.map.getContainer().clientHeight * 0.42, bottom: 0, left: 0, right: 0 });
    }
    const d = this.drive;
    const from = d.car || { pos: lonLat, heading: Number.isFinite(heading) ? heading : 0 };
    d.from = from;
    d.to = { pos: lonLat, heading: Number.isFinite(heading) && (speed || 0) >= 1.5 ? heading : from.heading };
    d.dur = d.last ? Math.min(1500, Math.max(250, (now - d.last) * 0.9)) : 0;
    d.last = now;
    d.t0 = now;
    d.speed = speed || 0;
    this.kick();
  }

  setFollow(on) {
    if (!this.drive) return;
    this.drive.follow = on;
    if (!on) this.drive.cam = null;
    this.kick();
  }

  setCallout(lonLat, text) {
    if (!text || !lonLat) {
      this.callout?.remove();
      this.callout = null;
      return;
    }
    this.callout ??= new maplibregl.Marker({ element: el('div', 'callout'), anchor: 'bottom-left', offset: [8, -8] });
    this.callout.getElement().textContent = text;
    this.callout.setLngLat(lonLat).addTo(this.map);
  }

  stopDrive() {
    if (this.drive?.raf) cancelAnimationFrame(this.drive.raf);
    this.drive = null;
  }

  kick() {
    if (this.drive && !this.drive.raf) this.drive.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    const d = this.drive;
    if (!d) return;
    d.raf = null;
    const k = d.dur > 0 ? Math.min(1, (now - d.t0) / d.dur) : 1;
    const pos = [d.from.pos[0] + (d.to.pos[0] - d.from.pos[0]) * k, d.from.pos[1] + (d.to.pos[1] - d.from.pos[1]) * k];
    const heading = (d.from.heading + angleDelta(d.from.heading, d.to.heading) * k + 360) % 360;
    d.car = { pos, heading };
    this.user.setLngLat(pos);
    this.user.setRotation(heading);
    let settling = false;
    if (d.follow && !d.held) {
      const dt = Math.min(100, now - (d.lastFrame ?? now));
      const a = 1 - Math.exp(-dt / 140);
      const cam = (d.cam ??= { center: this.map.getCenter().toArray(), bearing: this.map.getBearing(), zoom: this.map.getZoom(), pitch: this.map.getPitch() });
      const zoom = d.speed > 22 ? 15.4 : d.speed > 12 ? 16.2 : 17;
      const pitch = this.threeD ? 58 : 0;
      cam.center[0] += (pos[0] - cam.center[0]) * a;
      cam.center[1] += (pos[1] - cam.center[1]) * a;
      cam.bearing += angleDelta(cam.bearing, heading) * a * 0.6;
      cam.zoom += (zoom - cam.zoom) * a * 0.4;
      cam.pitch += (pitch - cam.pitch) * a * 0.5;
      this.map.jumpTo(cam);
      settling =
        Math.abs(pos[0] - cam.center[0]) + Math.abs(pos[1] - cam.center[1]) > 1e-7 ||
        Math.abs(angleDelta(cam.bearing, heading)) > 0.2 ||
        Math.abs(zoom - cam.zoom) > 0.01 ||
        Math.abs(pitch - cam.pitch) > 0.2;
    }
    d.lastFrame = now;
    if (k < 1 || settling) this.kick();
    else d.lastFrame = undefined;
  }

  fit(coords, padding) {
    if (!coords.length) return;
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    this.map.fitBounds(bounds, { padding, bearing: 0, pitch: 0, duration: 700, maxZoom: 16 });
  }

  flyTo(lonLat, zoom = 15) {
    this.map.easeTo({ center: lonLat, zoom, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 700 });
  }

  tileUrls(coords, cum) {
    const template = this.map.getSource('openmaptiles')?.tiles?.[0];
    if (!template) return [];
    const tiles = [...tilesAlong(coords, cum, 14, 400), ...tilesAlong(coords, cum, 12, 2000)];
    return tiles.map(([z, x, y]) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }

  bounds() {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  center() {
    const c = this.map.getCenter();
    return [c.lng, c.lat];
  }
}
