# GTFS open data — API ground truth
Checked: 2026-10-02 · Modes: buses + trains (+ ferries) · Seat: Ahmet

GTFS = file format, not one API. Feeds themselves mostly free/open; **catalog APIs need free account keys**; **Transitland free tier = non-commercial, 10k REST queries/month**. Taiwan TDX + Korea data.go.kr bus documented elsewhere — only cross-referenced here.

## Verdict
- Free: yes for feeds we need (data.gov.my no key; Thai OTP no key; LTA needs free AccountKey). Catalogs: Mobility Database CSV no key; MDB API + Transitland need signup.
- **Biggest blocker: intercity bus coverage is thin.** Malaysia GTFS = city/stage buses (Rapid, myBAS) + KTMB rail; **no MY/SG express coach operators** in any feed found. Singapore LTA GTFS = **train only** (MRT/LRT). Korea: 0 feeds in MDB. Japan: 600+ local feeds, very few highway-bus feeds.
- Best intercity hits: **Thailand OTP "namtang" national feed** (intercity buses incl. The Transport Co. บขส., Nakhonchai Air; SRT rail; ferries; CC BY 4.0 per MDB) and **KTMB** (ETS + Intercity rail, MY↔SG Woodlands shuttle).
- Hackathon-viable: yes, if pre-processed at build time into compact JSON per city pair. Runtime zip parsing on Vercel = bad idea (Thai zip 42 MB / 230 MB unzipped).
- Fallback for gaps (MY/SG coaches, KR, TW): deep links (BusOnlineTicket, 12Go docs) + Korea/Taiwan docs from other seats.

## Access
| Source | Signup | Gets | Approval | Licence |
|---|---|---|---|---|
| data.gov.my GTFS Static | none | zip per agency | — | "© 2026 Public Sector Open Data"; ToS link on site, exact licence `unverified` |
| Thai OTP namtang | none | national zip | — | CC BY 4.0 (MDB catalog `urls.license`); primary page `unverified` |
| LTA DataMall | https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html | `AccountKey` | timing `unverified` | must accept Singapore Open Data Licence + Terms of Service for API and SDK |
| Mobility Database | https://mobilitydatabase.org (account) | refresh token → access token | instant (self-serve) | FAQ: free, commercial use permitted; per-feed licence varies |
| MDB catalog CSV | none | `feeds_v2.csv` | — | per-feed `urls.license` column |
| Transitland | https://www.transit.land (sign up, Explorer plan) | `apikey` | self-serve | Explorer excludes commercial use of datasets; per-feed licence flags |
| gtfs-data.jp (Japan) | none for list (observed) | `api.gtfs-data.jp/v2/...` | — | mostly CC BY 4.0 / CC0 (per feed `feed_license`) |

Attribution: CC BY feeds → show "Data: <publisher>, CC BY 4.0" in UI footer/about.

Env vars:
| Var | Use |
|---|---|
| `LTA_DATAMALL_ACCOUNT_KEY` | header `AccountKey` |
| `MOBILITYDB_REFRESH_TOKEN` | build-time discovery only (POST `/v1/tokens`) |
| `TRANSITLAND_API_KEY` | optional, only if live departures needed |
| `DATA_GOV_MY_API_TOKEN` | optional; not required for GTFS (header name `unverified`) |

## Auth + base URL
| Service | Base | Auth |
|---|---|---|
| data.gov.my | `https://api.data.gov.my/gtfs-static/<agency>` | none |
| Thai OTP | `https://namtang-api.otp.go.th/download/namtang-gtfs.zip` | none (observed) |
| LTA DataMall | `https://datamall2.mytransport.sg/ltaodataservice/` | header `AccountKey: $LTA_DATAMALL_ACCOUNT_KEY` |
| Mobility DB API | `https://api.mobilitydatabase.org/` | `Authorization: Bearer <access_token>`; token from POST `/v1/tokens` `{"refresh_token": ...}`; tokens expire (lifetime `unverified`) |
| MDB CSV | `https://files.mobilitydatabase.org/feeds_v2.csv` | none (observed 200, 2.6 MB, 6479 rows) |
| Transitland v2 | `https://transit.land/api/v2/rest` | `apikey` query param or `apikey` header; no key → 401 `{"error":"Unauthorized"}` (observed) |
| gtfs-data.jp | `https://api.gtfs-data.jp/v2/` | none (observed `/v2/feeds` 200) |

