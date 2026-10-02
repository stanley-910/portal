# B04 — 12Go bus route seed
REPO: (this repo) · Depends: S02 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/12go.md`, ferries `REFERENCE.md` (SeedRoute), then this.
**Model: sonnet** — data + tests.

## Goal
Owner's ask:

> "12Go Asia API … Free for Buses"

12Go has no public API (ADR-S01). Add `bus-routes.json` to Cata's generic adapter for routes
GTFS/BOT don't cover (Vietnam, Cambodia, Laos, cross-border TH–KH/LA).

## Non-negotiables
- Do **not** edit `providers/12go/index.ts` / `match.ts` / `links.ts` (S02/S01, Cata). Need a change → ask Cata, ADR-S.
- Each row `source` ≠ 12go.asia. Slugs hand-verified in browser.

## Steps
- [ ] `providers/12go/bus-routes.json` ≥ 10 routes (HCMC–Phnom Penh, Hanoi–Sapa, Bangkok–Siem Reap, Vientiane–Luang Prabang…).
- [ ] Tests: Hanoi→Sapa returns 12Go bus offer; ferry seed unaffected.

## Definition of done
- Ho Chi Minh City → Phnom Penh returns bus offer with 12Go link.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- 12go`

## Notes

