# Trains decisions

Moved from `.agents/ledgers/trains/DECISIONS.md` on 2026-10-03, with the ADR IDs kept so existing references still resolve. To reverse a decision, set it to `superseded` and link the one that replaces it (see `docs/README.md`).

## ADR-T01 — 2026-10-02 — TDX: snapshot static, cache dynamic, never fan out per request

**Status:** superseded by ADR-T04

**Context:** TDX free tier 5 req/min/key, 3 pts/month (~4,500 calls). Guest 20/day/IP.
**Decision:** `stations.json` + fares snapshotted by script (committed). Timetables fetched
per (OD, date) and cached `revalidate: 86400`. Token cached in module scope, refresh before
`expires_in`. Seat status optional, cached 5 min.
**Consequences:** first query per OD/date costs 1–2 calls; quota tracked in devlogs during testing.

## ADR-T02 — 2026-10-02 — No 12306 calls at request time

**Status:** built

**Context:** Team listed "China High-Speed Rail (12306)" as free API. Doc `china-12306.md`:
no official API; 12306 says never authorised third parties; regulators ordered OTAs to stop
automated high-frequency querying; no-cookie call → 302.
**Decision:** `china-rail` provider = curated seed timetable for demo pairs + Trip.com/12Go link-out.
`station_name.js` may be fetched once by a script for station names/codes only.
**Why not scrape:** legal + reliability risk; cookie/CAPTCHA dance from US/EU servers.
**Consequences:** `kind: "timetable"`, no price.

## ADR-T03 — 2026-10-02 — Rome2Rio dropped

**Status:** built

**Context:** Listed as free train source. Doc `rome2rio.md`: not accepting new applications, `/documentation/` 404, `free.rome2rio.com` NXDOMAIN, site Cloudflare-blocked.
**Decision:** No `rome2rio` provider. Removed from core `ProviderId` before C01 landed.
**Consequences:** multimodal gaps covered per country (TDX, TAGO, GTFS). Google Routes `TRANSIT` (paid) in backlog only.

## ADR-T04 — 2026-10-02 — Taiwan: THSR seed + link-out, no TDX key (supersedes ADR-T01)

**Status:** built

**Context:** ADR-T01 assumed a TDX member key. Ahmet started signup on 2026-10-02: the form
requires a Taiwan mobile number for SMS; the only other path is "Manual Verification" (email
identity statement to tdx@motc.gov.tw, human review, no stated turnaround). Owner declined that
path. Guest mode (20 calls/day/IP) still cannot serve Vercel traffic (doc `taiwan-tdx.md` § Verdict).
**Decision:** No TDX calls at request time. THSR becomes a seeded provider per core ADR-C05:
committed station list (12 stations) + typical timetable (train number + stop times per
direction), `kind: "timetable"`, link-out to THSR booking. TRA (T02) and TDX intercity bus
(buses B01) are dropped — ~240 TRA stations and the bus stop-pair index are not hand-seedable.
Provider id stays `tdx` and folder `providers/tdx/` — no contract (`ProviderId`) change.
**Why not keep TDX behind `NOT_CONFIGURED`:** a dead adapter costs build time and always shows
up in `errors[]` at demo.
**Consequences:** ADR-T01 no longer governs; older task Notes quoting it were true when written.
`TDX_CLIENT_ID`/`TDX_CLIENT_SECRET` stay optional in the env schema (unused). Taiwan east coast
(TRA) and buses: no coverage. Re-opening = new task once a key exists (backlog).

## ADR-T05 — 2026-10-02 — Korea = hand-curated seed, no data.go.kr key

**Status:** built

**Context:** data.go.kr signup needs a Korean national + 본인인증 (Korean phone / i-PIN); nobody on the team can do it (STATE blocker 2026-10-02). TAGO `TrainInfo` therefore has no key.
**Decision:** `src/lib/transport/providers/korea-tago/` = hand-curated seed in core ADR-C05 format: per pair `departures` (`HH:MM`), `tz: "Asia/Seoul"`, `durationMin`, adult fare KRW, train grade/number, cited `source` (public Korail timetable/fare pages). Demo pairs: Seoul–Busan, Seoul–Daejeon, Seoul–Dongdaegu, Seoul–Gwangju-Songjeong, Seoul–Gangneung, Yongsan–Mokpo. Station coords hand-entered with `source`. No request-time calls. Provider id stays `korea-tago`.
**Why not scrape Korail:** no legal live source found (`korea-data-go-kr.md` § Verdict).
**Consequences:** `kind: "timetable"`, fares are typical adult fares. `DATA_GO_KR_SERVICE_KEY` stays optional, unused. Live TAGO client = backlog, trigger: key obtained.

## ADR-T06 — 2026-10-03 — Thai intercity rail = hand-curated SRT seed

**Status:** built

**Context:** T05 Notes / `gtfs.md` Gotchas (observed 2026-10-02): namtang long-distance SRT trips run 00:00→00:07 placeholders; real-timed trips are ≤ 2 h stubs. The speed cap drops them, so Bangkok ↔ Chiang Mai has buses only. Owner asked to add Thai trains as a task (2026-10-03).
**Decision:** new provider `srt` (core ADR-C08) serving a committed seed in core ADR-C05 format: stations with cited coords; trains with train number, class/type, stop times per station, `days?`, `tz: "Asia/Bangkok"`, cited `source` (railway.co.th timetable or SRT D-Ticket schedule, date read). `kind: "timetable"`; fare only if the source publishes it. Link-out to SRT D-Ticket booking (`dticket.railway.co.th`, `unverified`). No request-time calls. Namtang rail stays filtered in `gtfs` (no double counting).
**Why not fix namtang:** source data itself is wrong; nothing to repair at build time.
**Consequences:** timetable is a snapshot; re-curate when SRT changes it. KTMB stays on `gtfs` (T05).
