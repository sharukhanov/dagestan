# История Дагестана

Интерактивная карта с временной шкалой: эпохи, зоны влияния государств, события и источники.
Статичный сайт (Vite + TypeScript + MapLibre GL) для GitHub Pages.

## Запуск локально

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # проверка данных + сборка в dist/
npm run preview    # посмотреть собранную версию
```

## Как добавить событие

Весь контент лежит в папке [`data/`](data/README.md): там описаны схема данных и пример события.
После правки запустите `npm run validate`.

## Подложки

- **Старая карта** — пергамент, рельеф в сепии, «штриховка» у берегов; современные водохранилища скрыты.
- **Современная** — тёмный рельеф.

В обеих нет современных границ и подписей. Рельеф строится из открытых [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), вода — из [Natural Earth](https://www.naturalearthdata.com/) (`npm run build-basemap` пересобирает `public/basemap/`).
