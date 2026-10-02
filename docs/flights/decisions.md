# Flights decisions

Moved from `.agents/ledgers/flights/DECISIONS.md` on 2026-10-03, with the ADR IDs kept so existing references still resolve. To reverse a decision, set it to `superseded` and link the one that replaces it (see `docs/README.md`).

## ADR-F01 — 2026-10-02 — Data API cached fares only; no real-time Search API

**Status:** built

**Context:** Travelpayouts offers Data API (free, cached ≤48h) and real-time Search API.
**Decision:** Data API `v3/prices_for_dates` only. `Offer.kind = "cached"`.
**Why not Search API:** requires ≥50,000 confirmed MAU, "no exceptions" (travelpayouts.md § Verdict).
**Consequences:** thin routes sparse; empty result is normal, not an error. Fallback deep link.

## ADR-F02 — 2026-10-02 — Always send `currency` + `market`

**Status:** built

**Context:** Defaults are RUB / `ru` market; cache split by market.
**Decision:** `currency` from `SearchQuery.currency` (lowercased), `market` default `us`, env-overridable `TRAVELPAYOUTS_MARKET`.
**Consequences:** results vary by market; documented in Gotchas.
