# Buses — Decisions (append-only ADR log)

Prefix `ADR-B`. Never edit past entries.

---

## ADR-B01 — 2026-10-02 — GTFS pre-processed at build time into committed per-pair JSON

**Context:** Namtang zip 42 MB (230 MB unzipped, `shapes.txt` 154 MB); data.gov.my 4 req/min; Vercel Hobby limits.
**Decision:** `scripts/gtfs-build.mts` downloads to gitignored `.cache/gtfs/`, stream-unzips only `agency,stops,routes,trips,stop_times,calendar,calendar_dates,frequencies`, emits `src/lib/transport/providers/gtfs/pairs/{from}__{to}.json` for curated city list. Output committed.
**Why not runtime:** cold start seconds-to-tens-of-seconds, memory spikes, upstream outage kills demo.
**Consequences:** data stale until rebuilt; build checks `calendar.end_date` (KTMB ends 20261015) and fails loudly.

## ADR-B02 — 2026-10-02 — Namtang frequencies quirk handled explicitly

**Context:** Namtang trips use 00:00-relative `stop_times` + `frequencies.txt` `start_time==end_time`, `headway_secs=0` (spec violation).
**Decision:** dep = `frequencies.start_time` + stop offset; `headway_secs=0` = single run. Names "Thai;English" → split, keep English for `Place.name`, Thai in `providerIds` metadata if needed.
**Consequences:** generic GTFS libs won't parse correctly; own parser for these files.

## ADR-B03 — 2026-10-02 — BusOnlineTicket = seeded routes + deep link; no XML API

**Context:** No public API; "XML API*" unspecified, partner-only; affiliate manual approval.
**Decision:** seed of MY/SG/TH coach city pairs (own data) + `/booking/{from}-to-{to}-bus-tickets?refererid=` link.
**Why not `all_route.js` reuse:** ToS for reuse `unverified`; use only to hand-check slugs.
**Consequences:** no fares/times from BOT; `kind: "timetable"` with typical times from operator sources, per core ADR-C05.

## ADR-B04 — 2026-10-02 — Namtang frequency windows are chained departure lists (end inclusive)

**Context:** Observed 2026-10-02 (feed_version 20261001): most intercity trips use `headway_secs` = `end_time − start_time`, windows chained (`10:00→21:30 h=41400`, `21:30→22:00 h=1800`, `22:00→22:20 h=1200` = 10:00, 21:30, 22:00, 22:20). ADR-B02 covered only `headway_secs=0`.
**Decision:** expand every window `start, start+h, … ≤ end` (end inclusive), de-duplicate starts per trip. `headway ≤ 0` or `end ≤ start` = single run. `tripStarts()` in `providers/gtfs/build.ts`.
**Why not spec end-exclusive:** drops the last departure of every chain (22:20 above).
**Consequences:** a spec-conformant feed with exact-multiple windows may gain one extra run at `end_time`; acceptable for intercity timetables, revisit if a feed with urban headways is added.

## ADR-B05 — 2026-10-02 — Taiwan intercity bus dropped

**Context:** B01 depended on a TDX member key (trains T01 client). Trains ADR-T04: no key —
signup needs a Taiwan phone or manual review, owner declined. The stop-pair index needs
hundreds of `StopOfRoute` calls; guest mode (20/day/IP) cannot build it.
**Decision:** No Taiwan bus coverage. B01 retired. No seed replacement (too many routes to hand-curate).
**Consequences:** Taiwan bus queries → `tdx` reports `covers` false (T06 limits `tdx` to trains).
Re-open via a new task when a TDX key exists (trains backlog).

## ADR-B06 — 2026-10-02 — BOT seed times = route-page first/last bus per operator

**Context:** ADR-B03/C05 want cited typical departures. ~110 operator/pair rows; operator sites are many, inconsistent, mostly without timetables. BOT route pages publish a per-operator schedule table (busonlineticket.md § Coverage, observed 2026-10-02).
**Decision:** per pair the top 5 operators by "No. of Trip"; `departures` = that operator's First Bus + Last Bus; `durationMin` = pair "Est. Duration" (range → midpoint). `source` = the route page. Read by hand-run script, no fares stored, not in repo.
**Why not full timetables:** BOT shows only first/last; per-departure lists need the POST search (no permission, doc § Gotchas).
**Consequences:** 2 offers per operator, not every run; times "typical" via `kind: "timetable"`. Re-curate when pages change.

## ADR-B07 — 2026-10-02 — TDX intercity bus + Korea bus = seeded routes (supersedes ADR-B05)

**Context:** What changed: trains ADR-T04/ADR-T05 dropped the TDX member key and the data.go.kr key (Taiwan SMS signup; Korean national + 본인인증 signup; owner not signing up, 2026-10-02). PLAN D2 (TDX stop-pair index from `StopOfRoute` + `Schedule`) and D3 (`ExpBusInfo` + `SuburbsBusInfo`) both need those keys.
**Decision:** Owner (2026-10-02): mock every keyed source with seed data, so ADR-B05 (Taiwan bus dropped) no longer governs. B01 = hand-curated seed of 國道客運 routes (Taipei–Taichung, Taipei–Kaohsiung, Taipei–Tainan, Taipei–Yilan; more if sourced) with typical departures from operator sites (Kuo-Kuang, Ubus, Aloha, etc.), core ADR-C05 format (`departures` `HH:MM`, `tz: "Asia/Taipei"`, `durationMin`, operator, fare TWD if published, `source`). No stop-pair index, no TDX calls. B02 = KoBus express (고속) seed (Seoul Express Bus Terminal–Busan, –Daegu, –Gwangju, –Daejeon…), any date, same format (`tz: "Asia/Seoul"`, fare KRW). 시외 (intercity, today-only API) path dropped. Both served from the trains providers' folders (`tdx`, `korea-tago`) via their seed loaders.
**Why not TDX guest mode for buses:** 20 calls/day/IP; the route+`StopOfRoute` crawl is hundreds of calls.
**Consequences:** `kind: "timetable"`; times are typical, not per-date. ADR-B01–B04, B06 unaffected. B01 builds on the T06 `tdx` seed provider. Live TDX bus / live Korea bus = backlog, trigger: key obtained.

## ADR-B08 — 2026-10-03 — B01 times from TDX guest `Schedule`, read once at curation; trip-stop seed shape

**Context:** ADR-B07 named operator sites as the time source. Observed 2026-10-03: kingbus.com.tw TLS handshake fails, aloha168.com.tw no answer, hohsin/kamalan behind Cloudflare challenge; ubus.com.tw has no timetables or durations. taiwanbus.tw (公路局) publishes departures per route (`json/TimeTableAPIByWeek.aspx`) but no arrival/duration. TDX guest `/v2/Bus/Schedule/InterCity/{Route}` (browser UA + Referer) returns 200 with per-stop times and `ServiceDay`.
**Decision:** Seed built from 10 guest calls (routes 1619 1827 1610 7513 1611 7500 1878 1915 1572 1917), by hand, no committed crawler, no request-time call. Departures cross-checked against taiwanbus.tw (1827 both directions identical). Seed = trips with stops at our 9 terminals (like T06's THSR trains) instead of `departures[]`+`durationMin` rows: durations vary per run and one trip serves several pairs. Fares not seeded: TWD varies by seat class and time band (taiwanbus `TMSQuery` matrix).
**Why not keep ADR-B07's source:** operator sites unreachable or without durations; guessing durations is barred.
**Consequences:** `kind: "timetable"`; one Offer per run on `q.date`, weekday-aware. Re-curation = re-run guest calls (≤ 20/day/IP). ADR-B07 otherwise stands.
