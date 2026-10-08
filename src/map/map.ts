// Карта: подложка, зоны влияния, города и крепости, точки событий.
import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, LineLayerSpecification, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 грузит воркер отдельным модулем — отдаём его через Vite, иначе на сборке он теряется.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { buildStyle, makeHatch, POLITY_PAINT, type PolityOpacity } from './basemaps';
import { events, places, polities, eventSpan } from '../data';
import type { HistEvent, Place, PolityProps } from '../schema';
import { getState, setState, subscribe, type Theme } from '../state';

const SEAS: { name: string; coords: [number, number]; size: number }[] = [
  { name: 'Каспийское море', coords: [50.2, 42.6], size: 1 },
  { name: 'Чёрное море', coords: [37.0, 43.4], size: 1 },
  { name: 'Большой Кавказ', coords: [44.6, 42.55], size: 0.8 },
];

let map: MlMap;
let eventWindow = 50;
const eventMarkers = new Map<string, { marker: maplibregl.Marker; el: HTMLElement; ev: HistEvent }>();
const placeMarkers: { el: HTMLElement; start: number; end: number | null; type: Place['type']; place: Place; shown: string }[] = [];

/** Название места в данном году (из истории названий), иначе основное. */
function placeName(p: Place, year: number): string {
  const hist = (p.names ?? []).filter((n) => n.from <= year).sort((a, b) => b.from - a.from);
  return hist[0]?.name ?? p.name;
}
const polityLabels: { el: HTMLElement; props: PolityProps }[] = [];

// --- Зоны влияния: плавное появление и исчезновение ---
// У каждой зоны свой номер _k. Новая зона сначала «прорисовывается» контуром,
// затем проявляется заливка; ушедшая — плавно гаснет.
const N = polities.features.length;
polities.features.forEach((f, k) => { (f.properties as PolityProps & { _k: number })._k = k; });
const fade = new Float32Array(N);   // 0…1 — насколько зона проявлена
const draw = new Float32Array(N).fill(1); // 0…1 — какая доля контура прорисована
const target = new Uint8Array(N);
const DRAW_MS = 900, FADE_IN_MS = 600, FADE_OUT_MS = 350;
let animFrame = 0;
let lastT = 0;

const opacity: PolityOpacity = (base, kind) => {
  const pairs: (number | ExpressionSpecification)[] = [];
  for (let k = 0; k < N; k++) {
    const v = kind === 'line' && draw[k] < 1 ? 0 : fade[k];
    if (v > 0) pairs.push(k, +(base * v).toFixed(3));
  }
  return pairs.length ? (['match', ['get', '_k'], ...pairs, 0] as unknown as ExpressionSpecification) : 0;
};

function setPolityTargets(year: number) {
  for (let k = 0; k < N; k++) {
    const p = polities.features[k].properties;
    const on = year >= p.start && year <= p.end ? 1 : 0;
    if (on === target[k]) continue;
    target[k] = on;
    if (on && fade[k] === 0) draw[k] = 0; // появляется с нуля — рисуем контур
    if (!on) draw[k] = 1;                 // уходит — дорисовку прекращаем
  }
  if (!animFrame) { lastT = performance.now(); animFrame = requestAnimationFrame(stepPolities); }
}

function stepPolities(t: number) {
  const dt = Math.min(64, t - lastT);
  lastT = t;
  let busy = false;
  for (let k = 0; k < N; k++) {
    if (target[k]) {
      if (draw[k] < 1) draw[k] = Math.min(1, draw[k] + dt / DRAW_MS);
      if (draw[k] > 0.35 && fade[k] < 1) fade[k] = Math.min(1, fade[k] + dt / FADE_IN_MS);
      if (draw[k] < 1 || fade[k] < 1) busy = true;
    } else if (fade[k] > 0) {
      fade[k] = Math.max(0, fade[k] - dt / FADE_OUT_MS);
      busy = true;
    }
  }
  paintPolities();
  animFrame = busy ? requestAnimationFrame(stepPolities) : 0;
}

