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

## Публикация

Сайт собирается и публикуется GitHub Actions при каждом пуше в `main` (`.github/workflows/deploy.yml`).
Пути в сборке относительные, поэтому один и тот же билд работает и на `https://sharukhanov.github.io/dagestan/`,
и на собственном домене.

### Свой домен

Корень `sharukhanov.com` занят личным сайтом, поэтому история живёт на поддомене **dagestan.sharukhanov.com**:

1. В DNS домена (панель SpaceWeb) добавить запись `CNAME`: имя `dagestan` → значение `sharukhanov.github.io.`
2. Когда запись заработает (`nslookup dagestan.sharukhanov.com` показывает адреса GitHub), положить в корень репозитория
   файл `CNAME` с одной строкой `dagestan.sharukhanov.com` и запушить в `main` — workflow сам добавит его в публикацию.
3. В Settings → Pages включить **Enforce HTTPS** (галочка появится через несколько минут после шага 2).
