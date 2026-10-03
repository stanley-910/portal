# Current rail source capture

Captured directly from official sources on **2026-10-03**. This is the source-collection phase requested before
provider integration or simulated booking. No runtime seeds, reservations, accounts or payments were changed.

## What is on disk

`data/rail-capture/report.json` records each URL, final URL, HTTP status, UTC retrieval timestamp, SHA-256,
local evidence path, download label and capture outcome. Original documents live in `data/rail-capture/runs/`:
the files are durable local evidence, ignored by Git, and are not included in the deployed application.

The combined capture contains **39 source responses**, including **11 PDFs and 3 XLSX workbooks**, the KTMB
GTFS ZIP, official HTML timetables, source indexes and robots responses. These are document counts, not a claim
of that many routes or bookable services. Targeted refreshes retain other sources with their original timestamps.

| Source | Captured coverage | Published date limits and remaining interpretation |
| --- | --- | --- |
| [MTR](https://www.highspeed.mtr.com.hk/en/common/timetable.inc.html) | Five PDFs: both revisions of short/long-haul timetables, plus sleeper timetable | Index distinguishes departures before **Oct 11** from those **on/after Oct 11**. Covers HK services, not nationwide mainland rail. PDF lettering is not extractable text; preserve original grids and footnotes for OCR/validation. |
| [THSR](https://en.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c) | Full published main-line PDFs, both directions: base and two holiday schedules | Base effective **Feb 2, 2026**; National Day **Oct 8–12**; Retrocession Day **Oct 23–27**. Holiday operating-day exceptions must override the base schedule. Twelve-station grids and footnotes retained. |
| [JR Central](https://global.jr-central.co.jp/en/info/timetable/) | Eastbound and westbound Tokaido/Sanyo/Kyushu Shinkansen PDFs, eight pages each | Basic schedule effective **Mar 14, 2026**. Operator explicitly excludes some extra trains. Outlined lettering needs OCR; visual check confirms station rows, train columns and running-day notes. |
| [JR Kyushu](https://www.jrkyushu.co.jp/english/train/700series.html) | Fourteen-page major-trains PDF, including Kyushu and Nishi Kyushu Shinkansen | Published range **Mar 14, 2026–Feb 28, 2027**. Extracted text has damaged font encoding; original PDF is retained for visual/encoding review. Major trains only. |
| [Korail](https://www.korail.com/com/userBoard.do?mode=list&schBcid=ticketTable) | Current KTX and conventional-train XLSX downloads | Both labelled effective **Oct 1, 2026**. KTX: nine tabs / 15,046 nonempty cells. Conventional: sixteen tabs / 19,598 cells. Includes major branches beyond the existing seed. JSON extraction retains cell addresses, types, styles, formulas and merged ranges; it is not yet normalized services. |
| [SR](https://etk.srail.kr/cms/archive.do?pageId=TK0402050000) | Latest linked timetable workbook | Page labels it **Sep 1, 2026**. Nine tabs / 15,046 cells. Do not assume these are additional independent SRT services: the workbook resembles Korail's structure; train identity/operator must be reconciled before integration. Files have different SHA-256 hashes. |
| [KTMB / data.gov.my](https://api.data.gov.my/gtfs-static/ktmb) | Full published GTFS archive: 156 stops, 9 routes, 374 trips, 5,155 stop-time rows | `calendar.txt` spans **Aug 18–Oct 17, 2026**; six calendar rows and six exception rows retained. Trip counts include feed route types and are not all intercity rail. Fresh download still does not cover November. |
| [Vietnam Railways](https://giotaugiave.dsvn.vn/) | Complete operator timetable HTML, including intermediate station rows | Original grids and explicit next-day offsets retained. Page does not establish a complete dated service calendar. |
| [State Railway of Thailand](https://ttsview.railway.co.th/SRT_Schedule2022.php?ln=en&line=1&trip=1) | Northern, northeastern and southern tables, both directions, plus public train-type/running-day JavaScript | Published classic-view tables; effective dates and known source inconsistencies need validation before rebuilding seeds. No access to the protected modern booking API was attempted. |

## Refresh and verify

```sh
python3 scripts/capture-rail.py
python3 scripts/capture-rail.py --only korail,thsr
python3 scripts/capture-rail.py --check
python3 -m unittest discover -s scripts -p 'test_capture_rail.py'
```

Uses Python's standard library, system `curl`, and Poppler `pdftotext`. Downloads are discovered from current
official index pages rather than search-result attachment URLs. HTML comments are excluded so historical MTR
downloads do not reappear. SR's newest dated link and Korail's newest KTX/conventional board entries are selected
at refresh time. A source-layout change fails visibly instead of writing an empty dataset.

Every invocation creates a separate evidence directory. Requests have connection/transfer limits and a one-second
pause; at most three sources run concurrently. No login, CAPTCHA bypass, booking search, or request-time scraping.
PDF/XLSX signatures are checked, XLSX archive integrity is checked, and GTFS required tables are checked.
`--check` verifies original and derived-file hashes offline. Capture failure exits nonzero and retains prior runs;
the latest report includes failures rather than silently labelling old data fresh. `captured` means fetched source
evidence, not parsed/verified train offers.

## Source restrictions and gaps

- Robots responses are retained. Korail permits crawling in its published directives; several other hosts return
  404 or HTML error pages for robots.txt. That absence is recorded, not treated as a redistribution licence.
- THSR's [terms](https://en.thsrc.com.tw/ArticleContent/aa965600-e5a5-409b-9fcc-115afe68f2e7)
  reserve compilation and trademark rights. Other operator redistribution terms remain unresolved. These captures
  are local review evidence; no open-data licence is claimed for their PDFs or spreadsheets. KTMB's existing feed
  documentation identifies CC BY 4.0.
- JR East's timetable page explicitly restricts copying/reprocessing its timetable data. Its Tohoku/Hokkaido,
  Hokuriku and Joetsu listings were not bulk-captured. JR Central/Kyushu downloads do not fill those gaps.
- Mainland China beyond MTR's HK-linked services remains uncollected. Do not describe this as all China rail.
- No live seats, availability or fare quotes were captured. Normalization, station mapping, per-service calendars,
  PDF OCR verification, fare collection, app integration and the wider bus/ferry/flight brief remain separate work.

## Validation

Four offline collector tests pass (historical-link exclusion, newest SR revision, Korail category selection and
tamper detection). Captured-file hashes verified. Project tests: **806 passed, one skipped**. Lint has no errors;
two existing warnings remain in `logo-reveal.js` and `globe-screen.tsx`. Raw third-party files are excluded from
application linting. Rendered first pages of the MTR short-haul and JR Central westbound PDFs were visually checked.
