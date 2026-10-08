// Панель «Источники»: все издания из data/sources.json и данные, на которых построена карта.
import { epochs, events, glossary, sources } from '../data';
import type { Source } from '../schema';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const GROUPS: { type: Source['type'][]; title: string }[] = [
  { type: ['collective'], title: 'Обобщающие академические труды' },
  { type: ['monograph'], title: 'Монографии' },
  { type: ['primary'], title: 'Первоисточники в научных изданиях' },
  { type: ['article'], title: 'Статьи в научных журналах' },
  { type: ['reference', 'web'], title: 'Справочные издания' },
];

/** Сколько событий опирается на источник (в списке источников или в цитатах). */
function usage(): Map<string, { events: number; verified: number }> {
  const m = new Map<string, { events: number; verified: number }>();
  for (const ev of events) {
    const ids = new Set([...ev.sources.map((s) => s.id), ...ev.evidence.map((e) => e.source)]);
    for (const id of ids) {
      const u = m.get(id) ?? { events: 0, verified: 0 };
      u.events++;
      if (ev.verified && ev.evidence.some((e) => e.source === id)) u.verified++;
      m.set(id, u);
    }
  }
  return m;
}

function render(): string {
  const use = usage();
  const periodization = new Set(epochs.flatMap((e) => [e.periodization?.id, ...e.subperiods.map((s) => s.periodization?.id)]).filter(Boolean));
  const inGlossary = new Set(glossary.flatMap((g) => g.evidence.map((e) => e.source)));
  const all = [...sources.values()];
  const groups = GROUPS.map((g) => {
    const items = all.filter((s) => g.type.includes(s.type));
    if (!items.length) return '';
    const li = items.map((s) => {
      const u = use.get(s.id);
      const tags = [
        u ? `событий: ${u.events}${u.verified ? `, с цитатами: ${u.verified}` : ''}` : '',
        periodization.has(s.id) ? 'периодизация эпох' : '',
        inGlossary.has(s.id) ? 'пояснения терминов' : '',
      ].filter(Boolean);
      const title = s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title);
      return `<li><div class="src-author">${esc(s.author)}</div><div class="src-title">${title}${s.year ? ` <span>(${esc(s.year)})</span>` : ''}</div>` +
        (s.note ? `<div class="src-note">${esc(s.note)}</div>` : '') +
        (tags.length ? `<div class="src-tags">${tags.map((t) => `<span>${t}</span>`).join('')}</div>` : '') + '</li>';
    }).join('');
    return `<h3>${g.title}</h3><ol>${li}</ol>`;
  }).join('');
  const verified = events.filter((e) => e.verified).length;
  return `
    <div class="src-head">
      <h2>Источники</h2>
      <button type="button" class="src-close" aria-label="Закрыть">×</button>
    </div>
    <div class="src-scroll">
      <p class="src-lead">Событие отмечено как проверенное, только если к нему приложена дословная цитата из источника с указанием страницы. Сейчас так подтверждено <b>${verified} из ${events.length}</b> событий. Википедия используется только для поиска литературы.</p>
      ${groups}
      <h3>Карта и изображения</h3>
      <ol>
        <li><div class="src-title"><a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a></div><div class="src-note">Береговая линия, реки, озёра и контур современного Дагестана (общественное достояние).</div></li>
        <li><div class="src-title"><a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a></div><div class="src-note">Цифровая модель рельефа для отмывки гор.</div></li>
        <li><div class="src-title"><a href="https://commons.wikimedia.org/" target="_blank" rel="noopener">Wikimedia Commons</a></div><div class="src-note">Изображения — только свободные лицензии; автор и лицензия указаны под каждой картинкой.</div></li>
        <li><div class="src-note">Зоны влияния государств нарисованы вручную по описаниям в источниках и показывают примерные границы.</div></li>
      </ol>
    </div>`;
}

export function initSourcesPanel(button: HTMLElement) {
  const panel = document.createElement('aside');
  panel.className = 'src-panel';
  panel.setAttribute('aria-label', 'Источники');
  panel.hidden = true;
  document.body.appendChild(panel);
  button.querySelector('.n')!.textContent = String(sources.size);

  const close = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.hidden) return close();
    panel.innerHTML = render();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  });
  panel.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.src-close')) close();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && e.target !== button) close();
  });
  // Esc закрывает сначала панель и не доходит до карточки события под ней.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    e.stopImmediatePropagation();
    close();
  }, true);
}
