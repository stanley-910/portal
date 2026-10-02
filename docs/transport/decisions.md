# Transport decisions

## TR1. Resolve exact globe clicks against bundled Asia-wide hubs

**Status:** built in `feat/click-to-transport-hubs`, 2026-10-03

**Decision:** Use `LandedTrip.origin` and `destination`, before the renderer's
legacy airport snap. Resolve them server-side against a pinned OurAirports
snapshot plus a curated station/ferry-terminal subset. No runtime geocoding API.

**Why:** The owner chose Asia-wide coverage and bundled data so finding nearby
hubs remains fast and independent of provider reliability. Surface coverage is
explicitly incomplete, and source/licence information travels with each hub.

**Affects:** Landing search, ticket endpoints, the GET search API's `resolve=hubs`
option. It does not replace the renderer's preview labels or multiplayer planning.

## TR2. Shortlist useful endpoint pairs, without inventing connectivity

**Status:** built in `feat/click-to-transport-hubs`, 2026-10-03

**Decision:** Rank same-mode pairs by access distance, geometric detour and a
bounded hub-importance hint. Rail/ferry pairs need a directed bundled edge;
airports remain unverified geographic candidates until provider data is returned.
Cap flight fan-out at four pairs. Preserve explicit airport IATA identity.

**Why:** The owner chose connection-aware relevance rather than independent
nearest-hub lists. Geographic plausibility is useful for provider queries, but
cannot establish a flight service, train schedule, terminal interchange or seat.

**Affects:** `hubs/resolve.ts`, `hub-search.ts`, result source/evidence labels.
[Policy and limits](README.md#relevance-policy-heuristic-not-a-routing-engine)
are intentionally documented rather than described as an optimal route solver.

## TR3. Review and harden the merged ranking before extending it

**Status:** built in `feat/click-to-transport-hubs`, 2026-10-03;
real API verification initially blocked on credentials, resolved 2026-10-03
with a successful external cached-fare fetch and full local adapter search

**Decision:** Keep price-first deterministic display ordering, with currency
identity and actual departure instants; validate offers, isolate failures and
enforce an independent eight-second deadline for each provider call. Keep
cached fares and bundled fallback candidates visibly estimated and separate.

**Why:** Review of `b26dea6` found unchecked upstream data, unbounded fan-out wait,
cross-currency comparison and UI stale-result/freshness gaps. Extending those
contracts without fixes would make click-to-hub results misleading or brittle.

**Affects:** Provider search, HTTP/Travelpayouts validation, tests, API validation,
UI cancellation and source labels. The current flight mapper deliberately handles
direct cached summaries only. The subsequent credentialed check returned cached flight fares, not live seat
availability; see [review](ranking-review.md) and [verification](README.md#verification).
