# Flights — PLAN (Architecture)

Written once. Amend via `DECISIONS.md` ADR-F. Orientation: `REFERENCE.md` → core `REFERENCE.md`.
Ground truth: `.agents/docs/api/travelpayouts.md`.

## Goal

A flight query returns cheapest known fares (Travelpayouts Data API) as `Offer`s with
`kind: "cached"`, honest `price.asOf`, and an Aviasales deep link carrying our `marker`.

## Invariant

> Never present a cached fare as live or bookable at that price.

`kind: "cached"`, `price.asOf` from response, UI copy "from". Booking = redirect to Aviasales.

## Topology

```
fanOut ─▶ providers/travelpayouts/index.ts
            ├─ places.ts  Place → IATA (city or airport) via committed airports/cities snapshot
            ├─ client.ts  GET api.travelpayouts.com/aviasales/v3/prices_for_dates
            │             header X-Access-Token, currency + market ALWAYS sent
            └─ map.ts     v3 data[] → Offer (segments: 1 per direction, transfers noted)
```

## Decision table

| # | Decision | Chosen | Reason |
|---|---|---|---|
| D1 | Endpoint | `v3/prices_for_dates` | replaces v1/v2; returns flight_number, duration, link |
| D2 | Search API (real-time) | not used | gated ≥50k MAU (doc § Verdict) |
| D3 | Airport data | snapshot `/data/en/airports.json` + `cities.json` into repo via script | no token, 600/min, avoid runtime fetch |
| D4 | Caching | `fetch` `next: { revalidate: 86400 }` per URL | doc recommends 24h |

## Phasing

F01 adapter (IATA in) → F02 Place→IATA resolver → F03 deep links with marker.

## Out of scope

Real-time search, booking, price calendar endpoint (backlog), airline logos (backlog).
