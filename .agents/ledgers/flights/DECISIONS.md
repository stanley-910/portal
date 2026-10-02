# Flights — Decisions (append-only ADR log)

Prefix `ADR-F`. Never edit past entries.

---

## ADR-F01 — 2026-10-02 — Data API cached fares only; no real-time Search API

**Context:** Travelpayouts offers Data API (free, cached ≤48h) and real-time Search API.
**Decision:** Data API `v3/prices_for_dates` only. `Offer.kind = "cached"`.
**Why not Search API:** requires ≥50,000 confirmed MAU, "no exceptions" (travelpayouts.md § Verdict).
**Consequences:** thin routes sparse; empty result is normal, not an error. Fallback deep link.

## ADR-F02 — 2026-10-02 — Always send `currency` + `market`

**Context:** Defaults are RUB / `ru` market; cache split by market.
**Decision:** `currency` from `SearchQuery.currency` (lowercased), `market` default `us`, env-overridable `TRAVELPAYOUTS_MARKET`.
**Consequences:** results vary by market; documented in Gotchas.