function paintPolities() {
  if (!map?.getLayer('polity-fill')) return;
  for (const l of POLITY_PAINT[getState().theme]) {
    if (map.getLayer(l.id)) map.setPaintProperty(l.id, l.prop, opacity(l.base, l.kind));
  }
  for (let k = 0; k < N; k++) {
    const id = `polity-draw-${k}`;
    const drawing = target[k] === 1 && draw[k] < 1;
    if (!drawing) { if (map.getLayer(id)) map.removeLayer(id); continue; }
    const color = polities.features[k].properties.color;
    const gradient: ExpressionSpecification = ['step', ['line-progress'], color, Math.max(0.001, draw[k]), 'rgba(0,0,0,0)'];
    if (map.getLayer(id)) { map.setPaintProperty(id, 'line-gradient', gradient); continue; }
    const layer: LineLayerSpecification = {
      id, type: 'line', source: 'polity-outline',
      filter: ['==', ['get', '_k'], k],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 2.4, 'line-gradient': gradient },
    };
    map.addLayer(layer, 'ocean');
  }
}

function labelPoint(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  // Центр рамки самого большого кольца — для приблизительных зон этого достаточно.
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);
  let best = rings[0];
  let bestArea = 0;
  for (const r of rings) {
    const xs = r.map((c) => c[0]);
    const ys = r.map((c) => c[1]);
    const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (a > bestArea) { bestArea = a; best = r; }
  }
  const xs = best.map((c) => c[0]);
  const ys = best.map((c) => c[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export function initMap(container: HTMLElement): MlMap {
  maplibregl.setWorkerUrl(workerUrl);
  const { theme } = getState();
  const isPhone = window.matchMedia('(max-width: 720px)').matches;
  map = new maplibregl.Map({
    container,
    style: buildStyle(theme, polities, opacity),
    center: [46.9, 42.6],
    zoom: isPhone ? 5.3 : 6.1,
    minZoom: 4.3,
    maxZoom: 11,
    maxBounds: [[35.5, 36.2], [56.5, 48.8]],
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  map.setMissingStyleImageResolver((id) => {
    if (id.startsWith('hatch-') && !map.hasImage(id)) map.addImage(id, makeHatch(id.slice('hatch-'.length)), { pixelRatio: 2 });
  });

  for (const s of SEAS) {
    const el = document.createElement('div');
    el.className = 'map-label sea';
    el.style.setProperty('--s', String(s.size));
    el.textContent = s.name;
    new maplibregl.Marker({ element: el }).setLngLat(s.coords).addTo(map);
  }

  for (const f of polities.features) {
    const el = document.createElement('div');
    el.className = 'map-label polity';
    el.style.setProperty('--c', f.properties.color);
    el.textContent = f.properties.name;
    if (f.properties.note) el.title = f.properties.note;
    new maplibregl.Marker({ element: el }).setLngLat(f.properties.labelAt ?? labelPoint(f.geometry)).addTo(map);
    polityLabels.push({ el, props: f.properties });
  }

  for (const p of places) {
    const el = document.createElement('div');
    el.className = `place place-${p.type}`;
    el.innerHTML = `<i></i><span></span>`;
    const hist = (p.names ?? []).slice().sort((a, b) => a.from - b.from)
      .map((n) => `${n.approx ? '≈' : ''}${n.from < 0 ? `${-n.from} до н. э.` : n.from} — ${n.name}`);
    el.title = (hist.length ? hist.join('\n') : [p.name, ...p.altNames].join(' / ')) + (p.note ? `\n${p.note}` : '');
    new maplibregl.Marker({ element: el, anchor: 'left', offset: [-5, 0] }).setLngLat(p.coords).addTo(map);
    placeMarkers.push({ el, start: p.start, end: p.end, type: p.type, place: p, shown: '' });
  }

  for (const ev of events) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'event-marker' + (ev.verified ? '' : ' unverified');
    el.innerHTML = `<i></i><span></span>`;
    el.querySelector('span')!.textContent = ev.title;
    el.setAttribute('aria-label', ev.title);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      setState({ eventId: ev.id });
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(ev.coords).addTo(map);
    eventMarkers.set(ev.id, { marker, el, ev });
  }

  map.on('click', () => {
    if (getState().eventId) setState({ eventId: null });
  });

  map.on('load', paintPolities);
  update(getState().year);
  if (getState().eventId) focusEvent(getState().eventId!, false);
  map.on('move', scheduleDeclutter);
  subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme);
    if (s.year !== prev.year || s.eventId !== prev.eventId) update(s.year);
    if (s.eventId && s.eventId !== prev.eventId) focusEvent(s.eventId);
  });
  return map;
}

