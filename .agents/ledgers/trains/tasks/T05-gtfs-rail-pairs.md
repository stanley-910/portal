# T05 — GTFS rail pairs (KTMB, SRT)
REPO: (this repo) · Depends: B03 · Status: done
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/gtfs.md`, then this.
**Model: sonnet** — filter over B03 pipeline.

## Goal
Owner's ask:

> "we will implement these apis to our system … i will do the other two"

B03 builds the GTFS pair pipeline for buses. Extend it to rail (`route_type` 2): KTMB ETS/
Intercity (MY↔SG shuttle) and SRT from Thai namtang feed.

## Non-negotiables
- Same build-time pipeline; no runtime zip parsing.
- `Segment.mode = "train"` for `route_type` 2; operator from `agency_name`.
- KTMB calendar end date checked at build (fails loudly if past).

## Context (anchors)
- B03 `scripts/gtfs-build.mts`, `providers/gtfs/` (B03 Notes say exact names).

## Steps
- [x] Include `route_type` 2 in build filter; tag mode.
- [x] Tests: KL Sentral → Butterworth/Padang Besar pair returns ETS; Bangkok → Chiang Mai returns SRT + buses.

## Definition of done
- KL → Penang (Butterworth) returns train offers.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- gtfs`

## Notes
- Cities: none decided → used buses STATE default list (already in `gtfs/cities.json`, 12 cities). Singapore got `"stops": ["ktmb:37600"]` (Woodlands CIQ is nearer the JB centroid).
- Files: `scripts/gtfs-build.mts` (`FEEDS` += `ktmb` `routeTypes [2]`; namtang `[2, 3]`), `gtfs/build.ts`, `schema.ts` (`City.stops?` pins), `index.ts` (`MODES` = bus, train), fixture `__fixtures__/ktmb/` (real subset: trips 1010, 9323, 9326, 61, 72, Komuter weekday_2102).
- Build rule changes (B03 Notes line marked superseded): (1) per trip, one stop per city = stop **nearest city centre** within its first visit (was: first stop inside radius → Sungai Buloh / Bukit Mertajam / Bdr Tasek Selatan instead of KL Sentral / Butterworth). (2) Legs with straight-line speed > 300 km/h or non-positive duration dropped. Namtang bus counts unchanged (241).
- Live build 2026-10-02: 36 pairs, 404 departures (241 bus + 163 KTMB train). KL→Penang 11, KL→Ipoh 26, KL→JB 14, JB→SG 19, SG→JB 13, KL↔Hat Yai 1 (ETS 1004/1005).
- **SRT live = 0 legs.** Namtang long-distance SRT trips carry placeholder times (00:00→00:07 BKK→CNX); real-timed ones are ≤ 2 h stubs. Speed cap drops them. BKK→CNX live = 27 buses only; "SRT + buses" test passes on the mini fixture only. Doc `gtfs.md` Gotchas/Coverage patched. SRT needs another source (seed like T04/T06) → not in scope, candidate backlog.
- `num` = `route_short_name` (`ETS`, `ST`), not train number; trip_id looks like train no. but `unverified`.
- KTMB calendar ends **20261015** → `pnpm gtfs:build` throws after that (`assertFeedCurrent`, tested). Re-run build before demo; data.gov.my 4 req/min.
- KTMB licence string in meta = "data.gov.my open data (exact licence unverified)".
- Query at Woodlands coords still maps to JB (`cityAt` for queries has no pins) — Singapore centroid works.
- Verification 2026-10-02: `pnpm lint && pnpm exec tsc --noEmit && pnpm test -- gtfs` → eslint clean, tsc clean, 8 files / 87 tests pass (`-- gtfs` does not filter; whole suite ran).
- Live smoke: `next dev`, `/api/transport/search` KL→Penang `date=2026-10-06 modes=train` → 11 `gtfs` offers (first ETS KL SENTRAL 08:05 → BUTTERWORTH 12:10 +08:00, 245 min, attribution "Data: KTMB via data.gov.my"); JB→SG 19 offers to WOODLANDS CIQ. `errors` = only `korea-tago NOT_CONFIGURED`.
