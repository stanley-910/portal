# Flights decisions

Moved from `.agents/ledgers/flights/DECISIONS.md` on 2026-10-03, with the ADR IDs kept so existing references still resolve. To reverse a decision, set it to `superseded` and link the one that replaces it (see `docs/README.md`).

## ADR-F01 — 2026-10-02 — Data API cached fares only; no real-time Search API

**Status:** built

**Context:** Travelpayouts offers Data API (free, cached ≤48h) and real-time Search API.
**Decision:** Data API `v3/prices_for_dates` only. `Offer.kind = "cached"`.
**Why not Search API:** requires ≥50,000 confirmed MAU, "no exceptions" (travelpayouts.md § Verdict).
**Consequences:** thin routes sparse; empty result is normal, not an error. Since 2026-10-03 an empty result is replaced by an estimate (ADR-F03).

## ADR-F02 — 2026-10-02 — Always send `currency` + `market`

**Status:** built

**Context:** Defaults are RUB / `ru` market; cache split by market.
**Decision:** `currency` from `SearchQuery.currency` (lowercased), `market` default `us`, env-overridable `TRAVELPAYOUTS_MARKET`.
**Consequences:** results vary by market; documented in Gotchas.

## ADR-F03 — 2026-10-03 — Estimated flight when there's no cached fare

**Status:** built

**Context:** Cached fares are missing for many pairs (Manila → Tokyo had none on 2026-10-03), so a leg in the trip plan could show "No routes found" on stage. AGENTS.md: every provider needs a mock fallback; the demo can't depend on a flaky API.
**Decision:** when Travelpayouts returns no fares, has no token, or fails (not on abort), `estimateFlight` in `providers/travelpayouts/estimate.ts` returns one nonstop offer: `kind: "estimated"`, duration 40 min + great-circle distance at 780 km/h, price USD 40 + 0.075 × km, and an Aviasales search link for the pair and date. Nothing under 300 km.
**Why these numbers:** a loose fit to cached Asian economy fares on 2026-10-03 (HKG–PVG $146, SIN–HND $279, BKK–ICN $248).
**Consequences:** travelpayouts no longer reports `NOT_CONFIGURED` or upstream failures in `errors[]`; it logs `FELL_BACK_TO_ESTIMATE` instead. The estimate has no departure time (transport ADR-C09).

## ADR-F04 — 2026-10-03 — Keep the transfer count; arrivals in local time

**Status:** built

**Context:** `prices_for_dates` includes connecting fares and gives `transfers`, which we dropped, so a one-stop flight showed as nonstop (Seoul → Shanghai on the demo route has one stop). Arrivals were written in UTC.
**Decision:** map `transfers` onto `Offer.transfers` (transport ADR-C09). Write `arrive` in the destination's local time from a code → IANA zone table in `providers/travelpayouts/timezones.ts`, covering every hub on the globe plus Travelpayouts city codes; unknown codes stay UTC.
**Consequences:** the connecting airport is still unknown, so results say "1 stop", not "via Jinan". New globe hubs need a line in the zone table.