/** Ширина «окна» шкалы в годах: события внутри окна видны на карте. */
export function setEventWindow(years: number) {
  eventWindow = years;
  update(getState().year);
}

function update(year: number) {
  const { eventId } = getState();
  setPolityTargets(year);
  const visible = new Map<string, PolityProps>();
  for (const { el, props } of polityLabels) {
    const on = year >= props.start && year <= props.end;
    el.classList.toggle('off', !on);
    if (on && !visible.has(props.polityId)) visible.set(props.polityId, props);
  }
  renderLegend(year, [...visible.values()]);

  for (const m of placeMarkers) {
    m.el.classList.toggle('hidden', !(year >= m.start && (m.end === null || year <= m.end)));
    const name = placeName(m.place, year);
    if (name !== m.shown) { m.el.querySelector('span')!.textContent = name; m.shown = name; }
  }
  for (const { el, ev } of eventMarkers.values()) {
    const [a, b] = eventSpan(ev);
    const near = year >= a - eventWindow && year <= b + eventWindow;
    const selected = ev.id === eventId;
    el.classList.toggle('hidden', !near && !selected);
    el.classList.toggle('selected', selected);
    el.classList.toggle('current', year >= a && year <= b);
  }
  scheduleDeclutter();
}

// Простая расстановка подписей: подписи событий важнее подписей городов,
// города важнее сёл. Перекрытые подписи прячем (сам значок остаётся).
let declutterQueued = false;
function scheduleDeclutter() {
  if (declutterQueued) return;
  declutterQueued = true;
  requestAnimationFrame(() => {
    declutterQueued = false;
    declutter();
  });
}

function declutter() {
  const taken: DOMRect[] = [];
  const overlaps = (r: DOMRect) => taken.some((t) => r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top);
  const visible = (el: HTMLElement) => !el.classList.contains('hidden');
  const eventsFirst = [...eventMarkers.values()]
    .filter((m) => visible(m.el))
    .sort((a, b) => Number(b.el.classList.contains('selected')) - Number(a.el.classList.contains('selected')));
  for (const { el } of eventsFirst) {
    taken.push(el.querySelector('i')!.getBoundingClientRect());
  }
  for (const { el } of eventsFirst) {
    const span = el.querySelector('span')!;
    span.classList.remove('collide');
    const r = span.getBoundingClientRect();
    if (overlaps(r) && !el.classList.contains('selected')) span.classList.add('collide');
    else taken.push(r);
  }
  const order = { city: 0, fortress: 1, settlement: 2, monument: 3 } as const;
  const ps = placeMarkers.filter((p) => visible(p.el))
    .sort((a, b) => a.place.rank - b.place.rank || order[a.type] - order[b.type]);
  for (const p of ps) taken.push(p.el.querySelector('i')!.getBoundingClientRect());
  // Подпись ставим справа от точки; если там тесно — слева, сверху или снизу; если везде занято — прячем.
  const sides = ['', 'left', 'top', 'bottom'] as const;
  for (const p of ps) {
    const span = p.el.querySelector('span')!;
    span.classList.remove('collide');
    let placed = false;
    for (const side of sides) {
      p.el.classList.remove(...sides.filter(Boolean));
      if (side) p.el.classList.add(side);
      const r = span.getBoundingClientRect();
      if (!overlaps(r)) { taken.push(r); placed = true; break; }
    }
    if (!placed) {
      p.el.classList.remove(...sides.filter(Boolean));
      span.classList.add('collide');
    }
  }
}

