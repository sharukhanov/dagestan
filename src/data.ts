// Загрузка контента из data/ и вспомогательные функции для дат.
import epochsJson from '../data/epochs.json';
import eventsJson from '../data/events.json';
import placesJson from '../data/places.json';
import sourcesJson from '../data/sources.json';
import glossaryJson from '../data/glossary.json';
import politiesRaw from '../data/polities.geojson?raw';
import type { DateParts, Epoch, GlossaryItem, HistEvent, Place, PolityProps, Source } from './schema';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

export const epochs = (epochsJson as unknown as Epoch[])
  .map((e) => ({ ...e, subperiods: e.subperiods ?? [] }))
  .sort((a, b) => a.start - b.start);
export const events = (eventsJson as unknown as HistEvent[]).map((e) => ({
  ...e,
  related: e.related ?? [],
  details: e.details ?? [],
  sources: e.sources ?? [],
  evidence: e.evidence ?? [],
  image: e.image ?? null,
}));
export const places = (placesJson as unknown as Place[]).map((p) => ({ ...p, altNames: p.altNames ?? [] }));
export const sources = new Map((sourcesJson as Source[]).map((s) => [s.id, s]));
export const polities = JSON.parse(politiesRaw) as FeatureCollection<Polygon | MultiPolygon, PolityProps>;

export const glossary = glossaryJson as GlossaryItem[];
export const glossaryById = new Map(glossary.map((g) => [g.id, g]));

export const eventById = new Map(events.map((e) => [e.id, e]));

/** Ключ сортировки событий по дате (год, месяц, день). */
export const byDate = (e: HistEvent) => e.start.year * 400 + (e.start.month ?? 0) * 32 + (e.start.day ?? 0);

/** События эпохи по порядку дат. */
export function eventsOfEpoch(epochId: string): HistEvent[] {
  return events.filter((e) => e.epoch === epochId).sort((a, b) => byDate(a) - byDate(b));
}

export const timeStart = epochs[0].start;
export const timeEnd = epochs[epochs.length - 1].end;

/** Год события как дробное число (для сортировки и попадания в окно шкалы). */
export function eventSpan(e: HistEvent): [number, number] {
  return [e.start.year, (e.end ?? e.start).year];
}

export function epochAt(year: number): Epoch | undefined {
  return epochs.find((e) => year >= e.start && year < e.end) ?? (year >= timeEnd ? epochs[epochs.length - 1] : undefined);
}

// --- Форматирование дат ---

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export function toRoman(n: number): string {
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export function centuryOf(year: number): string {
  const c = year > 0 ? Math.ceil(year / 100) : Math.ceil(-year / 100);
  return `${toRoman(c)} в.${year < 0 ? ' до н. э.' : ''}`;
}

/** «1741», «300 до н. э.» — для шкалы и бегунка. */
export function yearLabel(year: number, short = false): string {
  if (year < 0) return `${-year}${short ? ' до н.э.' : ' до н. э.'}`;
  return String(year);
}

function partLabel(d: DateParts, precision: HistEvent['datePrecision']): string {
  const y = yearLabel(d.year);
  const bc = d.year < 0;
  switch (precision) {
    case 'day':
      if (d.day && d.month) return `${d.day} ${MONTHS_GEN[d.month - 1]} ${y}${bc ? '' : ' г.'}`;
      if (d.month) return `${MONTHS_NOM[d.month - 1]} ${y}${bc ? '' : ' г.'}`;
      return `${y}${bc ? '' : ' г.'}`;
    case 'month':
      return d.month ? `${MONTHS_NOM[d.month - 1]} ${y}${bc ? '' : ' г.'}` : `${y}${bc ? '' : ' г.'}`;
    case 'decade': {
      const dec = Math.floor(Math.abs(d.year) / 10) * 10;
      return `${dec}-е${bc ? ' до н. э.' : ''}`;
    }
    case 'century':
      return centuryOf(d.year);
    default:
      return `${y}${bc ? '' : ' г.'}`;
  }
}

export function formatEventDate(e: HistEvent): string {
  if (e.dateLabel) return e.dateLabel;
  const start = partLabel(e.start, e.datePrecision);
  let s = start;
  if (e.end && (e.end.year !== e.start.year || e.end.month !== e.start.month || e.end.day !== e.start.day)) {
    const end = partLabel(e.end, e.datePrecision);
    if (end !== start) s = `${start.replace(/ г\.$/, '')} — ${end}`;
  }
  if (e.datePrecision === 'approx') s = `около ${s}`.replace('около около', 'около');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
