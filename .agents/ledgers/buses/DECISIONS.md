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
