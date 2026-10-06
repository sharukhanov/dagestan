// Карточка события: боковая панель на десктопе, выезжающая снизу — на телефоне.
import { eventById, formatEventDate, sources, epochs } from '../data';
import type { HistEvent } from '../schema';
import { getState, setState, subscribe } from '../state';

const base = import.meta.env.BASE_URL;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PLACEHOLDER = `
  <div class="card-placeholder" aria-hidden="true">
    <svg viewBox="0 0 120 60" width="120" height="60">
      <path d="M4 52 L30 20 L44 36 L62 10 L84 38 L96 26 L116 52 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="92" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
    </svg>
    <span>Изображение пока не подобрано</span>
  </div>`;

function imageBlock(ev: HistEvent): string {
  const img = ev.image;
  if (!img) return PLACEHOLDER;
  const license = img.licenseUrl
    ? `<a href="${esc(img.licenseUrl)}" target="_blank" rel="noopener">${esc(img.license)}</a>`
    : esc(img.license);
  const author = img.sourceUrl
    ? `<a href="${esc(img.sourceUrl)}" target="_blank" rel="noopener">${esc(img.author)}</a>`
    : esc(img.author);
  return `
    <figure class="card-figure">
      <img src="${base}${esc(img.file)}" alt="${esc(img.caption)}" loading="lazy" />
      ${img.imageType === 'reconstruction' ? '<span class="badge recon">Художественная реконструкция</span>' : ''}
      <figcaption>${esc(img.caption)}<br><small>${author} · ${license}</small></figcaption>
    </figure>`;
}

function detailsBlock(ev: HistEvent): string {
  if (!ev.details.length) return '';
  const rows = ev.details
    .map((d) => `<li><span class="d-label">${esc(d.label)}</span><span class="d-text">${esc(d.text)}</span></li>`)
    .join('');
  return `<section class="card-details"><h3>Подробнее</h3><ol>${rows}</ol></section>`;
}

function relatedBlock(ev: HistEvent): string {
  const groups: Record<string, string[]> = { before: [], ledTo: [] };
  for (const r of ev.related) {
    const other = eventById.get(r.id);
    if (!other) continue;
    groups[r.relation].push(
      `<button type="button" class="rel" data-goto="${other.id}"><span>${esc(other.title)}</span><small>${esc(formatEventDate(other))}</small></button>`,
    );
  }
  const out: string[] = [];
  if (groups.before.length) out.push(`<h3>До этого</h3>${groups.before.join('')}`);
  if (groups.ledTo.length) out.push(`<h3>К чему привело</h3>${groups.ledTo.join('')}`);
  return out.length ? `<section class="card-related">${out.join('')}</section>` : '';
}

function sourcesBlock(ev: HistEvent): string {
  const items = ev.sources.map((ref) => {
    const s = sources.get(ref.id);
    if (!s) return '';
    const where = [ref.section, ref.pages].filter(Boolean).join(', ');
    const title = s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title);
    return `<li>${esc(s.author)}. ${title} (${esc(s.year)})${where ? `. ${esc(where)}` : ''}</li>`;
  });
  const evidence = ev.evidence.map((e) => {
    const s = sources.get(e.source);
    const where = [e.section, e.pages].filter(Boolean).join(', ');
    return `<blockquote>«${esc(e.quote)}»<cite>${esc(s?.title ?? e.source)}${where ? `, ${esc(where)}` : ''}</cite></blockquote>`;
  });
  const status = ev.verified
    ? `<p class="status ok">✓ Факты сверены с источником</p>`
    : `<p class="status todo">Требует проверки по источникам</p>`;
  return `
    <details class="card-sources">
      <summary>Источники ${ev.sources.length ? `<span>${ev.sources.length}</span>` : ''}</summary>
      ${status}
      ${items.length ? `<ul>${items.join('')}</ul>` : '<p class="muted">Источники пока не указаны.</p>'}
      ${evidence.join('')}
    </details>`;
}

function render(ev: HistEvent): string {
  const epoch = epochs.find((e) => e.id === ev.epoch);
  return `
    <div class="card-handle" aria-hidden="true"></div>
    <button type="button" class="card-close" aria-label="Закрыть">×</button>
    <div class="card-scroll">
      ${imageBlock(ev)}
      <div class="card-body">
        <p class="card-meta">
          <span class="epoch-chip" style="--c:${epoch?.color ?? '#888'}">${esc(epoch?.title ?? '')}</span>
          ${ev.verified ? '' : '<span class="badge todo" title="Факты ещё не сверены с источником">требует проверки</span>'}
        </p>
        <h2>${esc(ev.title)}</h2>
        <p class="card-date">${esc(formatEventDate(ev))} · ${esc(ev.place)}</p>
        ${ev.dateNote ? `<p class="card-datenote">${esc(ev.dateNote)}</p>` : ''}
        <p class="card-summary">${esc(ev.summary)}</p>
        <p class="card-why"><b>Почему это важно.</b> ${esc(ev.whyImportant)}</p>
        ${detailsBlock(ev)}
        ${relatedBlock(ev)}
        ${sourcesBlock(ev)}
      </div>
    </div>`;
}

export function initCard(el: HTMLElement) {
  const open = (id: string | null) => {
    const ev = id ? eventById.get(id) : undefined;
    if (!ev) {
      el.classList.remove('open', 'full');
      el.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('card-open');
      return;
    }
    el.innerHTML = render(ev);
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('card-open');
    el.querySelector('.card-scroll')!.scrollTop = 0;
  };

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.card-close')) setState({ eventId: null });
    const rel = t.closest<HTMLElement>('[data-goto]');
    if (rel) setState({ eventId: rel.dataset.goto! });
  });

  // Телефон: потянуть за «ручку» вверх — развернуть, вниз — закрыть.
  let y0: number | null = null;
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.card-handle')) y0 = e.clientY;
  });
  window.addEventListener('pointerup', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0;
    y0 = null;
    if (dy < -40) el.classList.add('full');
    else if (dy > 60) {
      if (el.classList.contains('full')) el.classList.remove('full');
      else setState({ eventId: null });
    } else el.classList.toggle('full');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && getState().eventId) setState({ eventId: null });
  });

  open(getState().eventId);
  subscribe((s, prev) => {
    if (s.eventId !== prev.eventId) open(s.eventId);
  });
}
