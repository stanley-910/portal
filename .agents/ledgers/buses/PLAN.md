# Buses — PLAN (Architecture)

Written once. Amend via `DECISIONS.md` ADR-B. Orientation: `REFERENCE.md` → core `REFERENCE.md`.
Ground truth: `.agents/docs/api/{gtfs,taiwan-tdx,korea-data-go-kr,12go,busonlineticket}.md`.

## Goal

Intercity bus queries in Thailand, Malaysia/Singapore, Taiwan and Korea return real schedules
(and fares where given) as `Offer`s; where no open data exists, a seeded route with a booking
link-out (12Go, BusOnlineTicket).

## Invariant

> Request-time work is a JSON lookup or one cached official API call — never a feed download,
> zip parse or scrape.

## Topology

```
build time (pnpm gtfs:build, local or CI)          request time
  namtang zip ─┐                                   fanOut
  ktmb zip ────┼▶ scripts/gtfs-build.mts ─▶ providers/gtfs/pairs/*.json ─▶ providers/gtfs/index.ts
  (myBAS)  ────┘   stream-unzip needed files
                   stops → city map (radius)
  TDX StopOfRoute ─▶ scripts/snapshot-tdx-bus.mts ─▶ providers/tdx/bus-index.json ─▶ tdx bus.ts (B01)
                                                    korea-tago bus.ts (B02) ─▶ ExpBusInfo / SuburbsBusInfo
                                                    12go (S02 adapter) + bus-routes.json (B04)
                                                    busonlineticket seed + deep links (B05)
```

## Decision table

| # | Decision | Chosen | Reason |
|---|---|---|---|
| D1 | GTFS processing | build-time → committed per-pair JSON | Thai zip 42 MB / 230 MB unzipped; data.gov.my 4 req/min |
| D2 | TDX bus A→B | dropped — no TDX key (trains ADR-T04, buses ADR-B05) | signup needs Taiwan phone; was stop-pair index |
| D3 | Korea | `ExpBusInfo` + `SuburbsBusInfo` (today-only) | official, free |
| D4 | MY/SG coaches | BusOnlineTicket seed + deep link | no feed, no public API |
| D5 | 12Go buses | reuse ferries S02 adapter + `bus-routes.json` | ADR-S02 |

## Phasing

B03 GTFS pipeline (no key needed — start here) → B05 BOT seed → B02 Korea bus → B04 12Go bus seed.

## Out of scope

City buses, real-time ETA, seat availability, booking.