## Endpoints we use
### GTFS Schedule files + fields (spec rev 2026-04-27)
| File | Presence | Required fields | Cond. required | We use |
|---|---|---|---|---|
| `agency.txt` | Required | `agency_name`,`agency_url`,`agency_timezone` | `agency_id` (if >1 agency) | operator name, tz |
| `stops.txt` | Cond. (req unless flex-only) | `stop_id` | `stop_name`,`stop_lat`,`stop_lon`,`parent_station` | city match by name/geo |
| `routes.txt` | Required | `route_id`,`route_type` | `route_short_name`/`route_long_name`, `agency_id` | mode filter |
| `trips.txt` | Required | `route_id`,`service_id`,`trip_id` | `shape_id` | link trip→service |
| `stop_times.txt` | Required | `trip_id`,`stop_sequence` | `arrival_time`,`departure_time`,`stop_id` | A→B legs |
| `calendar.txt` | Cond. (req unless all dates in calendar_dates) | `service_id`,`monday`..`sunday`,`start_date`,`end_date` | — | weekly pattern |
| `calendar_dates.txt` | Cond. (req if no calendar.txt) | `service_id`,`date`,`exception_type` (1 add, 2 remove) | — | holiday exceptions |
| `frequencies.txt` | Optional | `trip_id`,`start_time`,`end_time`,`headway_secs` (positive int) | — | Thai feed needs it |
| `feed_info.txt` | Cond. | — | — | `feed_start_date/end_date`, version |

`route_type`: 0 Tram/light rail, 1 Subway, 2 Rail (intercity), 3 Bus, 4 Ferry, 5 Cable tram, 6 Aerial lift, 7 Funicular, 11 Trolleybus, 12 Monorail. Times `HH:MM:SS` in `agency_timezone`, may exceed `24:00:00` for after-midnight on same service day (observed KTMB `25:56:00`). Dates `YYYYMMDD`.

### GTFS Realtime (basics)
Protocol Buffers. `FeedMessage` → `header` (`gtfs_realtime_version` "2.0", `incrementality` FULL_DATASET, `timestamp` POSIX) + `entity[]` each one of `trip_update`, `vehicle` (VehiclePosition), `alert`. Intercity relevance low; LTA has train `GTFSRealTimeTrainServiceAlerts` + train trip updates (disruption). Skip for MVP.

### Feed URLs (exact)
| Country | Feed | URL | Mode | Observed |
|---|---|---|---|---|
| MY | KTMB | `https://api.data.gov.my/gtfs-static/ktmb` | rail: ETS Padang Besar–JB Sentral, Intercity (ERT Tumpat–JB Sentral, SH), Komuter, `ST` JB Sentral–Woodlands | 46 KB zip, 375 trips, calendar to 20261015 |
| MY | Prasarana | `.../gtfs-static/prasarana?category=` `rapid-bus-kl` \| `rapid-bus-kuantan` \| `rapid-bus-mrtfeeder` \| `rapid-bus-penang` \| `rapid-rail-kl` | urban bus/rail | rapid-bus-kl 1.7 MB |
| MY | BAS.MY | `.../gtfs-static/mybas-` `kangar` `alor-setar` `kota-bharu` `kuala-terengganu` `ipoh` `seremban-a` `seremban-b` `melaka` `johor` `kuching` | city stage buses (not express) | mybas-johor 4.9 MB zip, 48 MB unzipped (fares v2 files huge) |
| TH | OTP namtang (Office of Transport and Traffic Policy and Planning) | `https://namtang-api.otp.go.th/download/namtang-gtfs.zip` | intercity bus + SRT rail + ferry + BTS/MRT | 42 MB zip; 126 agencies; routes by type {3:1796, 2:189, 4:75, 0:5, 1:4}; feed_version 20261001 |
| SG | LTA GTFS Schedule (Train) | GET `.../ltaodataservice/GTFSScheduleTrain` → JSON `Link` (S3 presigned, **expires 15 min**) | MRT/LRT only | launched 2026-08-03 (guide v6.9) |
| SG | LTA bus (not GTFS) | `.../BusServices`, `.../BusRoutes`, `.../BusStops`, `.../v3/BusArrival?BusStopCode=` | SG city bus | 500 rows/call, page `$skip=500` |
| JP | gtfs-data.jp | `https://api.gtfs-data.jp/v2/organizations/{org}/feeds/{feed}/files/feed` | local bus; e.g. `kochi-ekimae-kanko/feeds/GTFS-Ekimae_Expressbus` (高速バス) | 576 JP feeds hosted there (MDB) |
| JP | ODPT public | `api-public.odpt.org/...` (45 feeds per MDB) | bus/rail | exact paths `unverified` |
| TW | TDX | see other seat's doc | — | MDB TW entries all inactive/deprecated |
| KR | — | none in MDB (0 feeds); see data.go.kr doc | — | — |

