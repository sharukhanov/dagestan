#!/usr/bin/env bash
# fetch.sh <slug> <local-name> — скачать PDF со страницы издания на instituteofhistory.ru и извлечь текст
set -u
slug=$1; name=$2
page=$(curl -sL "https://instituteofhistory.ru/library/publications/$slug" -w "\n%{http_code}")
code=$(echo "$page" | tail -1)
if [ "$code" != 200 ]; then echo "$slug: страница $code"; exit 1; fi
title=$(echo "$page" | grep -oE '<title>[^<]+' | sed 's/<title>//')
pdf=$(echo "$page" | grep -oE 'href="/media/library/publication/files/[^"]+\.pdf"' | head -1 | sed 's/href="//;s/"$//')
echo "$slug | $title | ${pdf:+есть PDF}"
[ -z "$pdf" ] && exit 1
[ -f "pdf/$name.pdf" ] || curl -sL "https://instituteofhistory.ru$pdf" -o "pdf/$name.pdf"
echo "https://instituteofhistory.ru$pdf" > "pdf/$name.url"
pdfinfo "pdf/$name.pdf" | grep -E "^Pages"
pdftotext -layout "pdf/$name.pdf" "txt/$name.txt"
echo "символов текста: $(wc -m < txt/$name.txt)"
