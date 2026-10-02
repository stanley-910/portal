# Ferries — PLAN (Architecture)

Written once. Amend via `DECISIONS.md` ADR-S. Orientation: `REFERENCE.md` → core `REFERENCE.md`.
Ground truth: `.agents/docs/api/12go.md`.

## Goal

A ferry query between two coastal places returns known ferry routes (operator, typical
duration) as `Offer`s with `kind: "timetable"`, no price, and a 12Go route-page deep link where
live times, prices and booking happen.

## Invariant

> We show only data we own; 12Go data is never scraped, copied or re-hosted.

12Go has **no public API** (doc § Verdict). Route seed is curated by us from operator sites /
public sources. 12Go = link-out only.

## Topology

```
fanOut ─▶ providers/12go/index.ts   (S02 writes; generic over mode)
            ├─ ferry-routes.json  (S02, Cata)   ports, lat/lng, operators, typical durationMin, 12Go slugs
            ├─ bus-routes.json    (B-ledger, Ahmet) same shape
            ├─ links.ts           (S01) 12Go route URL + affiliate tag
            └─ match.ts           nearest seeded port/stop to q.from / q.to within cap
```

## Decision table

| # | Decision | Chosen | Reason |
|---|---|---|---|
| D1 | Data source | own curated seed JSON | 12Go API partner-only; scraping banned by affiliate agreement + robots.txt |
| D2 | Booking | 12Go route page `12go.asia/en/travel/{from}/{to}` | public, works now |
| D3 | Affiliate | one path per link: TP marker (`promo_id=1764`) **or** direct 12Go ID | never double-tag (doc § Gotchas) |
| D4 | Shared adapter | one `providers/12go/` folder, per-mode seed files | ferries + buses both use 12Go; no fork |

## Phasing

S01 links → S02 adapter + ferry seed → (B ledger adds bus seed on top).

## Out of scope

Live ferry prices/times. Emailing 12Go for API access (backlog). Non-SE-Asia ferries.
