// Временная шкала: перетаскивается мышью и пальцем, с инерцией,
// цветными полосами эпох и обзорной полоской для быстрого перехода.
//
// Масштаб неравномерный: каждая эпоха получает ширину ~ √длительности,
// поэтому тысяча лет древности и четыре года революции обе остаются читаемыми.
import { epochs, events, eventSpan, epochAt, yearLabel, centuryOf } from '../data';
import { getState, setState, subscribe } from '../state';

interface Segment { start: number; end: number; x0: number; x1: number; color: string; title: string; id: string | null }

const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

export interface TimelineOptions {
  /** Сколько лет вокруг бегунка считается «текущим моментом» для показа событий. */
  onWindowChange: (years: number) => void;
}

export function initTimeline(root: HTMLElement, opts: TimelineOptions) {
  root.innerHTML = `
    <div class="tl-viewport" tabindex="0" role="slider" aria-label="Год">
      <div class="tl-track"></div>
    </div>
    <div class="tl-needle" aria-hidden="true"><div class="tl-bubble"><b></b><small></small></div></div>
    <div class="tl-overview" aria-label="Эпохи — быстрый переход"></div>
    <div class="tl-zoom">
      <button type="button" data-z="-1" aria-label="Уменьшить масштаб шкалы">−</button>
      <button type="button" data-z="1" aria-label="Увеличить масштаб шкалы">+</button>
    </div>`;
  const overview = root.querySelector<HTMLElement>('.tl-overview')!;
  const viewport = root.querySelector<HTMLElement>('.tl-viewport')!;
  const track = root.querySelector<HTMLElement>('.tl-track')!;
  const bubbleYear = root.querySelector<HTMLElement>('.tl-bubble b')!;
  const bubbleSub = root.querySelector<HTMLElement>('.tl-bubble small')!;

  let zoom = 1;
  let segments: Segment[] = [];
  let width = 0;
  let posX = 0; // координата бегунка на дорожке, px
  let anim = 0;

  // --- Геометрия ---

  function buildSegments() {
    const unit = Math.max(9, Math.min(16, window.innerWidth / 70)) * zoom;
    const segs: Segment[] = [];
    let x = 0;
    epochs.forEach((ep, i) => {
      const add = (start: number, end: number, color: string, title: string, id: string | null) => {
        const w = (6 + Math.sqrt(end - start)) * unit;
        segs.push({ start, end, x0: x, x1: x + w, color, title, id });
        x += w;
      };
      const prev = epochs[i - 1];
      if (prev && prev.end < ep.start) add(prev.end, ep.start, '#555', '', null);
      add(ep.start, ep.end, ep.color, ep.title, ep.id);
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
    for (const s of segments) {
      const w = s.x1 - s.x0;
      parts.push(
        `<button type="button" class="tl-band" ${s.id ? `data-epoch="${s.id}"` : 'disabled'} style="left:${s.x0}px;width:${w}px;--c:${s.color}">` +
        `<span>${s.title}</span></button>`,
      );
      const ppy = w / (s.end - s.start);
      const step = TICK_STEPS.find((st) => st * ppy >= 56) ?? 1000;
      const first = Math.ceil(s.start / step) * step;
      for (let y = first; y < s.end; y += step) {
        if (y === 0) continue;
        const x = s.x0 + (y - s.start) * ppy;
        const major = y === first || (y / step) % 2 === 0;
        parts.push(`<div class="tl-tick${major ? ' major' : ''}" style="left:${x}px"><span>${yearLabel(y, true)}</span></div>`);
      }
    }
    for (const ev of events) {
      const [a, b] = eventSpan(ev);
      const x0 = yearToX(a);
      const x1 = yearToX(b);
      parts.push(
        `<button type="button" class="tl-event${ev.verified ? '' : ' unverified'}" data-event="${ev.id}" ` +
        `style="left:${x0}px;width:${Math.max(0, x1 - x0)}px" title="${ev.title.replace(/"/g, '&quot;')}"></button>`,
      );
    }
    track.innerHTML = parts.join('');
    track.style.width = `${width}px`;

    overview.innerHTML = segments
      .filter((s) => s.id)
      .map((s) => `<button type="button" data-epoch="${s.id}" style="flex:${s.x1 - s.x0};--c:${s.color}" title="${s.title}"><span>${s.title}</span></button>`)
      .join('') + '<div class="tl-ov-cursor"></div>';
  }

  function paint() {
    const half = viewport.clientWidth / 2;
    track.style.transform = `translate3d(${half - posX}px,0,0)`;
    const y = roundYear(xToYear(posX));
    bubbleYear.textContent = yearLabel(y);
    bubbleSub.textContent = centuryOf(y);
    viewport.setAttribute('aria-valuenow', String(y));
    viewport.setAttribute('aria-valuetext', `${yearLabel(y)} год`);
    const cur = overview.querySelector<HTMLElement>('.tl-ov-cursor');
    if (cur) cur.style.left = `${(posX / width) * 100}%`;
    const ep = epochAt(y);
    for (const b of overview.querySelectorAll<HTMLElement>('button')) b.classList.toggle('active', b.dataset.epoch === ep?.id);
    opts.onWindowChange(Math.max(0.5, 36 / pxPerYearAt(posX)));
  }

  function setPos(x: number, commit = true) {
    posX = Math.min(Math.max(x, 0), width);
    paint();
    if (commit) setState({ year: roundYear(xToYear(posX)) });
  }

  function animateTo(x: number, duration = 700) {
    cancelAnimationFrame(anim);
    const from = posX;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setPos(from + (x - from) * e, k === 1);
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
    setPos(startPos - dx);
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
        setPos(posX - v);
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

  overview.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-epoch]');
    if (b) goToEpoch(b.dataset.epoch!);
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setPos(posX + d);
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
    else if (e.key === 'End') next = epochs[epochs.length - 1].end;
    if (next === null) return;
    e.preventDefault();
    if (next === 0) next = next > y ? 1 : -1;
    setPos(yearToX(next), false);
    setState({ year: next });
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
    if (ep) animateTo(yearToX(ep.start) + 2);
  }

  function goToEvent(id: string) {
    setState({ eventId: id });
  }

  // Внешние изменения года (клик по связанному событию, ссылка) — плавно едем к нему.
  subscribe((s, prev) => {
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
}
