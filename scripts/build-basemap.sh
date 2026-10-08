#!/usr/bin/env bash
# Пересобирает слои подложки (public/basemap/*.geojson) из Natural Earth 1:10m.
# Natural Earth — общественное достояние. Запускать нужно редко: результат лежит в репозитории.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/basemap"
TMP="$(mktemp -d)"
M="$ROOT/node_modules/.bin/mapshaper"
BBOX="33,35,58,50"
mkdir -p "$OUT"
cd "$TMP"
for f in physical/ne_10m_ocean physical/ne_10m_lakes physical/ne_10m_rivers_lake_centerlines physical/ne_10m_coastline cultural/ne_10m_admin_1_states_provinces; do
  curl -sSLO "https://naciscdn.org/naturalearth/10m/$f.zip"
  unzip -oq "$(basename "$f").zip"
done
"$M" ne_10m_ocean.shp -clip bbox=$BBOX -simplify 40% keep-shapes -drop fields='*' -o "$OUT/ocean.geojson" format=geojson geojson-type=FeatureCollection rfc7946 precision=0.001
# Упрощённый контур моря без мелких островов — для «штриховки воды» на старой карте.
"$M" ne_10m_ocean.shp -clip bbox=$BBOX -simplify 6% keep-shapes -filter-slivers min-area=3000km2 -drop fields='*' -o "$OUT/ocean-lining.geojson" format=geojson geojson-type=FeatureCollection rfc7946 precision=0.01
"$M" ne_10m_coastline.shp -clip bbox=$BBOX -simplify 40% -drop fields='*' -o "$OUT/coastline.geojson" format=geojson geojson-type=FeatureCollection rfc7946 precision=0.001
# rfc7946: внешние кольца против часовой стрелки — так «штриховка воды» на старой карте ложится в воду.
# featurecla нужен, чтобы на «старой карте» скрыть современные водохранилища
"$M" ne_10m_lakes.shp -clip bbox=$BBOX -simplify 40% keep-shapes -filter-fields name,featurecla -o "$OUT/lakes.geojson" format=geojson geojson-type=FeatureCollection rfc7946 precision=0.001
"$M" ne_10m_rivers_lake_centerlines.shp -clip bbox=$BBOX -filter-fields name,scalerank,featurecla -o "$OUT/rivers.geojson" format=geojson geojson-type=FeatureCollection rfc7946 precision=0.001
# Контур современного Дагестана — тонкая пунктирная линия-ориентир поверх исторических зон.
"$M" ne_10m_admin_1_states_provinces.shp -filter 'iso_3166_2 == "RU-DA"' -filter-fields name -simplify 30% keep-shapes -o "$OUT/dagestan.geojson" format=geojson geojson-type=FeatureCollection rfc7946 precision=0.001
rm -rf "$TMP"
echo "Готово: $OUT"
