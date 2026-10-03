# Pip smartness: map

## Destination

Pip handles "my leg is too expensive, how do I get it in range?" without being told how. It tries
cheaper nearby gateways and ground connectors, chains the segments with realistic connection times,
lines arrivals up with friends heading to the same city, and applies the chosen route to the plan.
It does this quickly: few tool rounds, little reasoning on easy turns, no repeated searches.

The canonical case: Hong Kong → Shanghai by HSR or air is over budget; Pip suggests MTR or HSR to
Shenzhen, then Shenzhen North → Shanghai Hongqiao, arriving near a friend's train.

## Notes

- Code lives in the `pip/smartness` worktree (`~/worktrees/portal/2026-10-04_pip-smartness`).
- Rules from `AGENTS.md` hold: every leg shows its source; anything not live is marked estimated;
  provider calls stay server-side; every provider has an offline fallback.
- Decisions made in conversation with Stanley (2026-10-04):
  - No stored budget field. A budget is a one-off tool argument when someone states a number;
    "too expensive" means cheaper than the cheapest option the leg has now.
  - Origin is each member's first leg; `describePlan` states it explicitly.
  - Reasoning effort is chosen per step from which tools the model called, not from parsing text.
- Each chunk of one or two tickets is reviewed once by `codex review` (gpt-6-astra, xhigh) before
  its findings are worked in; the next chunk starts while the review runs.

## Tickets

Status: `open`, `doing`, `review`, `done`. Blocked-by lists ticket names.

### T1 · Corridor rail fares and Shenzhen/Guangzhou–Shanghai trains — `done`

Give `china-rail` seed trains a typical second-class fare and add the trains the reroute needs:
Shenzhen North ↔ Shanghai Hongqiao, Guangzhou South ↔ Shanghai Hongqiao, plus fares on the
existing West Kowloon services. Hub `connections.json` gains the matching edges. Priced offers keep
`kind: "timetable"` and say "typical fare" in their attribution; check the UI marks them as not live.
Blocked by: none.

### T2 · Cross-border ground connector (MTR + border + Shenzhen Metro) — `done`

A small offline provider for frequent-service ground links that no timetable covers: Hong Kong urban
area ↔ Shenzhen (Futian / Shenzhen North) via MTR East Rail, the Lok Ma Chau or Lo Wu crossing and
Shenzhen Metro. Typical fare and door-to-door time, `kind: "estimated"`, cited. Offers show up in
ordinary searches so a leg can carry them.
Blocked by: none.

### T3 · Search cache — `done`

An in-memory, short-TTL cache in front of `searchTransport` keyed by the normalised query, shared by
leg searches, `find_meetup`, nearby rail and the composer. In-flight requests are deduplicated.
Blocked by: none.

### T4 · Route composer — `done`

A pure, tested library: given a from/to place, date, currency and optional ceiling or arrival
target, try the direct search and each gateway near the origin (from hubs and connectors), chain
first and second segments with connection buffers (longer for borders and airports), total the
fares, and return the top few itineraries with savings against the cheapest direct option,
door-to-door time and arrival gap. Never invents a price: an itinerary with an unknown fare says so.
Blocked by: T1, T2, T3.

### T5 · `optimize_leg` tool, apply, prompt and context — `done`

Room tool `optimize_leg` (and solo `optimize_route`) over the composer; results get handles R1–R3;
`apply_route` replaces the leg with the route's legs as one changeset. The system prompt routes
"too expensive / budget / cheaper / arrive together" to it. `describePlan` states each member's
origin and each leg's cheapest fare and earliest arrival so Pip can reason without extra calls.
Blocked by: T4.

### T6 · Per-step reasoning effort — `done`

`prepareStep` runs the first step at low effort and switches to high once a planning tool has been
called (`find_meetup`, `optimize_leg`/`optimize_route`, `search_routes`, `search_nearby_trains`).
Blocked by: T5.

### T7 · Fewer Storage round-trips — `review`

Tools reuse a loaded plan within a run until a write invalidates it, instead of a full
`getStorageDocument` per tool call. The saucer animation waits stay; they are deliberate UX.
Blocked by: none.

### T8 · Pip eval suite — `review`

A script that runs scripted scenarios against solo Pip with the real model and checks the tools it
called, its plan, the numbers it quoted against tool output, and latency. The canonical Hong Kong →
Shanghai case is scenario one. Blocked by: T5, T6.

## Chunks

1. T1 + T2 (data)
2. T3 + T4 (cache + composer)
3. T5 + T6 (tools, prompt, effort)
4. T7 + T8 (round-trips + evals)

## Decisions so far

- T1 — China rail seed trains carry published second-class fares (the low end of a sourced range; unsourced ones stay
  unpriced). Shenzhen North, Futian and Guangzhou South connect to Shanghai Hongqiao. `china-rail` looks at most 60 km
  from a point, so a Hong Kong leg no longer lists Guangzhou trains. Stored train, bus and ferry offers keep their
  stations (`departs`/`arrives`), shown on the leg card and to Pip.
- T2 — `cross-border` models Hong Kong (anywhere within 30 km of Admiralty, airport included) ↔ Shenzhen North by MTR,
  Lo Wu and Shenzhen Metro: estimated HK$58, 105 min, two changes.
- T3 — `searchTransport` caches 5 min (30 s with provider errors), shares in-flight searches, copies results per caller
  and keys on position, ids and country. Off under Vitest.
- T4 — `composeRoutes`: "here" is within 40 km and the same country, so a city put at its airport still owns its
  stations and a border is elsewhere. Gateways come from connectors and from far departures the direct search finds.
  Sandbox inventory and unscheduled estimates are never used. Waits are capped at 3 h. Arrival targets without an
  offset are local wall-clock time at the destination.
- T5 — Room: `optimize_leg` (`arrive_with` another leg) and `apply_route`, which splits a leg all-or-nothing
  (`editPlan(..., atomic)`) and keeps its place among the day's legs. Home globe: `optimize_route`, applied with
  `plan_trip`. The plan context names each member's start and each leg's cheapest fare.
- T6 — Reasoning effort is per step (`src/lib/agent/effort.ts`): low until a planning tool returns, then high.
- T7 — Room tools reading together share one Storage read for 2 s; tools that change the trip read fresh.
- T8 — `pnpm eval:pip` runs six scripted home-globe conversations against the real model and search, and writes
  `docs/pip-smartness/eval-results.md`. All six pass (2026-10-04).

## Not yet specified

- Flexible dates (±1 day) in the composer, once the single-date version proves useful.
- Destination-side gateways (arrive at a cheaper station and connect into the city).
- Whether the room's leg options UI should sort by price or time (Stanley: maybe later, a filter).
- Onward services the next day: the composer searches every part on the leg's date, so an overnight connection
  isn't found.
- Getting to the first station and from the last: totals and times cover the services listed, and say so.
- Room-trip evals: the suite drives home-globe Pip only; a room needs Liveblocks.
- More connectors (Macau, Zhuhai, Lok Ma Chau Spur Line to Futian) and more corridors with sourced fares.

## Out of scope

- A stored per-member budget field (decided above).
- Itineraries, sights, hotels (product rule).
