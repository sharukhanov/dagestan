// Карточка события: боковая панель на десктопе, выезжающая снизу — на телефоне.
import { eventById, formatEventDate, sources, epochs, glossary, glossaryById } from '../data';
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

// --- Пояснения терминов: первое упоминание в карточке становится кнопкой ---

const termRx = glossary.map((g) => ({
  id: g.id,
  rx: new RegExp(`(?<![\\p{L}])(?:${g.match.join('|')})\\p{L}*`, 'iu'),
}));

/** Экранирует текст и подсвечивает термины, ещё не встречавшиеся в этой карточке. */
function annotate(text: string, seen: Set<string>): string {
  let html = esc(text);
  for (const { id, rx } of termRx) {
    if (seen.has(id)) continue;
    const m = rx.exec(html);
    if (!m) continue;
    seen.add(id);
    html = html.slice(0, m.index) + `<button type="button" class="term" data-term="${id}">${m[0]}</button>` + html.slice(m.index + m[0].length);
  }
  return html;
}

function detailsBlock(ev: HistEvent, seen: Set<string>): string {
  if (!ev.details.length) return '';
  const rows = ev.details
    .map((d) => `<li><span class="d-label">${esc(d.label)}</span><span class="d-text">${annotate(d.text, seen)}</span></li>`)
    .join('');
  return `<section class="card-details"><h3>Подробнее</h3><ol>${rows}</ol></section>`;
}

function relatedBlock(ev: HistEvent): string {
  const item = (id: string, kind: 'before' | 'ledTo') => {
    const other = eventById.get(id);
    if (!other) return '';
    const label = kind === 'before' ? '← До этого' : 'К чему привело →';
    return `<button type="button" class="rel rel-${kind}" data-goto="${other.id}">` +
      `<span class="rel-kind">${label}</span><b>${esc(other.title)}</b><small>${esc(formatEventDate(other))}</small></button>`;
  };
  const before = ev.related.filter((r) => r.relation === 'before').map((r) => item(r.id, 'before')).join('');
  const after = ev.related.filter((r) => r.relation === 'ledTo').map((r) => item(r.id, 'ledTo')).join('');
  if (!before && !after) return '';
  return `<section class="card-related"><div class="rel-col">${before}</div><div class="rel-col">${after}</div></section>`;
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
  const seen = new Set<string>();
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
        <p class="card-summary">${annotate(ev.summary, seen)}</p>
        <p class="card-why"><b>Почему это важно.</b> ${annotate(ev.whyImportant, seen)}</p>
        ${relatedBlock(ev)}
        ${detailsBlock(ev, seen)}
        ${sourcesBlock(ev)}
      </div>
    </div>`;
}

export function initCard(el: HTMLElement) {
  // Всплывающее пояснение термина — под словом, внутри прокручиваемой карточки.
  const showTerm = (term: HTMLElement) => {
    el.querySelector('.term-pop')?.remove();
    const g = glossaryById.get(term.dataset.term!);
    if (!g) return;
    const scroll = el.querySelector<HTMLElement>('.card-scroll')!;
    const pop = document.createElement('div');
    pop.className = 'term-pop';
    const ev = g.evidence[0];
    const src = sources.get(ev.source);
    pop.innerHTML = `<b>${esc(g.term)}</b><p>${esc(g.text)}</p><small>${esc(src?.title ?? '')}${ev.pages ? `, ${esc(ev.pages)}` : ''}</small>`;
    const r = term.getBoundingClientRect();
    const sr = scroll.getBoundingClientRect();
    pop.style.top = `${r.bottom - sr.top + scroll.scrollTop + 6}px`;
    scroll.appendChild(pop);
  };

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
    const term = t.closest<HTMLElement>('.term');
    const pop = el.querySelector<HTMLElement>('.term-pop');
    if (term) showTerm(term);
    else if (pop && !t.closest('.term-pop')) pop.remove();
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
