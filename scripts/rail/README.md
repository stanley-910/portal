# Offline rail cache builder

The input is `data/rail-capture/report.json` and its already-downloaded, hashed files. This builder never fetches a timetable or geocodes a station.

```sh
uv venv .cache/rail-python
uv pip install --python .cache/rail-python/bin/python -r scripts/rail/requirements.txt
.cache/rail-python/bin/python scripts/rail/build.py
.cache/rail-python/bin/python -m unittest discover -s scripts/rail -p 'test_*.py'
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/rail-query.mts 'Hong Kong West Kowloon' 'Shanghai Hongqiao' 2026-10-04
```

System Tesseract with English data is required for outlined PDFs. PDFium renders them locally. Table rules are removed before OCR; text coordinates are retained in `.cache/rail-layout/`. Extraction is serial because PDFium is not thread safe. Repeat builds reuse layouts by original file hash and extraction version. `reviewed.json` contains hash-pinned, visually checked transcriptions for the sleeper and Shuttle Selatan grids.

Outputs:

- `src/lib/transport/providers/rail-cache/cache.json`: normalized station, source, calendar and stop-time records consumed by the server provider.
- `data/rail-cache/report.json`: counts and document accounting.
- `data/rail-cache/review.json`: rejected/ambiguous rows and unsupported page layouts. These do not become offers.
- `data/rail-cache/fares.json`: extracted published fare tables, kept separate from schedules and unquoted until class/conditions are reconciled.

Stop times are integer seconds since the train's origin-date midnight, including seconds present in XLSX cells and values over 24 hours. Dated observations are never extrapolated. Published recurring calendars retain start/end bounds, weekdays and explicit overrides. `typical` records have unresolved operating-day details and search labels them accordingly. Holiday PDFs override THSR's base calendar. Matching older SR-hosted services stop at the newer October Korail edition. April ETS tables end before the June revision.

Korean zero-valued cells represent skipped stations, not midnight calls. Numeric reseller IDs are not exposed as public train numbers; zero prices are not fares. Source arrival/departure-only events stay one-sided where supplied. Some PDF grids supply only a single call time: those are timetable points, not independently verified dwell times. OCR records retain their page/column locator and are estimates requiring operator confirmation.

Coordinate enrichment uses existing repository hubs/station seeds and downloaded GTFS first, then `station-coords.json` from PR #21. Each resolved entry retains its Wikidata source, matched label and method. `python3 scripts/rail/stations.py` applies the local table without rebuilding schedules and preserves already saved coordinates. `coords.py` can refresh the table from Wikidata (network access), using country/name matching, neighbouring stops and a speed sanity check. The 26 remaining gaps are listed in `data/rail-cache/geocoding.json`. Name-based CLI queries work for every normalized station; globe search uses only stations with known coordinates. Country-qualified cache IDs can disambiguate names. No coordinates are inferred from an unrelated city centre.

Rebuilds overwrite generated outputs, never original evidence or existing provider seeds. Input SHA-256 mismatches stop the build. Outputs contain no seats, reservations or live quotes. This conversion does not establish a redistribution licence for source data.
