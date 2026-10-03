# Current rail source capture

The following records the acquisition phase. The subsequent [offline cache conversion](rail-cache.md) now
serves normalized schedules through transport search; see its report for extraction limits.

Captured on **2026-10-03–04 (Hong Kong time)** from operator sources and explicitly labelled reseller pages. This is the source-collection phase requested before
provider integration or simulated booking. No runtime seeds, reservations, accounts or payments were changed.

## What is on disk

`data/rail-capture/report.json` records each URL, final URL, HTTP status, UTC retrieval timestamp, SHA-256,
local evidence path, download label and capture outcome. Original documents live in `data/rail-capture/runs/`:
the files are durable local evidence, ignored by Git, and are not included in the deployed application.

The operator document capture contains **34 PDFs, 4 XLSX workbooks and 2 legacy XLS workbooks**, plus the KTMB
GTFS ZIP, HTML tables, indexes and robots responses. Dated China/Japan evidence is described below. These are
document counts, not routes or bookable services. Targeted refreshes retain original retrieval timestamps.

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

## Additional published sources

| Source | Evidence collected | Limits |
| --- | --- | --- |
| [KTMB passenger timetables](https://www.ktmb.com.my/TrainTime.html) | Thirteen PDFs covering ETS, Intercity, Shuttle Timur, JB–Woodlands and commuter services | Includes older overlapping revisions and date-specific October exceptions. Index links are evidence, not a declaration that every PDF applies today. GTFS still ends October 17; these PDFs do not extend that feed's service calendar. |
| [MTR fares](https://www.highspeed.mtr.com.hk/en/ticket/fare.html) | Seven published fare PDFs, including sleeper fares and before/from-April branches | Published tariff is not a dated implemented HKD quote. Requires OCR and effective-date/class interpretation. |
| [Korail fares](https://www.korail.com/com/userBoard.do?mode=list&schBcid=ticketTable) | KTX XLS and conventional XLSX, labelled September 1, 2026 | Legacy XLS preserved without conversion; XLSX cell evidence extracted. |
| [SR fares](https://etk.srail.kr/cms/archive.do?pageId=TK0402050000) | Linked fare XLS | Legacy workbook preserved; applicability and service identity need review. |
| [SmartEX fares](https://smart-ex.jp/en/product/plan/service/) | Ordinary reserved, Green Car and ordinary non-reserved fare PDFs | Published tariff with class/season conditions; no live availability. |
| [THSR fares](https://en.thsrc.com.tw/ArticleContent/4c3efc1d-e6df-4bfd-97b4-52e89f79ee5c) | Full published fare-grid HTML | Standard/business/unreserved and adult/concession axes need interpretation. |

### Mainland China dated evidence

The [12306 public mobile train form](https://mobile.12306.cn/weixin/wxcore/initCC?type=xxqg) exposes a public
train-number search followed by a stop-time query. A successful `keyword=G`, `date=20261004`, `type=wx_checi`
response returned **200 catalogue rows**, apparently capped. The collector imported that response and fetched
**24 trains**, one per directed endpoint pair in source order, for **October 4, 2026**. This selection is heavily
Beijing-oriented, not a nationwide inventory. Each original response retains station telecodes, ordered stops,
arrival/departure times, origin date and day offsets. No price or available-seat claim is made.

The search response's exact retrieval timestamp was not recorded; its manifest says so. Subsequent search-host
robots discovery returned a connection reset then HTTP 502, so the repeatable collector accepts a previously
obtained catalogue instead of repeatedly requesting that host. Mobile-host robots returned 404 and is retained.
The desktop station-query page returned HTTP 404 on its data request. Public mobile queries worked without login
or CAPTCHA. Do not reuse October 4 train identifiers or timetables for another travel date.

### Japan dated reseller samples

[Trip.com Japan public route pages](https://www.trip.com/trains/japan/route/tokyo-to-niigata/) supplied ten
pages: Tokyo ↔ Niigata, Sendai (Miyagi), Shin-Hakodate-Hokuto, Kanazawa and Nagano. Exact endpoint filtering
retained **351 dated rows** for **October 4–5, 2026**. Some pages return 50 rows and mix nearby destinations;
this is not a complete day's inventory. Original HTML and filtered evidence JSON are both hashed.

These are reseller listings, not official JR timetable exports. Numeric reseller train identifiers are not
public train numbers, city coordinates are not verified station coordinates, and zero fare placeholders are
unknown prices, not free tickets. Rows are retained as evidence without creating offers. The separate US-domain
China route probe returned an access block; no bypass was attempted. Japan pages succeeded through ordinary
public requests. JR East's official timetable copying restriction remains unresolved.

## Refresh and verify

```sh
python3 scripts/capture-rail.py
python3 scripts/capture-rail.py --only korail,thsr
python3 scripts/capture-rail.py --check
python3 scripts/capture-rail-samples.py --source japan-route-samples
# China requires a previously obtained, dated public keyword=G catalogue:
python3 scripts/capture-rail-samples.py --source china-12306-sample --catalog /path/to/search.json
python3 -m unittest discover -s scripts -p 'test_capture_rail*.py'
```

Uses Python's standard library, system `curl`, and Poppler `pdftotext`. Downloads are discovered from current
official index pages rather than search-result attachment URLs. HTML comments are excluded so historical MTR
downloads do not reappear. SR's newest dated link and Korail's newest KTX/conventional board entries are selected
at refresh time. A source-layout change fails visibly instead of writing an empty dataset.

Every invocation creates a separate evidence directory. Requests have connection/transfer limits and a one-second
pause; at most three sources run concurrently. No login, CAPTCHA bypass, booking search, or request-time scraping.
PDF/XLSX/XLS signatures are checked, XLSX archive integrity is checked, and GTFS required tables are checked.
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
- Mainland China now has a bounded dated G-train sample. D/C/conventional trains and nationwide coverage remain uncollected.
- No live seats, availability or fare quotes were captured. Normalization, station mapping, per-service calendars,
  PDF OCR verification, fare interpretation, app integration and the wider bus/ferry/flight brief remain separate work.

## Validation

Nine offline collector tests pass, covering source selection, tamper detection, date mismatch, overnight offsets,
Japan endpoint filtering and rejected challenge pages. **165 original/derived file hashes verified** across 17 source groups. Initial-batch project tests:
**806 passed, one skipped**. Initial-batch lint had no errors;
two existing warnings remain in `logo-reveal.js` and `globe-screen.tsx`. Raw third-party files are excluded from
application linting. Rendered first pages of the MTR short-haul and JR Central westbound PDFs were visually checked.
