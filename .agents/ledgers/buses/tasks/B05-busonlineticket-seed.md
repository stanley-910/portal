# B05 — BusOnlineTicket seed + deep links
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/busonlineticket.md`, then this.
**Model: sonnet** — data + URLs.

## Goal
Owner's ask:

> "BusOnlineTicket API … Free for Buses"

No public API (ADR-B03). Cover MY/SG coaches (no GTFS exists) with seeded city pairs + links.

## Non-negotiables
- Own seed with `source` per row; `all_route.js` only for hand-checking slugs.
- Every seeded link hand-checked (200, not 404) — record date in doc `observed`.
- `refererid` only if `BOT_REFERER_ID` set.
- Seed rows carry `departures` + `tz` from operator sources (core ADR-C05).

## Steps
- [ ] `busonlineticket/seed.json` ≥ 10 pairs (KL–Singapore, KL–Penang, KL–Melaka, KL–Ipoh, Singapore–Melaka, KL–JB, Penang–Hat Yai…).
- [ ] `links.ts` + `index.ts`.
- [ ] Tests: KL→Singapore covered, slug format, refererid present/absent.

## Definition of done
- KL → Singapore returns bus offer linking to a working BOT page.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- busonlineticket`

## Notes

