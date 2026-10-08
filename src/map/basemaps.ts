// Две подложки: «старая карта» (пергамент, штриховка воды) и «современная» (тёмный рельеф).
// Обе без современных границ и подписей — только рельеф, моря, озёра и реки.
import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { Theme } from '../state';

// Абсолютный адрес папки сайта: MapLibre грузит GeoJSON в воркере, где относительные пути не работают.
const base = new URL(import.meta.env.BASE_URL, window.location.href).href;

export const ATTRIBUTION =
  'Рельеф: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a> · ' +
  'Вода: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>';

interface Palette {
  land: string;
  water: string;
  waterLine: string;
  coast: string;
  river: string;
  shadow: string;
  highlight: string;
  accent: string;
  exaggeration: number;
}

export const PALETTES: Record<Theme, Palette> = {
  old: {
    land: '#e8dbbd',
    water: '#c8d3c4',
    waterLine: '#6f8a86',
    coast: '#5b4a36',
    river: '#7c9894',
    shadow: '#6b4e2e',
    highlight: '#fbf3dc',
    accent: '#a68a5f',
    exaggeration: 0.55,
  },
  modern: {
    land: '#2a2d33',
    water: '#141a21',
    waterLine: '#2a3846',
    coast: '#3f4f5e',
    river: '#33536b',
    shadow: '#050608',
    highlight: '#6a717c',
    accent: '#30343b',
    exaggeration: 0.8,
  },
};

/** Прозрачность зоны: base — «полная» прозрачность слоя; kind — заливка или контур. */
const ROUTE: Record<Theme, string> = { old: '#9b2f1c', modern: '#e0a35c' };

export type PolityOpacity = (base: number, kind: 'fill' | 'line') => ExpressionSpecification | number;

/** Слои зон, у которых анимируется прозрачность: при смене года зоны проявляются и гаснут. */
export const POLITY_PAINT: Record<Theme, { id: string; prop: 'fill-opacity' | 'line-opacity'; base: number; kind: 'fill' | 'line' }[]> = {
  old: [
    { id: 'polity-fill', prop: 'fill-opacity', base: 0.16, kind: 'fill' },
    { id: 'polity-hatch', prop: 'fill-opacity', base: 0.55, kind: 'fill' },
    { id: 'polity-line', prop: 'line-opacity', base: 0.85, kind: 'line' },
  ],
  modern: [
    { id: 'polity-fill', prop: 'fill-opacity', base: 0.24, kind: 'fill' },
    { id: 'polity-line-glow', prop: 'line-opacity', base: 0.18, kind: 'line' },
    { id: 'polity-line', prop: 'line-opacity', base: 0.9, kind: 'line' },
  ],
};

/** Слой зон влияния: в «старой» теме — штриховка, в «современной» — полупрозрачная заливка. */
export function polityLayers(theme: Theme, op: PolityOpacity): LayerSpecification[] {
  if (theme === 'old') {
    return [
      {
        id: 'polity-fill', type: 'fill', source: 'polities',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': op(0.16, 'fill') },
      },
      {
        id: 'polity-hatch', type: 'fill', source: 'polities',
        paint: { 'fill-pattern': ['concat', 'hatch-', ['get', 'color']], 'fill-opacity': op(0.55, 'fill') },
      },
      {
        id: 'polity-line', type: 'line', source: 'polities',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': op(0.85, 'line'), 'line-dasharray': [3, 1.5] },
      },
    ];
  }
  return [
    {
      id: 'polity-fill', type: 'fill', source: 'polities',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': op(0.24, 'fill') },
    },
    {
      id: 'polity-line-glow', type: 'line', source: 'polities',
      paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': op(0.18, 'line'), 'line-blur': 4 },
    },
    {
      id: 'polity-line', type: 'line', source: 'polities',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.4, 'line-opacity': op(0.9, 'line') },
    },
  ];
}

/** Контуры зон как линии: по ним «прорисовывается» граница появляющейся зоны. */
function outlines(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
      return { type: 'Feature', properties: f.properties, geometry: { type: 'MultiLineString', coordinates: rings } };
    }),
  };
}

