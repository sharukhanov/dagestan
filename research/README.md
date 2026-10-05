# research/

Рабочая папка для источников. В репозиторий попадают только этот файл и [sources-found.md](sources-found.md);
скачанные PDF (`pdf/`), извлечённый текст (`txt/`) и html-страницы игнорируются (`.gitignore`).

Скачать издание с сайта ИИАЭ ДФИЦ РАН и извлечь текст:

```bash
cd research
./fetch.sh istoriya-dagestana-tii istoriya-1968-t2   # slug страницы на instituteofhistory.ru и локальное имя
```

Нужны `curl` и `pdftotext` (poppler-utils). Для сканов без текстового слоя — `ocrmypdf -l rus`.
