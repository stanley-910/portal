# F02 — Place → IATA resolver from airports/cities snapshot
REPO: (this repo) · Depends: F01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/travelpayouts.md`, then this.
**Model: sonnet** — static data + nearest-point.

## Goal
Owner's ask:

> "my friend will handle flight ferry"

Queries arrive with lat/lng, not always IATA. Resolve nearest flightable city code so F01's
`covers` widens to any place within range.

## Non-negotiables
- No runtime fetch of `airports.json` per request. Snapshot via script, commit trimmed JSON.
- Snapshot only fields used (`code`, `city_code`, `country_code`, `coordinates`, `time_zone`, `flightable`, `iata_type`).
- Max snap distance constant (e.g. 150 km); beyond → `covers` false.

## Context (anchors)
- `scripts/tokens.mts` — pattern for plain-node `.mts` scripts.
- `src/components/trip-globe/airports.ts` — `nearestAirport`, `angle` helpers; reuse distance math from `vec.ts`.
- Prefer `city_code` (BKK covers DMK+BKK) — doc § Gotchas.

## Steps
- [ ] `scripts/snapshot-airports.mts` → `src/lib/transport/providers/travelpayouts/airports.json` (flightable only).
- [ ] `places.ts` `toIata(place)`: `place.iata` → city code; else nearest within cap.
- [ ] F01 `covers` uses `toIata`.
- [ ] Tests: HKG coords → `HKG`; Bangkok coords → `BKK` city code; mid-ocean → null.

## Definition of done
- Search with lat/lng only (no iata) for Taipei→Seoul returns travelpayouts offers or `[]` without `UNSUPPORTED_ROUTE`.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- travelpayouts`

## Notes