### Discovery APIs
| Method + path | Purpose | Key params | Key response fields |
|---|---|---|---|
| GET `files.mobilitydatabase.org/feeds_v2.csv` | full catalog, no auth | — | `id`,`data_type`,`location.country_code`,`provider`,`urls.direct_download`,`urls.authentication_type`,`urls.latest`,`urls.license`,`status`,`location.bounding_box.*` |
| POST MDB `/v1/tokens` | refresh→access token | body `refresh_token` | access token |
| GET MDB `/v1/gtfs_feeds` | list feeds | `country_code`,`subdivision_name`,`municipality`,`dataset_latitudes`,`dataset_longitudes`,`bounding_filter_method`,`is_official`,`limit`,`offset` | feeds incl. `latest_dataset.hosted_url` (MDB mirror zip), `downloaded_at` |
| GET MDB `/v1/gtfs_feeds/{id}/datasets` | dataset history (checked daily) | `latest`,`limit`,`offset`,`downloaded_after/before` | datasets newest first |
| GET MDB `/v1/search` | full-text search | `search_query`,`data_type`,`status`,`limit`,`offset`,`license_ids` | `total`,`results[]` |
| GET TL `/feeds` | feed search | `search`,`lat`,`lon`,`radius`,`bbox`,`spec`,`license_*` flags,`limit`,`after` | feeds |
| GET TL `/stops` | stops near point | `lat`,`lon`,`radius`,`search`,`served_by_route_type`,`feed_onestop_id` | `stops[].onestop_id`,`stop_name`,`geometry` |
| GET TL `/stops/{stop_key}/departures` | departures | `service_date`/`date`/`relative_date`,`start_time`,`end_time`,`next`,`limit` | `stops[].departures[]`: `departure_time`,`arrival_time`,`departure.scheduled_local`,`trip.trip_headsign`,`trip.route`,`stop_sequence` |
| GET TL `/feeds/{feed_key}/download_latest_feed_version` | zip | — | only "if redistribution is allowed by the source feed's license" |

Example (observed, no key):
```bash
curl -sSL -o ktmb.zip https://api.data.gov.my/gtfs-static/ktmb
unzip -p ktmb.zip stop_times.txt | head -4
# trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
# 1004,22:30:00,22:30:00,19100,1,0          <- 19100 = KL SENTRAL
# 1004,23:00:00,23:02:00,18500,2,18.72
# 1004,25:56:00,26:26:00,9000,3,207.52      <- after-midnight >24h
```
Example LTA (docs shape):
```bash
curl -s -H "AccountKey: $LTA_DATAMALL_ACCOUNT_KEY" \
  https://datamall2.mytransport.sg/ltaodataservice/GTFSScheduleTrain
# docs: { ..., "Link": "https://dmprod-datasets.s3.ap-southeast-1.amazonaws.com/train-gtfs-schedule/gtfs_schedule.zip?X-Amz-Security-Token=..." }
```
Example MDB token (docs):
```bash
curl -s https://api.mobilitydatabase.org/v1/tokens -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$MOBILITYDB_REFRESH_TOKEN\"}"
```

