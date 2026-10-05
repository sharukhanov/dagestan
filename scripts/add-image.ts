// Добавляет изображение с Wikimedia Commons к событию:
// скачивает файл, сжимает в WebP, записывает автора, лицензию и ссылку в data/events.json.
//
//   npm run add-image -- "File:Название файла.jpg" event-id ["Подпись к изображению"]
//
// Принимаются только свободные лицензии: общественное достояние, CC0, CC BY, CC BY-SA.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'DagestanHistoryMap/0.1 (https://github.com/sharukhanov/dagestan)';

const [fileArg, eventId, captionArg] = process.argv.slice(2);
if (!fileArg || !eventId) {
  console.error('Использование: npm run add-image -- "File:Имя файла.jpg" event-id ["Подпись"]');
  process.exit(1);
}
const title = fileArg.startsWith('File:') ? fileArg : `File:${fileArg}`;

async function get(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status !== 429 && res.status < 500) return res;
    const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
    console.warn(`Commons ответил ${res.status}, жду ${wait} с…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  throw new Error(`Не удалось получить ${url}`);
}

const strip = (html = '') =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

const api = new URL('https://commons.wikimedia.org/w/api.php');
api.search = new URLSearchParams({
  action: 'query', format: 'json', formatversion: '2', titles: title,
  prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1400', iiextmetadatalanguage: 'ru',
}).toString();

const info = (await (await get(api.toString())).json()) as {
  query: { pages: { missing?: boolean; imageinfo?: { thumburl: string; descriptionurl: string; extmetadata: Record<string, { value: string }> }[] }[] };
};
const page = info.query.pages[0];
if (page.missing || !page.imageinfo) {
  console.error(`Файл не найден на Commons: ${title}`);
  process.exit(1);
}
const ii = page.imageinfo[0];
const meta = ii.extmetadata;
const license = strip(meta.LicenseShortName?.value) || 'неизвестно';
const free = /public domain|^pd\b|cc0|^cc[- ]by\b/i.test(license) && !/\b(nc|nd)\b/i.test(license);
if (!free) {
  console.error(`Лицензия «${license}» не подходит: нужны PD, CC0, CC BY или CC BY-SA.`);
  process.exit(1);
}
const author = strip(meta.Artist?.value) || 'Автор неизвестен';
const caption = captionArg || strip(meta.ImageDescription?.value).slice(0, 200) || title.replace(/^File:/, '');

const img = Buffer.from(await (await get(ii.thumburl)).arrayBuffer());
const rel = `images/events/${eventId}.webp`;
mkdirSync(join(root, 'public/images/events'), { recursive: true });
const out = await sharp(img).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 72 }).toFile(join(root, 'public', rel));

const eventsPath = join(root, 'data/events.json');
const events = JSON.parse(readFileSync(eventsPath, 'utf8')) as { id: string; image: unknown }[];
const ev = events.find((e) => e.id === eventId);
if (!ev) {
  console.error(`Событие ${eventId} не найдено в data/events.json (картинка сохранена в public/${rel}).`);
  process.exit(1);
}
ev.image = {
  file: rel,
  imageType: 'real',
  caption,
  author,
  license,
  ...(meta.LicenseUrl?.value ? { licenseUrl: meta.LicenseUrl.value } : {}),
  sourceUrl: ii.descriptionurl,
};
writeFileSync(eventsPath, JSON.stringify(events, null, 2) + '\n');
console.log(`✔ ${rel} (${Math.round(out.size / 1024)} КБ, ${out.width}×${out.height})`);
console.log(`  Автор: ${author}\n  Лицензия: ${license}\n  Подпись: ${caption}\n  Проверьте подпись и автора в data/events.json.`);
