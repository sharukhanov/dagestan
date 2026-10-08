// Общее состояние приложения: текущий год, открытое событие, подложка.
// Синхронизируется с адресной строкой (#y=1741&e=andalal-1741&map=old),
// чтобы ссылкой на момент истории можно было поделиться.

export type Theme = 'old' | 'modern';

export interface AppState {
  year: number;
  eventId: string | null;
  theme: Theme;
}

type Listener = (s: AppState, prev: AppState) => void;

const listeners = new Set<Listener>();
let state: AppState = { year: 550, eventId: null, theme: 'old' };

export function getState(): AppState {
  return state;
}

let eventYear: (id: string) => number | undefined = () => undefined;
/** Как узнать год события: при выборе события год меняется сразу, в том же обновлении. */
export function setEventYearResolver(fn: (id: string) => number | undefined) {
  eventYear = fn;
}

export function setState(patch: Partial<AppState>) {
  const prev = state;
  const next = { ...state, ...patch };
  // Новое событие без явного года — сразу переносимся в его год, чтобы карта
  // не показывала долю секунды старое время, пока шкала едет к событию.
  if (patch.eventId && patch.eventId !== prev.eventId && patch.year === undefined) {
    next.year = eventYear(patch.eventId) ?? next.year;
  }
  if (next.year === prev.year && next.eventId === prev.eventId && next.theme === prev.theme) return;
  state = next;
  for (const l of listeners) l(state, prev);
  scheduleHashWrite();
}

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function parseHash(hash: string, fallback: AppState): AppState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const y = Number(p.get('y'));
  const m = p.get('map');
  return {
    year: p.has('y') && Number.isFinite(y) && y !== 0 ? Math.round(y) : fallback.year,
    eventId: p.get('e') || null,
    theme: m === 'old' || m === 'modern' ? m : fallback.theme,
  };
}

/** Ссылку вставили в адресную строку уже открытой страницы или нажали «назад» — применяем её. */
export function followHash() {
  window.addEventListener('hashchange', (e) => {
    // Адрес берём из самого события: отложенная запись могла уже перезаписать location.hash.
    clearTimeout(hashTimer);
    const hash = new URL(e.newURL).hash;
    const patch: Partial<AppState> = parseHash(hash, state);
    // В ссылке только событие — год возьмём из события.
    if (!new URLSearchParams(hash.replace(/^#/, '')).has('y')) delete patch.year;
    setState(patch);
  });
}

export function readHash(defaults: AppState): AppState {
  const p = new URLSearchParams(location.hash.slice(1));
  const y = Number(p.get('y'));
  let theme: Theme = defaults.theme;
  try {
    const saved = localStorage.getItem('basemap');
    if (saved === 'old' || saved === 'modern') theme = saved;
  } catch { /* приватный режим — не страшно */ }
  const m = p.get('map');
  if (m === 'old' || m === 'modern') theme = m;
  state = {
    year: Number.isFinite(y) && y !== 0 && p.has('y') ? Math.round(y) : defaults.year,
    eventId: p.get('e') || defaults.eventId,
    theme,
  };
  if (state.eventId && !p.has('y')) state.year = eventYear(state.eventId) ?? state.year;
  return state;
}

let hashTimer: number | undefined;
function scheduleHashWrite() {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const p = new URLSearchParams();
    p.set('y', String(state.year));
    if (state.eventId) p.set('e', state.eventId);
    p.set('map', state.theme);
    history.replaceState(null, '', '#' + p.toString());
    try { localStorage.setItem('basemap', state.theme); } catch { /* ignore */ }
  }, 250);
}
