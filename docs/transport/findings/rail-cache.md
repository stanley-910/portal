# Cached rail schedules

The downloaded October 3–4 source corpus is now converted into a server-side, offline schedule cache.
The `rail-cache` provider is registered with transport search and saved-trip validation. It makes no network calls.

The current build contains **4,476 timetable records**, **38,330 stop events**, and
**950 normalized station entries**. Counts include historical revisions, date-specific variants
and overlapping operators; they are not unique trains or a coverage percentage. 232 station entries have
coordinates from the existing station catalogues or downloaded GTFS and can participate in globe searches.
Every normalized station can be queried by name or cache ID using the offline CLI.

| Source | Cached timetable records |
| --- | ---: |
| mtr | 299 |
| thsr | 668 |
| jr-central | 276 |
| korail | 1,073 |
| sr | 621 |
| ktmb | 134 |
| vietnam | 10 |
| thailand | 139 |
| jr-kyushu | 419 |
| ktmb-published | 462 |
| china-12306-sample | 24 |
| japan-route-samples | 351 |

The machine-readable [build report](../../../data/rail-cache/report.json) accounts for every timetable/fare
artifact. [Cache builder instructions](../../../scripts/rail/README.md) document rebuilding from local inputs.
The generated schedule data is [cache.json](../../../src/lib/transport/providers/rail-cache/cache.json).

## What the cache preserves

- Source URL, original SHA-256, capture timestamp and page/row/cell locator where available.
- Station calls and day offsets, including overnight boarding after the train's origin date.
- Original China/Japan sample dates remain in the cache. For demo searches, the 24 China 12306 samples are reused on later dates without an expiry and explicitly labelled estimated, with the original date and an unverified operating-date notice. Japan samples remain date-limited.
- THSR weekday dots and holiday-specific service dates; holiday schedules replace the base.
- MTR October 11 revisions and the sleeper's published weekly pattern. Prohibited short-haul sleeper segments are excluded.
- Korea's spreadsheet times, including seconds. Empty zero-value cells do not become midnight station calls.
- KTMB GTFS calendar bounds/exceptions, published-table editions and Singapore-border shuttle times.
- Thai weekday rules and cancelled services; contradictory restart dates are withheld.

Single-time PDF cells are retained as timetable call points, not independently verified arrival/departure dwell
times. Where an operating calendar is unresolved, results explicitly say **typical timetable; confirm operating
day**. Results are `kind: timetable`, except reused China demo samples (`kind: estimated`); all retain the app's non-live/estimated presentation and have no invented
fare or seat availability. Published fare-only documents were extracted separately into
[fares.json](../../../data/rail-cache/fares.json); they cannot produce departures on their own.

## Extraction limits

All downloaded timetable PDFs were processed and produced cache records, including OCR and visually checked
transcriptions for image-only grids. This is **not a claim that every cell in every PDF was recovered**.
[review.json](../../../data/rail-cache/review.json) contains 127 flagged entries for ambiguous OCR,
non-monotonic times, conflicting/cancelled service rules and unsupported page layouts. They are not offered.
Some sparse/merged PDF grids yield only a subset of station calls. Named tourist trains retain no invented train
number and require confirmation of their operating dates. Source data redistribution rights are unchanged.

## Offline verification

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/rail-query.mts 'Hong Kong West Kowloon' 'Shanghai Hongqiao' 2026-10-04
pnpm exec vitest run src/lib/transport/providers/rail-cache/search.test.ts
.cache/rail-python/bin/python -m unittest discover -s scripts/rail -p 'test_*.py'
```

The regression checks cover the overnight sleeper and its excluded short-haul segment, boarding-date versus
origin-date handling, 12306 future demo reuse and attribution, THSR holiday overrides, absent reseller fares/numbers, cancelled Thai
services, invalid-date rejection and all generated station/time references.
