# T04 — China rail seed + affiliate link-out
REPO: (this repo) · Depends: C01 · Status: done
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/china-12306.md`, then this.
**Model: sonnet** — static data + URLs.

## Goal
Owner's ask:

> "China High-Speed Rail (12306) … Free for Trains"

No legal live source (ADR-T02). Show curated high-speed timetables for demo pairs and link out
for prices/booking.

## Non-negotiables
- Never call 12306 at request time. `station_name.js` only via one-off script, if at all.
- Seed rows cite `source` (public timetable page, operator notice). `kind: "timetable"`, no price.
- Link-out: Trip.com affiliate (12Go `links.ts` only if S01 already `done` — not a dependency). Trip.com param names `unverified` — confirm or ship untagged.
- No Trip.com affiliate signup (owner, 2026-10-02): ship untagged links; add the id param only if `TRIPCOM_AFFILIATE_ID` is ever set.

## Context (anchors)
- Demo pairs (default): Beijing–Shanghai, Shanghai–Hangzhou, Guangzhou–Shenzhen, Shenzhen–Hong Kong West Kowloon, Beijing–Xi'an.
- Station coords hand-entered with source.

## Steps
- [x] `china-rail/seed.json` (pairs, train numbers G/D, `departures` + `tz` per core ADR-C05, durationMin, source).
- [x] `index.ts` match nearest seeded station within 30 km → offers on `q.date` with `+08:00`.
- [x] `links.ts` Trip.com train search URL (or 12Go) per pair.
- [x] Tests: Shanghai→Beijing returns seeded G trains; unseeded pair → `covers` false.

## Definition of done
- Shenzhen → Hong Kong returns timetable offers with working link-out.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- china-rail`

## Notes

- Seed: `china-rail/seed.json`, 64 trains, 9 stations, 5 pairs both directions. Generated from a row table (ADR-C05 fields + cited `source`); edit JSON directly or regenerate.
- Inclusion rule: page must name **both stations**. City-level tables (TCG summary, CH city rows) mix stations (G7357 from Shanghai stn, G7432 17:55 = Hangzhou South) → dropped. Number conflicts (BJ–Xi'an renumbering: G89/G323, G429/G1405, G58/G368, G60/G370) dropped. HK rows = official MTR PDF, valid to 2026-10-10; new PDF from 2026-10-11 — re-check rest of rows.
- Gaps: Guangzhou South ↔ Shenzhen North no station-explicit daytime rows 08:00–20:00 (only early/late). Beijing West → Xi'an North 4 trains. Source dates range Feb–Oct 2026.
- Matching: nearest seeded station ≤ 30 km picks `Station.city`; all stations of that city match (Shenzhen North + Futian; Beijing South + West). Pure radius failed: SZ ↔ HK West Kowloon ~25–28 km apart.
- `distanceKm` imported from `providers/gtfs/geo.ts` (core backlog "Place resolver" trigger: 2 adapters now).
- Link-out: Trip.com `/trains/china/list?departureStation=<中文>&arrivalStation=<中文>&departDate=` untagged; `TRIPCOM_AFFILIATE_ID` unused until params confirmed (doc § Endpoints). 12Go not used (S01 not done).
- No `attribution`; `kind: "timetable"` carries "indicative". Fixed +08:00 for both tz (no DST); cross-midnight arrive rolls date.
- `registry.test.ts` `LANDED` += `china-rail`.
- Smoke (2026-10-02): `/api/transport/search?fromName=Shenzhen&fromLat=22.5431&fromLng=114.0579&toName=Hong%20Kong&toLat=22.3193&toLng=114.1694&date=2026-10-20&modes=train` → 10 offers; link HTTP 200.
