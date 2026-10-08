import './styles/main.css';
import { initMap } from './map/map';
import { initTimeline } from './timeline/timeline';
import { initCard } from './card/card';
import { initSourcesPanel } from './sources/panel';
import { epochAt, events } from './data';
import { followHash, getState, readHash, setEventYearResolver, setState, subscribe } from './state';

setEventYearResolver((id) => events.find((e) => e.id === id)?.start.year);
const first = events.slice().sort((a, b) => a.start.year - b.start.year)[0];
readHash({ year: first?.start.year ?? 550, eventId: null, theme: 'old' });
document.documentElement.dataset.theme = getState().theme;

initMap(document.getElementById('map')!);
initTimeline(document.getElementById('timeline')!);
initCard(document.getElementById('card')!);
initSourcesPanel(document.getElementById('src-btn')!);
followHash();

// Название текущей эпохи в шапке.
const epochNow = document.getElementById('epoch-now')!;
const showEpoch = () => {
  const ep = epochAt(getState().year);
  epochNow.textContent = ep?.title ?? '';
  epochNow.title = ep?.summary ?? '';
  epochNow.style.setProperty('--c', ep?.color ?? 'transparent');
};
showEpoch();
subscribe((s, prev) => { if (s.year !== prev.year) showEpoch(); });

// Переключатель подложки.
const switcher = document.querySelector<HTMLElement>('.basemap-switch')!;
const markTheme = () => {
  for (const b of switcher.querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-checked', String(b.dataset.theme === getState().theme));
  }
};
markTheme();
switcher.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-theme]');
  if (b) setState({ theme: b.dataset.theme as 'old' | 'modern' });
});
subscribe((s, prev) => { if (s.theme !== prev.theme) markTheme(); });