// --- Легенда: что сейчас нарисовано на карте и почему ---

const yearText = (y: number) => (y < 0 ? `${-y} г. до н. э.` : `${y} г.`);
let legendOpen = !window.matchMedia('(max-width: 720px)').matches;
let lastLegend = '';

function renderLegend(year: number, items: PolityProps[]) {
  const el = document.getElementById('legend')!;
  const key = `${year}|${items.map((p) => p.polityId).join(',')}|${legendOpen}`;
  if (key === lastLegend) return;
  lastLegend = key;
  const span = (p: PolityProps) => `${yearText(p.start).replace(' г.', '')}–${yearText(p.end)}`;
  const rows = items.length
    ? items.map((p) => `<li class="lg-row" title="${(p.note ?? '').replace(/"/g, '&quot;')}"><i class="sw" style="--c:${p.color}"></i><span>${p.name}<small>${span(p)}</small></span></li>`).join('')
    : `<li class="lg-row empty"><i aria-hidden="true"></i><span>${year < -800
      ? 'Государств в эту эпоху ещё не было — только общины и племена; о них рассказывают события на карте.'
      : 'Для этого года зоны влияния не нанесены: источники не дают уверенных границ.'}</span></li>`;
  el.classList.toggle('collapsed', !legendOpen);
  el.innerHTML = `
    <button type="button" class="lg-head" aria-expanded="${legendOpen}">
      <b>На карте: ${yearText(year)}</b>
      ${items.length ? `<span class="lg-count">${items.length}</span>` : ''}
      <span class="lg-chev" aria-hidden="true">${legendOpen ? '▾' : '▸'}</span>
    </button>
    <div class="lg-body">
      <ul class="lg-list">${rows}
        <li class="lg-row lg-outline"><i aria-hidden="true"></i><span>Граница Дагестана сегодня<small>для ориентира</small></span></li>
      </ul>
      <details class="lg-more"><summary><i aria-hidden="true">i</i><span>Как читать карту</span></summary>
        <p class="lg-note">Зоны показывают, кто контролировал территорию в выбранный год, поэтому при движении шкалы они сменяют друг друга. Границы примерные; подробности — при наведении на название.</p>
        <p class="lg-note">Берега и реки — современные. Уровень Каспия менялся: в геологическом прошлом (четвертичный период) море не раз заливало почти всю приморскую равнину; стены Дербента в VI в. уходили в море примерно на 150 м.</p>
      </details>
    </div>`;
  el.querySelector('.lg-head')!.addEventListener('click', () => {
    legendOpen = !legendOpen;
    lastLegend = '';
    renderLegend(year, items);
  });
}

function applyTheme(theme: Theme) {
  // При смене подложки дорисовку контуров завершаем сразу.
  draw.fill(1);
  map.setStyle(buildStyle(theme, polities, opacity), { diff: false });
  document.documentElement.dataset.theme = theme;
}

function focusEvent(id: string, animate = true) {
  const m = eventMarkers.get(id);
  if (!m) return;
  const desktop = window.matchMedia('(min-width: 721px)').matches;
  map.easeTo({
    center: m.ev.coords,
    zoom: Math.max(map.getZoom(), 6.5),
    padding: desktop
      ? { top: 60, bottom: 140, left: 0, right: 440 }
      : { top: 40, bottom: Math.round(window.innerHeight * 0.55), left: 0, right: 0 },
    duration: animate ? 900 : 0,
  });
}
