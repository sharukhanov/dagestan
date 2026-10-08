// Временная шкала: перетаскивается мышью и пальцем, с инерцией,
// цветными полосами эпох, дорожкой событий и стрелками «предыдущее / следующее».
//
// Масштаб неравномерный: ширина отрезка растёт логарифмически от длительности,
// поэтому тысячелетия древности и четыре года революции обе остаются читаемыми.
import { epochs, events, eventSpan, yearLabel, centuryOf } from '../data';
import type { HistEvent } from '../schema';
import { getState, setState, subscribe } from '../state';

interface Segment { start: number; end: number; x0: number; x1: number; color: string; title: string; id: string | null }

const byDate = (e: HistEvent) => e.start.year * 400 + (e.start.month ?? 0) * 32 + (e.start.day ?? 0);
const sorted = events.slice().sort((a, b) => byDate(a) - byDate(b));

/** На сколько пикселей шкалы нужно увести бегунок от открытого события, чтобы карточка закрылась. */
const CLOSE_DISTANCE_PX = 150;

const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

export interface TimelineOptions {
  /** Сколько лет вокруг бегунка считается «текущим моментом» для показа событий. */
  onWindowChange: (years: number) => void;
}

export function initTimeline(root: HTMLElement, opts: TimelineOptions) {
  root.innerHTML = `
    <div class="tl-viewport" tabindex="0" role="slider" aria-label="Год">
      <div class="tl-track"></div>
    </div>
    <span class="tl-lane-label" aria-hidden="true">события</span>
    <div class="tl-needle" aria-hidden="true"><div class="tl-bubble"><b></b><small></small></div></div>
    <div class="tl-nav">
      <button type="button" class="tl-step prev" aria-label="Предыдущее событие"><span class="arr">‹</span><span class="txt"></span></button>
      <div class="tl-zoom">
        <button type="button" data-z="-1" aria-label="Уменьшить масштаб шкалы">−</button>
        <button type="button" data-z="1" aria-label="Увеличить масштаб шкалы">+</button>
      </div>
      <button type="button" class="tl-step next" aria-label="Следующее событие"><span class="txt"></span><span class="arr">›</span></button>
    </div>`;
  const viewport = root.querySelector<HTMLElement>('.tl-viewport')!;
  const track = root.querySelector<HTMLElement>('.tl-track')!;
  const bubbleYear = root.querySelector<HTMLElement>('.tl-bubble b')!;
  const prevBtn = root.querySelector<HTMLButtonElement>('.tl-step.prev')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('.tl-step.next')!;
  const bubbleSub = root.querySelector<HTMLElement>('.tl-bubble small')!;

  let zoom = 1;
  let segments: Segment[] = [];
  let width = 0;
  let posX = 0; // координата бегунка на дорожке, px
  let anim = 0;

  // --- Геометрия ---

  // Отрезки шкалы — подпериоды эпох (или эпоха целиком). Ширина отрезка растёт
  // логарифмически от длительности: тысячелетия каменного века не съедают всю шкалу,
  // а четыре года войны остаются видны.
  function buildSegments() {
    const unit = Math.max(9, Math.min(16, window.innerWidth / 70)) * zoom;
    const segs: Segment[] = [];
    let x = 0;
    const add = (start: number, end: number, color: string, title: string, id: string | null) => {
      if (end <= start) return;
      const w = (4 + 5 * Math.log(1 + (end - start) / 8)) * unit;
      segs.push({ start, end, x0: x, x1: x + w, color, title, id });
      x += w;
    };
    epochs.forEach((ep, i) => {
      const prev = epochs[i - 1];
      if (prev && prev.end < ep.start) add(prev.end, ep.start, '#555', '', null);
      const subs = ep.subperiods.slice().sort((a, b) => a.start - b.start);
      let cur = ep.start;
      for (const sp of subs) {
        if (sp.start > cur) add(cur, sp.start, ep.color, '', ep.id);
        add(Math.max(sp.start, cur), sp.end, ep.color, sp.title, ep.id);
        cur = Math.max(cur, sp.end);
      }
      if (cur < ep.end) add(cur, ep.end, ep.color, '', ep.id);
    });
    segments = segs;
    width = x;
  }

  function yearToX(year: number): number {
    const s = segments.find((g) => year <= g.end) ?? segments[segments.length - 1];
    const t = (Math.min(Math.max(year, s.start), s.end) - s.start) / (s.end - s.start);
    return s.x0 + t * (s.x1 - s.x0);
  }

  function xToYear(x: number): number {
    const s = segments.find((g) => x <= g.x1) ?? segments[segments.length - 1];
    const t = (Math.min(Math.max(x, s.x0), s.x1) - s.x0) / (s.x1 - s.x0);
    return s.start + t * (s.end - s.start);
  }

  function pxPerYearAt(x: number): number {
    const s = segments.find((g) => x <= g.x1) ?? segments[segments.length - 1];
    return (s.x1 - s.x0) / (s.end - s.start);
  }

  const roundYear = (y: number) => {
    const r = Math.round(y);
    return r === 0 ? (y < 0 ? -1 : 1) : r;
  };

  // --- Отрисовка ---

  function render() {
    buildSegments();
    const parts: string[] = [];
    for (const ep of epochs) {
      const x0 = yearToX(ep.start);
      const x1 = yearToX(ep.end);
      parts.push(
        `<button type="button" class="tl-band" data-epoch="${ep.id}" style="left:${x0}px;width:${x1 - x0}px;--c:${ep.color}">` +
        `<span>${ep.title}</span></button>`,
      );
    }
    let lastTickX = -Infinity;
    for (const s of segments) {
      const w = s.x1 - s.x0;
      if (s.title) {
        parts.push(`<div class="tl-sub" style="left:${s.x0}px;width:${w}px;--c:${s.color}" title="${s.title.replace(/"/g, '&quot;')}"><span>${s.title}</span></div>`);
      }
      const ppy = w / (s.end - s.start);
      // Шаг подбираем по ширине подписи: «2250 до н.э.» заметно длиннее, чем «1850».
      const labelPx = (y: number) => yearLabel(y, true).length * 6.3 + 16;
      const step = TICK_STEPS.find((st) => st * ppy >= Math.max(48, labelPx(Math.round(s.start / st) * st || st))) ?? TICK_STEPS[TICK_STEPS.length - 1];
      const first = Math.ceil(s.start / step) * step;
      for (let y = first; y < s.end; y += step) {
        if (y === 0) continue;
        const x = s.x0 + (y - s.start) * ppy;
        // На стыке отрезков метки соседних шагов могут встать вплотную — пропускаем.
        if (x - lastTickX < labelPx(y)) continue;
        lastTickX = x;
        const major = y === first || (y / step) % 2 === 0;
        parts.push(`<div class="tl-tick${major ? ' major' : ''}" style="left:${x}px"><span>${yearLabel(y, true)}</span></div>`);
      }
    }
    // Дорожка событий: точка в начале события, полоска на его длительность и подпись,
    // которая занимает место до следующей точки.
    const xs = sorted.map((ev) => yearToX(ev.start.year));
    sorted.forEach((ev, i) => {
      const [a, b] = eventSpan(ev);
      const x0 = xs[i];
      const x1 = yearToX(b);
      const room = (i + 1 < xs.length ? xs[i + 1] : x0 + 220) - x0 - 22;
      const title = ev.title.replace(/"/g, '&quot;');
      parts.push(
        (x1 - x0 > 3 ? `<div class="tl-span" style="left:${x0}px;width:${x1 - x0}px"></div>` : '') +
        `<button type="button" class="tl-event${ev.verified ? '' : ' unverified'}" data-event="${ev.id}" style="left:${x0}px" title="${title} · ${yearLabel(a)}">` +
        `<i></i>${room > 40 ? `<span style="max-width:${Math.min(room, 200)}px">${ev.title}</span>` : ''}</button>`,
      );
    });
    track.innerHTML = parts.join('');
    track.style.width = `${width}px`;
  }

  function paint() {
    const half = viewport.clientWidth / 2;
    track.style.transform = `translate3d(${half - posX}px,0,0)`;
    const y = roundYear(xToYear(posX));
    bubbleYear.textContent = yearLabel(y);
    bubbleSub.textContent = centuryOf(y);
    viewport.setAttribute('aria-valuenow', String(y));
    viewport.setAttribute('aria-valuetext', `${yearLabel(y)} год`);
    updateNav(y);
    opts.onWindowChange(Math.max(0.5, 36 / pxPerYearAt(posX)));
  }

  function setPos(x: number, commit = true, user = false) {
    posX = Math.min(Math.max(x, 0), width);
    paint();
    if (!commit) return;
    const year = roundYear(xToYear(posX));
    // Пользователь сам увёл шкалу от открытого события — закрываем его карточку.
    const id = getState().eventId;
    const ev = user && id ? events.find((e) => e.id === id) : undefined;
    if (ev) {
      // Закрываем, только когда событие заметно отошло от бегунка (а не от случайного сдвига).
      const [a, b] = eventSpan(ev);
      const xa = yearToX(a), xb = yearToX(b);
      const dist = posX < xa ? xa - posX : posX > xb ? posX - xb : 0;
      if (dist > CLOSE_DISTANCE_PX) { setState({ year, eventId: null }); return; }
    }
    setState({ year });
  }

  function animateTo(x: number, duration = 700, user = false) {
    cancelAnimationFrame(anim);
    const from = posX;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setPos(from + (x - from) * e, k === 1, user);
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  // --- Ввод ---

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startPos = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(anim);
    dragging = true;
    moved = false;
    startX = lastX = e.clientX;
    startPos = posX;
    lastT = performance.now();
    velocity = 0;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 5) {
      moved = true;
      viewport.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
    }
    if (!moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocity = 0.8 * velocity + 0.2 * ((e.clientX - lastX) / dt);
    lastX = e.clientX;
    lastT = now;
    setPos(startPos - dx, true, true);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('dragging');
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (moved && Math.abs(velocity) > 0.05) {
      // Инерция: продолжаем движение и плавно тормозим.
      let v = velocity * 16;
      const glide = () => {
        v *= 0.93;
        setPos(posX - v, true, true);
        if (Math.abs(v) > 0.3 && posX > 0 && posX < width) anim = requestAnimationFrame(glide);
      };
      anim = requestAnimationFrame(glide);
    }
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  // Клик после перетаскивания не должен открывать событие.
  viewport.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; return; }
    const t = e.target as HTMLElement;
    const evBtn = t.closest<HTMLElement>('[data-event]');
    if (evBtn) { goToEvent(evBtn.dataset.event!); return; }
    const band = t.closest<HTMLElement>('[data-epoch]');
    if (band) goToEpoch(band.dataset.epoch!);
  }, true);

  // --- Стрелки «предыдущее / следующее событие» ---

  function neighbours(y: number): [HistEvent | undefined, HistEvent | undefined] {
    const id = getState().eventId;
    const i = id ? sorted.findIndex((e) => e.id === id) : -1;
    if (i >= 0) return [sorted[i - 1], sorted[i + 1]];
    return [
      [...sorted].reverse().find((e) => e.start.year < y),
      sorted.find((e) => e.start.year > y),
    ];
  }

  function updateNav(y: number) {
    const [p, n] = neighbours(y);
    for (const [btn, ev] of [[prevBtn, p], [nextBtn, n]] as const) {
      btn.disabled = !ev;
      btn.dataset.event = ev?.id ?? '';
      btn.querySelector('.txt')!.textContent = ev ? `${yearLabel(ev.start.year)} · ${ev.title}` : '';
      btn.title = ev ? `${ev.title} (${yearLabel(ev.start.year)})` : '';
    }
  }

  for (const btn of [prevBtn, nextBtn]) {
    btn.addEventListener('click', () => {
      if (btn.dataset.event) goToEvent(btn.dataset.event);
    });
  }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setPos(posX + d, true, true);
  }, { passive: false });

  viewport.addEventListener('keydown', (e) => {
    const y = getState().year;
    const big = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = y + big;
    else if (e.key === 'ArrowLeft') next = y - big;
    else if (e.key === 'PageUp') next = y - 100;
    else if (e.key === 'PageDown') next = y + 100;
    else if (e.key === 'Home') next = epochs[0].start;
    else if (e.key === ']' || e.key === '[') {
      const [p, n] = neighbours(y);
      const ev = e.key === ']' ? n : p;
      if (ev) goToEvent(ev.id);
      e.preventDefault();
      return;
    }
    else if (e.key === 'End') next = epochs[epochs.length - 1].end;
    if (next === null) return;
    e.preventDefault();
    if (next === 0) next = next > y ? 1 : -1;
    setPos(yearToX(next), true, true);
  });

  root.querySelector('.tl-zoom')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-z]');
    if (!b) return;
    const year = xToYear(posX);
    zoom = Math.min(4, Math.max(0.5, zoom * (b.dataset.z === '1' ? 1.6 : 1 / 1.6)));
    render();
    setPos(yearToX(year), false);
  });

  function goToEpoch(id: string) {
    const ep = epochs.find((e) => e.id === id);
    if (ep) animateTo(yearToX(ep.start) + 2, 700, true);
  }

  function goToEvent(id: string) {
    setState({ eventId: id });
  }

  // Внешние изменения года (клик по связанному событию, ссылка) — плавно едем к нему.
  const markSelected = (id: string | null) => {
    for (const b of track.querySelectorAll<HTMLElement>('.tl-event')) b.classList.toggle('selected', b.dataset.event === id);
  };
  subscribe((s, prev) => {
    if (s.eventId !== prev.eventId) { updateNav(s.year); markSelected(s.eventId); }
    if (s.eventId && s.eventId !== prev.eventId) {
      const ev = events.find((e) => e.id === s.eventId);
      if (ev && roundYear(xToYear(posX)) !== ev.start.year) animateTo(yearToX(ev.start.year), 900);
    } else if (s.year !== prev.year && !dragging && roundYear(xToYear(posX)) !== s.year) {
      setPos(yearToX(s.year), false);
    }
  });

  window.addEventListener('resize', () => {
    const year = xToYear(posX);
    render();
    setPos(yearToX(year), false);
  });

  render();
  setPos(yearToX(getState().year), false);
  markSelected(getState().eventId);
}