## Limits
| Service | Limit |
|---|---|
| data.gov.my GTFS Static/Realtime | **4 requests/minute**, exceed → 429; token for higher limits (amount `unverified`) |
| data.gov.my update freq | KTMB daily 00:01; Prasarana/BAS.MY "as required"; recommended refresh daily ~4am |
| LTA DataMall | 500 records/call; GTFS link expires 15 min; GTFS update "Ad hoc"; call rate `unverified` |
| MDB | refreshes each feed daily at midnight UTC; API rate limit `unverified`; `limit` max 100 on some endpoints |
| Transitland Explorer (free) | REST 10,000 queries/month; Routing 1,000/month; Vector tiles 100,000/month; no GraphQL; non-commercial. Pro $200/mo annual ($250 monthly), REST 200k |
| Vercel Hobby fn | max duration 300 s; memory 2 GB/1 vCPU; bundle 250 MB uncompressed; request/response body **4.5 MB** (413 `FUNCTION_PAYLOAD_TOO_LARGE`); 1,024 fds |

## Coverage
Intercity reality check (our target routes):
| Corridor | GTFS? |
|---|---|
| KL ↔ Singapore coach | **no** (no operator feed; BOT/12Go deep link) |
| KL ↔ Penang/Butterworth, KL ↔ JB | rail yes (KTMB ETS); coach no |
| JB Sentral ↔ Woodlands | yes, KTMB `ST` shuttle |
| Bangkok ↔ Chiang Mai | bus yes (TC บขส., NCA); **SRT rail no** — namtang long-distance trains have placeholder times (observed 2026-10-02, see Gotchas) |
| Bangkok ↔ Malaysia border/Penang | `unverified` (check namtang routes at build) |
| Japan highway bus | sparse (few 高速バス feeds); JR intercity `unverified` |
| Korea / Taiwan | not GTFS here → other docs |

## Errors
| Case | Behaviour |
|---|---|
| data.gov.my over limit | 429 Too Many Requests |
| Transitland no/invalid key | 401 `{"error":"Unauthorized"}` (observed) |
| MDB no token | 302 redirect (observed), not JSON |
| MDB `/v1/search` `has_seal` filter | 403 unless granted |
| Vercel fn timeout | 504 `FUNCTION_INVOCATION_TIMEOUT` |
| LTA expired `Link` | S3 403 (inferred, `unverified`) → re-call endpoint |

## Gotchas
- **Thai namtang non-standard**: trips are templates — `stop_times` relative from `00:00:00`, real departure in `frequencies.txt` with `start_time==end_time`, `headway_secs=0` (spec says positive int). Expand: dep = `start_time` + offset; treat headway 0 as single departure. Observed 2026-10-02: most intercity trips instead chain windows with `headway_secs` = window length (`07:25→20:00 h=45300` = 07:25 + 20:00) → end inclusive, dedupe (ADR-B04). Counts: 555 freq rows h=0, 9517 h>0; 32 bus trips have no frequencies (absolute times). Max time 23:45 (no >24h in namtang; KTMB has). Names bilingual `"ไทย;English"` → split on `;`. `timepoint=0` (approximate).
- Namtang `fare_attributes.txt` has real `price` + `currency_type` THB per `fare_rules` origin/destination zone (observed 2026-10-02) — skipped for now (buses Backlog).
- Namtang `shapes.txt` 154 MB, fares 65 MB → skip those files when unzipping (stream only needed entries).
- myBAS zips carry 38 MB fares-v2 files; same, skip.
- **Namtang SRT unusable for intercity (observed 2026-10-02, feed_version 20261001):** 199 rail trips; 23 long-distance copies (e.g. train 9 Bangkok→Chiang Mai, 13 stops) run `00:00:00`→`00:07:00` in 1-min steps, no frequencies; the 176 real-timed trips are truncated ≤ 2 h stubs (train 9 = Krung Thep Aphiwat 18:40 → Rangsit only). Build drops legs > 300 km/h straight-line → 0 SRT legs between our cities.
- KTMB zip has no `feed_info.txt`; calendar 20260818–20261015 (observed 2026-10-02). Intercity = `route_type` 2 (`ETS`,`ERT`,`SH`,`ST`); Komuter = 0. `route_short_name` = service (`ETS`), trip_id looks like train no. (`9326`) `unverified`. ETS 1004/1005 run to **HAT YAI** (TH) in KTMB times/tz.
- Woodlands CIQ (1.4437,103.7696) is nearer JB centroid than SG → pinned via `cities.json` `stops: ["ktmb:37600"]`.
- KTMB calendar ends 20261015 → rebuild before demo if past; check `end_date` at build, fail loudly.
- Times >24:00 and `agency_timezone` (`Asia/Kuala_Lumpur`, `Asia/Bangkok`) — compute dates in feed tz, not UTC/Vercel `iad1`.
- MDB `country_code` for SG community feeds sometimes `MY` (observed mdb-3051/3409) → don't trust country filter blindly.
- Stop ≠ city. Need city→stop_ids map (geo radius around city centroid or `parent_station`). Build it once.
- Transitland free tier non-commercial; if hackathon project goes commercial, re-check.
- data.gov.my 4 req/min: fetch feeds in build script sequentially, cache zips (e.g. Vercel Blob or repo `data/`), never per user request.

