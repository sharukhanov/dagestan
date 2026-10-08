// Схема данных из папки data/. Её используют и сайт (только типы),
// и скрипт проверки scripts/validate-data.ts (сами схемы zod).
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9-]+$/, 'id: только латиница в нижнем регистре, цифры и дефис');
/** Год: целое число, до н. э. — отрицательное (−300 = 300 г. до н. э.). Нулевого года нет. */
const year = z.number().int().refine((y) => y !== 0, 'Нулевого года нет: 1 г. до н. э. = -1');
const coords = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const DatePartsSchema = z.object({
  year,
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
});

export const SourceRefSchema = z.object({
  id,
  pages: z.string().optional(),
  section: z.string().optional(),
});

export const EvidenceSchema = z.object({
  source: id,
  pages: z.string().optional(),
  section: z.string().optional(),
  /** Дословный фрагмент текста источника. */
  quote: z.string().min(10),
});

export const DetailSchema = z.object({
  /** Метка слева: дата или короткий заголовок («1839», «июнь–август 1839», «Деталь»). */
  label: z.string(),
  text: z.string(),
});

export const ImageSchema = z.object({
  /** Путь внутри public/, например "images/events/gunib.webp". */
  file: z.string(),
  imageType: z.enum(['real', 'reconstruction']),
  caption: z.string(),
  author: z.string(),
  license: z.string(),
  licenseUrl: z.string().url().optional(),
  /** Страница файла на Wikimedia Commons (для real обязательно). */
  sourceUrl: z.string().url().optional(),
});

export const EventSchema = z.object({
  id,
  title: z.string(),
  start: DatePartsSchema,
  end: DatePartsSchema.nullable().optional(),
  datePrecision: z.enum(['day', 'month', 'year', 'decade', 'century', 'approx']),
  /** Своя подпись даты вместо автоматической: «III тыс. до н. э.», «10–9 тыс. лет назад». */
  dateLabel: z.string().optional(),
  /** Короткая оговорка о дате: «по разным данным…», «по старому стилю…». */
  dateNote: z.string().optional(),
  place: z.string(),
  coords,
  epoch: id,
  summary: z.string(),
  whyImportant: z.string(),
  /** «Подробнее»: хронология и интересные детали — по пункту на строку. */
  details: z.array(DetailSchema).default([]),
  related: z.array(z.object({ id, relation: z.enum(['before', 'ledTo']) })).default([]),
  image: ImageSchema.nullable().default(null),
  sources: z.array(SourceRefSchema).default([]),
  verified: z.boolean(),
  evidence: z.array(EvidenceSchema).default([]),
});

export const EpochSchema = z.object({
  id,
  title: z.string(),
  start: year,
  end: year,
  summary: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Откуда взята периодизация (издание и раздел). */
  periodization: SourceRefSchema.optional(),
  /** Подпериоды по главам источника — тонкие метки на шкале. */
  subperiods: z.array(z.object({
    title: z.string(),
    start: year,
    end: year,
    periodization: SourceRefSchema.optional(),
  })).default([]),
  note: z.string().optional(),
});

export const PlaceSchema = z.object({
  id,
  name: z.string(),
  altNames: z.array(z.string()).default([]),
  type: z.enum(['city', 'fortress', 'settlement', 'monument']),
  coords,
  start: year,
  /** null — существует до сих пор. */
  end: year.nullable(),
  /** true — годы условные. */
  approx: z.boolean().default(false),
  /** История названий: с какого года какое имя показывать на карте. */
  names: z.array(z.object({
    from: year,
    name: z.string(),
    approx: z.boolean().default(false),
    source: SourceRefSchema.optional(),
  })).default([]),
  note: z.string().optional(),
  sources: z.array(SourceRefSchema).default([]),
});

export const SourceSchema = z.object({
  id,
  author: z.string(),
  title: z.string(),
  year: z.string(),
  type: z.enum(['collective', 'monograph', 'primary', 'article', 'reference', 'web']),
  url: z.string().url().optional(),
  note: z.string().optional(),
  /** Имя текстового файла в research/txt/ (без .txt) — по нему проверяются цитаты evidence. */
  researchFile: z.string().optional(),
});

export const PolityPropsSchema = z.object({
  polityId: id,
  name: z.string(),
  start: year,
  end: year,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  note: z.string().optional(),
  /** Где поставить подпись [долгота, широта]; если нет — центр полигона. */
  labelAt: coords.optional(),
  sources: z.array(SourceRefSchema).default([]),
});

export const GlossarySchema = z.object({
  id,
  /** Как термин называется в пояснении. */
  term: z.string(),
  /** Начала слов (регулярные выражения, без учёта регистра), по которым термин ищется в тексте. */
  match: z.array(z.string()).min(1),
  /** Пояснение: 1–2 предложения, кто это относительно современных народов. */
  text: z.string(),
  sources: z.array(SourceRefSchema).default([]),
  evidence: z.array(EvidenceSchema).min(1),
});

export type GlossaryItem = z.infer<typeof GlossarySchema>;
export type DateParts = z.infer<typeof DatePartsSchema>;
export type HistEvent = z.infer<typeof EventSchema>;
export type Epoch = z.infer<typeof EpochSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type PolityProps = z.infer<typeof PolityPropsSchema>;
export type Detail = z.infer<typeof DetailSchema>;
export type ImageInfo = z.infer<typeof ImageSchema>;
