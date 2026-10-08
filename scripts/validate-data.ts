// Проверка данных в data/: схема, ссылки между файлами и правила проверки фактов.
// Запуск: npm run validate (выполняется и перед каждой сборкой).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  EventSchema, EpochSchema, PlaceSchema, SourceSchema, PolityPropsSchema, GlossarySchema,
} from '../src/schema.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors: string[] = [];
const warnings: string[] = [];

function load<T>(file: string, schema: z.ZodType<T>): T[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(root, 'data', file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: не читается как JSON — ${(e as Error).message}`);
    return [];
  }
  const items = file.endsWith('.geojson')
    ? ((raw as { features?: { properties: unknown }[] }).features ?? []).map((f) => f.properties)
    : (raw as unknown[]);
  if (!Array.isArray(items)) {
    errors.push(`${file}: ожидается массив`);
    return [];
  }
  const out: T[] = [];
  items.forEach((item, i) => {
    const r = schema.safeParse(item);
    const label = (item as { id?: string; polityId?: string })?.id ?? (item as { polityId?: string })?.polityId ?? `#${i}`;
    if (r.success) out.push(r.data);
    else for (const issue of r.error.issues) errors.push(`${file} → ${label} → ${issue.path.join('.') || '(объект)'}: ${issue.message}`);
  });
  return out;
}

function dupes(file: string, ids: string[]) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${file}: повторяется id "${id}"`);
    seen.add(id);
  }
}

const epochs = load('epochs.json', EpochSchema);
const events = load('events.json', EventSchema);
const places = load('places.json', PlaceSchema);
const sources = load('sources.json', SourceSchema);
const polities = load('polities.geojson', PolityPropsSchema);
const glossary = load('glossary.json', GlossarySchema);

dupes('epochs.json', epochs.map((e) => e.id));
dupes('events.json', events.map((e) => e.id));
dupes('places.json', places.map((p) => p.id));
dupes('sources.json', sources.map((s) => s.id));

const epochIds = new Map(epochs.map((e) => [e.id, e]));
const eventIds = new Set(events.map((e) => e.id));
const sourceById = new Map(sources.map((s) => [s.id, s]));

for (const ep of epochs) {
  if (ep.end <= ep.start) errors.push(`epochs.json → ${ep.id}: конец раньше начала`);
  if (ep.periodization && !sourceById.has(ep.periodization.id))
    errors.push(`epochs.json → ${ep.id}: нет источника "${ep.periodization.id}" в sources.json`);
}

for (const ev of events) {
  const where = `events.json → ${ev.id}`;
  const epoch = epochIds.get(ev.epoch);
  if (!epoch) errors.push(`${where}: нет эпохи "${ev.epoch}" в epochs.json`);
  else if (ev.start.year < epoch.start || ev.start.year > epoch.end)
    warnings.push(`${where}: год ${ev.start.year} вне рамок эпохи «${epoch.title}» (${epoch.start}–${epoch.end})`);
  if (ev.end && ev.end.year < ev.start.year) errors.push(`${where}: конец раньше начала`);
  for (const r of ev.related) if (!eventIds.has(r.id)) errors.push(`${where}: связанное событие "${r.id}" не найдено`);
  for (const s of ev.sources) if (!sourceById.has(s.id)) errors.push(`${where}: источник "${s.id}" не найден в sources.json`);
  for (const e of ev.evidence) if (!sourceById.has(e.source)) errors.push(`${where}: evidence ссылается на неизвестный источник "${e.source}"`);
  if (ev.verified) {
    if (ev.evidence.length === 0) errors.push(`${where}: verified=true, но нет evidence (цитаты из источника)`);
    for (const e of ev.evidence) {
      if (!sourceById.get(e.source)?.url) errors.push(`${where}: verified=true, но у источника "${e.source}" нет ссылки (url)`);
    }
  }
  if (ev.image) {
    if (!existsSync(join(root, 'public', ev.image.file))) errors.push(`${where}: нет файла изображения public/${ev.image.file}`);
    if (ev.image.imageType === 'real' && !ev.image.sourceUrl) errors.push(`${where}: у реального изображения нет sourceUrl`);
  }
  const sentences = ev.summary.split(/[.!?…]+\s/).length;
  if (sentences > 6) warnings.push(`${where}: в описании ${sentences} предложений — лучше 3–5`);
}

// Цитаты evidence сверяются с текстом источника, если он скачан в research/txt/
// (в CI папки research/ нет — тогда проверка пропускается).
// Сравниваем без пробелов, дефисов и переносов: pdftotext по-разному склеивает строки.
const norm = (t: string) =>
  t.replace(/[«»“”"„]/g, '"').replace(/[\u00ad\-–—−\s]/g, '').replace(/ё/g, 'е').toLowerCase();
const textCache = new Map<string, string | null>();
function sourceText(file: string): string | null {
  if (!textCache.has(file)) {
    const path = join(root, 'research', 'txt', `${file}.txt`);
    textCache.set(file, existsSync(path) ? norm(readFileSync(path, 'utf8')) : null);
  }
  return textCache.get(file)!;
}
let quotesChecked = 0;
const withEvidence = [
  ...events.map((e) => ({ where: `events.json → ${e.id}`, evidence: e.evidence })),
  ...glossary.map((g) => ({ where: `glossary.json → ${g.id}`, evidence: g.evidence })),
];
for (const g of glossary) {
  for (const e of g.evidence) if (!sourceById.has(e.source)) errors.push(`glossary.json → ${g.id}: неизвестный источник "${e.source}"`);
  for (const m of g.match) {
    try { new RegExp(m, 'iu'); } catch { errors.push(`glossary.json → ${g.id}: неверное выражение "${m}"`); }
  }
}
for (const ev of withEvidence) {
  for (const e of ev.evidence) {
    const file = sourceById.get(e.source)?.researchFile;
    const text = file ? sourceText(file) : null;
    if (!text) continue;
    quotesChecked++;
    if (!text.includes(norm(e.quote))) errors.push(`${ev.where}: цитата не найдена в тексте источника "${e.source}": «${e.quote.slice(0, 80)}…»`);
  }
}

for (const p of places) {
  if (p.end !== null && p.end < p.start) errors.push(`places.json → ${p.id}: конец раньше начала`);
  const refs = [...p.sources, ...p.names.flatMap((n) => (n.source ? [n.source] : []))];
  for (const s of refs)
    if (!sourceById.has(s.id)) errors.push(`places.json → ${p.id}: нет источника "${s.id}" в sources.json`);
}
for (const p of polities) {
  if (p.end < p.start) errors.push(`polities.geojson → ${p.polityId}: конец раньше начала`);
}

for (const w of warnings) console.warn('⚠ ' + w);
if (errors.length) {
  for (const e of errors) console.error('✖ ' + e);
  console.error(`\nОшибок: ${errors.length}. Исправьте их — сайт не соберётся.`);
  process.exit(1);
}
const verified = events.filter((e) => e.verified).length;
if (quotesChecked) console.log(`✔ Цитат сверено с текстами источников: ${quotesChecked}`);
console.log(`✔ Данные в порядке: эпох ${epochs.length}, событий ${events.length} (проверено ${verified}), мест ${places.length}, зон ${polities.length}, источников ${sources.length}.`);
