# B05 — BusOnlineTicket seed + deep links
REPO: (this repo) · Depends: C01 · Status: done
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
- [x] `busonlineticket/seed.json` ≥ 10 pairs (KL–Singapore, KL–Penang, KL–Melaka, KL–Ipoh, Singapore–Melaka, KL–JB, Penang–Hat Yai…).
- [x] `links.ts` + `index.ts`.
- [x] Tests: KL→Singapore covered, slug format, refererid present/absent.

## Definition of done
- KL → Singapore returns bus offer linking to a working BOT page.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- busonlineticket`

## Notes

- Done 2026-10-02 (Ahmet). `providers/busonlineticket/`: `seed.json` (8 cities, 22 directed pairs, 109 operator rows), `schema.ts` (zod, parsed at load), `links.ts` (`botRouteUrl`), `index.ts`, `index.test.ts` (12 tests). `registry.test.ts` LANDED += `busonlineticket`.
- Times source: BOT route-page schedule table, first + last bus of top-5 operators by trips (ADR-B06). Not full timetables; no fares stored.
- City slugs: `malacca`, `hatyai` (BOT spelling; `melaka`/`hat-yai` 404). City keys ours (`hat-yai`), `botSlug` separate.
- City coords: Wikipedia API `prop=coordinates`, cited per city. Match = nearest city ≤ 30 km (JB vs Singapore centres ~21 km apart).
- Hat Yai departures assumed Thai local time (+07:00), arrival in dest tz — `unverified` (BOT page does not state tz).
- `refererid`: `env.BOT_REFERER_ID` → factory opt; unset = plain link. Affiliate not applied yet.
- Not seeded: Penang↔Butterworth split, KL→Genting/Cameron, SG→Genting (cities out of set; pages exist).
- Links: all 22 route pages 200, plain + `?refererid=test` (curl, 2026-10-02).
- Live: `next dev -p 3001`, `GET /api/transport/search` KL→SG `modes=bus` → 10 `busonlineticket` offers, bookingUrl = route page.
- Verification `pnpm lint && pnpm exec tsc --noEmit && pnpm test -- busonlineticket`: eslint clean, tsc clean, `Test Files 9 passed (9) · Tests 90 passed (90)` (pnpm passes the filter after `--`, so full suite runs). First run 2 red in `registry.test.ts` (BOT still treated as stub) → fixed via LANDED.

