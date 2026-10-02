# B03 — GTFS build pipeline + gtfs adapter
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/gtfs.md`, then this.
**Model: opus** — non-standard feed, timezones, >24h times, big files.

## Goal
Owner's ask:

> "GTFS Open Data Feeds – Free for Buses"

Free and keyless — the bus ledger's first real data. Build-time pipeline → per-pair JSON →
adapter. T05 extends to rail.

## Non-negotiables
- ADR-B01: no runtime download/parse. Output JSON committed; `.cache/gtfs/` gitignored.
- ADR-B02: namtang frequencies quirk handled; covered by test.
- Times computed in `agency_timezone`; output `Segment.depart`/`arrive` ISO with offset; >24:00 rolls day.
- Skip `shapes.txt`, fares files when unzipping (stream entries).
- Build fails loudly if a feed's calendar ended before today.
- Licence/attribution per feed in `Offer.attribution` (namtang CC BY 4.0).

## Context (anchors)
- Doc § Recommended approach (steps 1–5) — follow it.
- Need a zip streamer: pick a small dep (e.g. `yauzl`/`fflate`), devDependency only.
- City list in STATE § Open blockers default.

## Steps
- [ ] `scripts/gtfs-build.mts` + `"gtfs:build"` script; `.gitignore` `.cache/`.
- [ ] Parser for needed files; namtang frequency expansion; city radius map.
- [ ] Emit `providers/gtfs/pairs/{from}__{to}.json` + `meta.json` (feed versions, built at, calendar range).
- [ ] `providers/gtfs/index.ts`: `covers` = both ends map to cities with a pair file; filter by weekday + `calendar_dates`; `route_type` 3 → bus (2 left for T05).
- [ ] Tiny hand-made GTFS fixture (incl. a frequencies `headway_secs=0` trip and a 25:10 time).
- [ ] Tests: fixture → expected pair JSON; weekday filter; exception removes date; 25:10 → next day; tz offset `+07:00`.

## Definition of done
- Bangkok → Chiang Mai tomorrow returns bus offers from namtang.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- gtfs`

Live: `pnpm gtfs:build` completes; `ls src/lib/transport/providers/gtfs/pairs | wc -l` > 0; curl search Bangkok → Chiang Mai.

## Notes

