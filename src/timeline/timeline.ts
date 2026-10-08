// Временная шкала: перетаскивается мышью и пальцем, с инерцией,
// цветными полосами эпох, дорожкой событий и стрелками «предыдущая / следующая эпоха».
//
// Масштаб неравномерный: ширина отрезка растёт логарифмически от длительности,
// поэтому тысячелетия древности и четыре года революции обе остаются читаемыми.
import { epochAt, epochs, eventsOfEpoch, events, eventSpan, yearLabel, centuryOf } from '../data';
import { getState, setState, subscribe } from '../state';

interface Segment { start: number; end: number; x0: number; x1: number; color: string; title: string; id: string | null }


/** На сколько пикселей шкалы нужно увести бегунок от открытого события, чтобы карточка закрылась. */
const CLOSE_DISTANCE_PX = 150;

const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

export function initTimeline(root: HTMLElement) {
  root.innerHTML = `
    <div class="tl-viewport" tabindex="0" role="slider" aria-label="Год">
      <div class="tl-track"></div>
    </div>
    <span class="tl-lane-label" aria-hidden="true">события</span>
    <div class="tl-needle" aria-hidden="true"><div class="tl-bubble"><b></b><small></small></div></div>
    <div class="tl-nav">
      <button type="button" class="tl-step prev" aria-label="Предыдущая эпоха"><span class="arr">‹</span><span class="txt"></span></button>
      <div class="tl-zoom">
        <button type="button" data-z="-1" aria-label="Уменьшить масштаб шкалы">−</button>
        <button type="button" data-z="1" aria-label="Увеличить масштаб шкалы">+</button>
      </div>
      <button type="button" class="tl-step next" aria-label="Следующая эпоха"><span class="txt"></span><span class="arr">›</span></button>
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
    // Дорожка событий заполняется отдельно — только событиями текущей эпохи.
    parts.push('<div class="tl-lane"></div>');
    track.innerHTML = parts.join('');
    renderLane();
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

  // Плавный переезд бегунка. commit=false — только картинка: год уже выставлен заранее,
  // чтобы карта переключилась сразу, а не после анимации.
  let visualOnly = false;
  function stopAnim() {
    cancelAnimationFrame(anim);
    visualOnly = false;
  }
  function animateTo(x: number, duration = 700, user = false, commit = true) {
    stopAnim();
    visualOnly = !commit;
    const from = posX;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setPos(from + (x - from) * e, commit && k === 1, user);
      if (k < 1) anim = requestAnimationFrame(step);
      else visualOnly = false;
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
    stopAnim();
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

  // --- Стрелки «предыдущая / следующая эпоха» ---

  function epochNeighbours(y: number) {
    const i = epochs.findIndex((e) => e.id === epochAt(y)?.id);
    return [epochs[i - 1], epochs[i + 1]] as const;
  }

  function updateNav(y: number) {
    const [p, n] = epochNeighbours(y);
    for (const [btn, ep] of [[prevBtn, p], [nextBtn, n]] as const) {
      btn.disabled = !ep;
      btn.dataset.epoch = ep?.id ?? '';
      btn.querySelector('.txt')!.textContent = ep ? ep.title : '';
      btn.title = ep ? `${ep.title} (${yearLabel(ep.start)} — ${yearLabel(ep.end)})` : '';
    }
  }

  for (const btn of [prevBtn, nextBtn]) {
    btn.addEventListener('click', () => {
      if (btn.dataset.epoch) goToEpoch(btn.dataset.epoch);
    });
  }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopAnim();
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
      const [p, n] = epochNeighbours(y);
      const ep = e.key === ']' ? n : p;
      if (ep) goToEpoch(ep.id);
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

  // Переход к эпохе: сразу открываем её первое событие — дальше история листается по порядку.
  // Карта переключается сразу, бегунок плавно догоняет.
  function goToEpoch(id: string) {
    const ep = epochs.find((e) => e.id === id);
    if (!ep) return;
    const first = eventsOfEpoch(id)[0];
    const year = first ? first.start.year : ep.start;
    animateTo(yearToX(year), 700, false, false);
    setState({ year, eventId: first?.id ?? null });
  }

  function goToEvent(id: string) {
    setState({ eventId: id });
  }

  // Дорожка событий: только события текущей эпохи. Точки, которые на шкале
  // ближе 22 px друг к другу, собираются в одну с числом — без каши из кружков.
  function renderLane() {
    const lane = track.querySelector<HTMLElement>('.tl-lane');
    if (!lane) return;
    const id = getState().eventId;
    const epId = (id ? events.find((e) => e.id === id)?.epoch : epochAt(getState().year)?.id) ?? '';
    const list = eventsOfEpoch(epId);
    const groups: { x: number; evs: typeof list }[] = [];
    for (const ev of list) {
      const x = yearToX(ev.start.year);
      const g = groups[groups.length - 1];
      if (g && x - g.x < 22) g.evs.push(ev);
      else groups.push({ x, evs: [ev] });
    }
    const esc = (t: string) => t.replace(/"/g, '&quot;');
    lane.innerHTML = groups.map((g, i) => {
      const room = (i + 1 < groups.length ? groups[i + 1].x : g.x + 220) - g.x - 24;
      const sel = g.evs.find((e) => e.id === id);
      const shown = sel ?? g.evs[0];
      const n = g.evs.length;
      const title = g.evs.map((e) => `${yearLabel(e.start.year)} · ${e.title}`).join('\n');
      const label = n > 1 ? `${shown.title} и ещё ${n - 1}` : shown.title;
      return `<button type="button" class="tl-event${sel ? ' selected' : ''}${n > 1 ? ' group' : ''}" data-event="${shown.id}" style="left:${g.x}px" title="${esc(title)}">` +
        `<i>${n > 1 ? n : ''}</i>${room > 40 ? `<span style="max-width:${Math.min(room, 220)}px">${label}</span>` : ''}</button>`;
    }).join('');
  }
  function markSelected() {
    renderLane();
  }
  subscribe((s, prev) => {
    if (s.eventId !== prev.eventId || epochAt(s.year) !== epochAt(prev.year)) { updateNav(s.year); markSelected(); }
    if (s.eventId && s.eventId !== prev.eventId) {
      const ev = events.find((e) => e.id === s.eventId);
      if (ev && roundYear(xToYear(posX)) !== ev.start.year) animateTo(yearToX(ev.start.year), 900);
    } else if (s.year !== prev.year && !dragging && !visualOnly && roundYear(xToYear(posX)) !== s.year) {
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
  markSelected();
}
