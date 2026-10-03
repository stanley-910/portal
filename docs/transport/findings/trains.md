# Train source findings — 2026-10-03

Research completed before implementation. Unknown access/terms are not permission. No signup, contract, payment or partner contact was made. A public booking website is not an API contract, and a schedule fetched today is still `timetable`, never a live quote.

| Source | Corridors covered | Live fares? | Live seats? | Can book via API? | Access (key, contract, identity checks) | Terms on scraping | Reliability notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [MTR published timetables](https://www.highspeed.mtr.com.hk/en/common/timetable.inc.html), China Railway 12306 | HK–Shenzhen/Guangzhou/Shanghai/Beijing | Website only; no verified public quote API | Website only | No public authorized contract verified | 12306 consumer account is not a developer credential | Not verified; reject undocumented request-time endpoints | Operator timetable preferred to reseller scrape. Existing `china-rail` seed retained; live booking blocked on partner access. MTR page distinguishes schedule revisions. |
| [Malaysia official GTFS](https://developer.data.gov.my/realtime-api/gtfs-static) | KTMB ETS/intercity, JB–Singapore | No | No | No | No key required; documented rate limit | Published download, no scraping needed | Selected. Feed validity must be preserved; refresh cannot manufacture dates beyond upstream calendar. Existing script already downloads; improve independent refresh and horizon checks. |
| [JR Central timetable](https://global.jr-central.co.jp/en/info/timetable/) | Tokyo/Kyoto/Shin-Osaka/Hakata | No | No | No | Public PDF | Redistribution/scraping terms not established in this pass | Official basic schedule excludes some extra trains. Do not guess a complete service calendar from PDF rows. |
| [NAVITIME route API](https://api-sdk.navitime.co.jp/api/specs/api_guide/route_transit.html) | Japan including Shinkansen | Tariff data, not seat quote | No verified inventory | No booking in route API | Assigned HOST/CID or API marketplace subscription | Use licensed API, not site scrape | Selected future Japan route source, blocked on licensed access and response fixtures. Timetable freshness only. |
| [TAGO/data.go.kr](https://www.data.go.kr/data/15000500/openapi.do), Korail | Korea KTX and conventional lines | Published fares, not reservation quote | No verified seats in TAGO | No in TAGO | Service key; existing brief flags identity verification; not independently completed | No new scraping implemented | Existing official-derived seed retained. Portal inaccessible in research tool; cannot verify access or invent contract. |
| [TDX](https://tdx.transportdata.tw/), [government schema](https://schema.nat.gov.tw/lists/6) | Taiwan THSR | Static ODFare | Not equivalent to bookable inventory | No | Client ID/secret and service access; no signup attempted | Official API preferred | Selected official data source. Current station/timetable snapshot remains timetable; no claim of a reservation API. |
| [SRT](https://www.railway.co.th/), Thailand OTP GTFS | Bangkok–Chiang Mai and SRT lines | SRT website; no verified public quote API | No verified developer contract | Unverified | Operator/partner access required | Not established for new request-time scraping | Existing SRT snapshot and OTP feed retained. Operator website fetch failed in this pass. |
| [Vietnam Railways official timetable](https://giotaugiave.dsvn.vn/) | Hanoi–Saigon both ways | No quoted fare in timetable | No | No public contract verified | Public timetable; booking site separate | robots/terms need review; no request-time scraper | Selected factual timetable source; preserve explicit day +1/+2, omit unknown prices. |
| [12Go agent agreement](https://agent.12go.asia/agreement) | Candidate Thailand/Vietnam/Malaysia; exact rail inventory requires partner verification | API potentially | API potentially | Subject to approval | Prior consent and additional confidential API conditions; affiliate ID alone insufficient | Reject unapproved API/site scraping | Preferred booking partner to evaluate after explicit approved access; do not guess endpoint/schema. |
| [Trip.com affiliate portal](https://www.affiliate.trip.com/) | Candidate China and other rail | Consumer site yes; affiliate API unknown | Unknown | Rail partner scope unverified | Partner approval/contract unknown | No scraping permission established | Reject as immediate implementation: affiliate marker is a link parameter, not inventory access. |
| [Klook affiliate](https://affiliate.klook.com/), [API docs](https://klook.gitbook.io/openapi), [Korail partnership](https://www.klook.com/newsroom/partnership-2026-KORAIL-launch/) | China/Japan/Korea rail candidates | Klook consumer inventory yes | Korea integration advertised | Exact affiliate rail scope unverified | Affiliate approval/API entitlements needed | Licensed tools only; no scrape implemented | Supplier OpenAPI is not proof of reseller rail search access. Reject until rail-specific contract and fixture supplied. |

## Per-corridor decision

1. HK–China: retain MTR-backed timetable fallback; pursue an authorized Trip.com/Klook rail partnership for actual seats. No invented 12306 API.
2. KTMB: official data.gov.my GTFS, independent refresh plus calendar/horizon validation first. No fares or availability claims.
3. Japan: NAVITIME is a documented routing seam, pending credentials/terms. JR PDF is an official fallback candidate, but complete date applicability and reuse terms need verification before bundling.
4. Korea: retain existing Korail-derived snapshot; TAGO offers schedule data, not a booking backend. Access remains a blocker.
5. Taiwan: optional official TDX dated timetable adapter is implemented against the current official contract; existing snapshot remains the no-key fallback. Authenticated service access is still unverified; all schedule results remain Estimated.
6. Thailand: retain SRT seed and OTP official GTFS; approved 12Go access is the path to quotes.
7. Vietnam: official DSVN timetable is the near-term source for an honest timetable-only provider; a booking API remains gated by 12Go/operator approval.

Implementation/verification results are appended below as they become available. Live inventory across all seven corridors is **not complete** merely because fallback schedules exist.

## Implementation and live checks

- **Implemented: KTMB refresh reliability.** Official API called 2026-10-03, HTTP 200. The upstream calendar itself
  remains 2026-08-18 through 2026-10-17, with 18 city pairs and 163 departures. This is not fixed by changing the
  end date. Independent `refresh-ktmb.mts` preserves Thailand feed entries, validates before replacing snapshots,
  rejects a horizon below seven days, removes withdrawn KTMB rows and emits a SHA-256 report. Daily read-only
  workflow produces a review artifact, never an automatic commit/deployment. Licence corrected to CC BY 4.0 from
  [official FAQ](https://developer.data.gov.my/faq); official refresh advice is daily after 04:00 Malaysia.
- **Implemented: Vietnam timetable coverage.** New `vietnam-rail` provider, 10 trains from official endpoint rows,
  cached build-time refresh, recorded HTML fixture. Explicit day offsets are preserved. No fare or seat inventory;
  dated operation unconfirmed and stated in offer attribution. Source robots.txt returned 404; public HTML links
  no reuse terms. This does not establish a redistribution licence. No request-time scraper is installed, and the
  refresh script stops if robots.txt changes for review.
- **Implemented: source honesty for existing four providers.** China rail previously calculated an invented fare
  as `round(durationMin * 1.9)`; removed it. Its source seed has no price. China rail, Korea, THSR and SRT now include
  actual per-train source, checked date and unconfirmed seats in returned offer attribution.
- **Blocked: Japan coverage and all live rail quotes.** No authorized NAVITIME/rail-reseller credentials or API
  contract. TDX client ID/secret and TAGO service key are absent in the root environment (presence checked only).
  No signup, identity submission, contract or payment was attempted. Existing China/Korea/Taiwan/Thailand results
  are preserved without keys. Japan remains without train results and must not be represented as complete.
- **Requires upstream action:** KTMB service after October 17, including November demo dates. Scheduled refresh
  will fail visibly before expiry if the publisher does not extend its calendar; it never invents departures.

Offline validation: GTFS + Vietnam fixture tests initially 27/27 passing. Final combined checks recorded in handoff.

Final validation: 424 transport/trip tests passed across 32 files; subsequent review added abort handling and reused
cited surface hubs, with 29 GTFS/Vietnam tests passing. `pnpm lint` passed (one pre-existing LogoReveal warning).
Offline Vietnam `--check`, KTMB `--check --min-days=7`, and `git diff --check` passed. The one full-suite run found
three registry expectation failures caused by adding a provider; these were fixed and registry/transport/trip
rerun successfully. Root integrator will perform the final combined full suite. TypeScript in the isolated tree
requires Next's generated `LayoutProps`/`PageProps`; the one implementation type error was corrected.

KTMB `refreshedAt` is recorded per feed. Global `builtAt` is the bundle assembly timestamp and does not assert that
Thailand was downloaded again. Vietnam `snapshot-vietnam-trains.mts --check` is offline and checks the bundled
snapshot against recorded endpoint cells; the check date cannot be in the future.

## Optional TDX dated timetable adapter

Focused inspection of TDX's public frontend identified its official
`/webapi/serviceCategory/ForSwagger` group list and `/webapi/File/Swagger/V3/{group}` loader. Rail v2 is group
`268fc230-2e04-471b-a728-a726167c1cfc`; the previously checked group was rail v3. Downloaded the
[current official document](https://tdx.transportdata.tw/webapi/File/Swagger/V3/268fc230-2e04-471b-a728-a726167c1cfc)
(HTTP 200), including dated THSR endpoint, DTOs, OAuth token URL and client-credentials grant. The `V3` in this
document URL is its OpenAPI format; its documented rail API is `/v2/Rail/THSR/...`.

Implemented optional runtime dated timetable in existing `tdx` provider. Both optional existing credentials enable
it. No-key seed behavior remains; errors fall back through the existing isolation pipeline, with Estimated seeds
and reported provider error. Date-mismatched or malformed payloads fail closed. The deadline includes OAuth and
current/previous service-day requests. Cache lasts five minutes and is bounded to twelve dates. It preserves
explicit arrival times and after-midnight origin dates. Fares/seats remain unchecked; offers remain `timetable`.
Official schema excerpt is recorded; timetable fixture is explicitly synthetic, not an invented production seed.

Read-only `scripts/smoke-tdx.mts` provides a secret-free status/count report when credentials become available.
Authenticated access remains unverified; no account creation or API purchase was performed. Initial offline TDX
validation: 30 tests passing, including credentials, auth/rate/schema failures, cancellation, rollover, no-key seed
behavior, empty dates, and provider-level fallback. No live fare or seat inventory is claimed.