## Recommended approach (serverless)
**Pre-process at build/cron time → compact JSON; runtime only reads JSON.**
1. `scripts/gtfs-build.ts` (Node, local or GitHub Action daily): download KTMB + namtang (+ optional LTA train) zips; stream-unzip only `agency,stops,routes,trips,stop_times,calendar,calendar_dates,frequencies`.
2. Filter: `route_type` in {2, 3, 4} for intercity; drop urban (BTS/MRT/Rapid) unless needed.
3. Map stops → our `cityId` (radius ~15 km around city centroid; manual overrides).
4. Emit per city-pair file `data/gtfs/pairs/{fromCity}__{toCity}.json`: `[{op, mode, dep:"HH:MM", arr:"HH:MM", dayOffset, days:[1..7], from:"stopName", to:"stopName", validFrom, validTo, except:{add:[],remove:[]}}]` + `data/gtfs/meta.json` (feed versions, licences, build date).
5. Route handler `app/api/schedules/route.ts`: read pair JSON (import or `fs` with `outputFileTracingIncludes`), filter by weekday + exceptions, return ≤ few KB. Keep each response far under 4.5 MB; total data well under 250 MB bundle.
Why not runtime: 42 MB zip download + unzip + parse 159k stop_times per cold start ≈ seconds-to-tens-of-seconds, memory spikes, 4 req/min upstream throttle, and upstream outages break demo. Transitland departures API = fallback for live lookups only (10k/month budget).

## Sources
| URL | What it confirms | Verified |
|---|---|---|
| https://gtfs.org/documentation/schedule/reference/ | files, presence, required fields, route_type, >24h times, rev 2026-04-27 | yes |
| https://raw.githubusercontent.com/google/transit/master/gtfs/spec/en/reference.md | `headway_secs` positive int; calendar cond. rules | yes |
| https://gtfs.org/documentation/realtime/reference/ | protobuf, FeedMessage/header, entity types | yes |
| https://developer.data.gov.my/realtime-api/gtfs-static | MY endpoints, agencies, categories, update freq | yes |
| https://developer.data.gov.my/rate-limit | 4 req/min, 429 | yes |
| https://api.data.gov.my/gtfs-static/ktmb | KTMB zip shape | yes (observed) |
| https://namtang-api.otp.go.th/download/namtang-gtfs.zip | Thai feed contents, quirks | yes (observed) |
| https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf | `GTFSScheduleTrain`, 15-min Link, AccountKey, 500 rows/$skip, v6.10 2026-10-01 | yes |
| https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html | signup, SG Open Data Licence | yes |
| https://github.com/MobilityData/mobility-feed-api | token flow, CSV link | yes |
| https://raw.githubusercontent.com/MobilityData/mobility-feed-api/main/docs/DatabaseCatalogAPI.yaml | MDB endpoints/params, `hosted_url` | yes |
| https://files.mobilitydatabase.org/feeds_v2.csv | catalog columns, Asian feed counts/URLs/licences | yes (observed) |
| https://mobilitydatabase.org/faq | free, daily midnight UTC check, commercial ok | yes |
| https://transit.land/api/v2/rest/openapi.json | TL endpoints, params, departure fields | yes (observed) |
| https://www.transit.land/documentation/rest-api/ | base URL, `apikey` param/header, pagination | yes |
| https://www.transit.land/plans-pricing/ | Explorer limits, non-commercial, Pro price | yes |
| https://api.gtfs-data.jp/v2/feeds | JP feed list, `feed_license` | yes (observed) |
| https://vercel.com/docs/functions/limitations | Hobby 300 s, 2 GB, 250 MB, 4.5 MB body | yes |
| data.gov.my licence text, LTA rate limit, MDB token lifetime, ODPT paths | — | unverified |