/** Пустая «тропа» событий эпохи — данные подставляет карта. */
export const EMPTY_ROUTE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function buildStyle(theme: Theme, politiesData: GeoJSON.FeatureCollection, op: PolityOpacity, route = EMPTY_ROUTE): StyleSpecification {
  const p = PALETTES[theme];
  // На «старой карте» современных водохранилищ нет.
  const lakeFilter: ExpressionSpecification = theme === 'old'
    ? ['!=', ['get', 'featurecla'], 'Reservoir']
    : ['boolean', true];

  const waterLining: LayerSpecification[] = theme === 'old'
    ? [3, 7, 12, 18].map((offset, i) => ({
        id: `water-lining-${i}`,
        type: 'line' as const,
        source: 'ocean-lining',
        layout: { 'line-join': 'round' as const },
        paint: {
          'line-color': p.waterLine,
          'line-width': 0.8,
          'line-offset': -offset,
          'line-opacity': 0.55 - i * 0.12,
        },
      }))
    : [];

  return {
    version: 8,
    // Прозрачность зон анимируем сами, покадрово — встроенные плавные переходы только мешают.
    transition: { duration: 0, delay: 0 },
    sources: {
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 12,
        attribution: ATTRIBUTION,
      },
      ocean: { type: 'geojson', data: `${base}basemap/ocean.geojson` },
      'ocean-lining': { type: 'geojson', data: `${base}basemap/ocean-lining.geojson` },
      lakes: { type: 'geojson', data: `${base}basemap/lakes.geojson` },
      rivers: { type: 'geojson', data: `${base}basemap/rivers.geojson` },
      coastline: { type: 'geojson', data: `${base}basemap/coastline.geojson` },
      dagestan: { type: 'geojson', data: `${base}basemap/dagestan.geojson` },
      polities: { type: 'geojson', data: politiesData },
      'polity-outline': { type: 'geojson', data: outlines(politiesData), lineMetrics: true },
      route: { type: 'geojson', data: route },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': p.land } },
      {
        id: 'hillshade', type: 'hillshade', source: 'dem',
        paint: {
          'hillshade-shadow-color': p.shadow,
          'hillshade-highlight-color': p.highlight,
          'hillshade-accent-color': p.accent,
          'hillshade-exaggeration': p.exaggeration,
          'hillshade-illumination-direction': 315,
        },
      },
      ...polityLayers(theme, op),
      { id: 'ocean', type: 'fill', source: 'ocean', paint: { 'fill-color': p.water } },
      ...waterLining,
      { id: 'lakes', type: 'fill', source: 'lakes', filter: lakeFilter, paint: { 'fill-color': p.water } },
      {
        id: 'lakes-line', type: 'line', source: 'lakes', filter: lakeFilter,
        paint: { 'line-color': p.coast, 'line-width': 0.6, 'line-opacity': 0.6 },
      },
      {
        id: 'rivers', type: 'line', source: 'rivers',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.river,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, ['-', 1.6, ['*', 0.12, ['get', 'scalerank']]], 9, 2.5],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'coast', type: 'line', source: 'coastline',
        paint: {
          'line-color': p.coast,
          'line-width': theme === 'old' ? 1.3 : 0.9,
          'line-opacity': theme === 'old' ? 0.9 : 0.8,
        },
      },
      {
        // Ориентир: граница современной Республики Дагестан (всегда видна, не историческая).
        id: 'dagestan-outline', type: 'line', source: 'dagestan',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': theme === 'old' ? '#3a2a18' : '#e8dcc4',
          'line-width': 1.4,
          'line-opacity': theme === 'old' ? 0.55 : 0.45,
          'line-dasharray': [2, 2],
        },
      },
      // «Тропа» событий эпохи по порядку: пройденная часть — сплошная, впереди — пунктир.
      {
        id: 'route-todo', type: 'line', source: 'route', filter: ['==', ['get', 'part'], 'todo'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE[theme], 'line-width': 2, 'line-opacity': 0.45, 'line-dasharray': [1.5, 2] },
      },
      {
        id: 'route-done', type: 'line', source: 'route', filter: ['==', ['get', 'part'], 'done'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE[theme], 'line-width': 3, 'line-opacity': 0.8 },
      },
    ],
  };
}

/** Рисует штриховку нужного цвета для «старой карты» (по запросу MapLibre). */
export function makeHatch(color: string): ImageData {
  const size = 12;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'square';
  ctx.beginPath();
  // Диагональ и два «хвоста», чтобы узор был бесшовным.
  ctx.moveTo(0, size); ctx.lineTo(size, 0);
  ctx.moveTo(-size / 2, size / 2); ctx.lineTo(size / 2, -size / 2);
  ctx.moveTo(size / 2, size * 1.5); ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}
