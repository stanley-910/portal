# S02 — Generic 12Go seed adapter + ferry route seed
REPO: (this repo) · Depends: S01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/12go.md`, then this.
**Model: opus** — shape shared with buses seat; frozen after merge (ADR-S02).

## Goal
Owner's ask:

> "12Go Asia API | Free For ferries"

API is not free/public (ADR-S01). Deliver ferry results anyway: own seed + 12Go link-out.
Adapter is generic so buses `B04` only adds `bus-routes.json`.

## Non-negotiables
- Seed rows cite `source` (operator site, government timetable). Never 12go.asia content.
- `Offer.kind = "timetable"`, no `price`, `bookingUrl` from S01, `attribution` none required (`unverified`).
- `covers(q)`: mode in `modes` (or empty) AND both ends within cap (e.g. 30 km) of a seeded stop for that mode.
- Seed loaded via static `import` (bundled), not fs read at runtime.

## Context (anchors)
- `SeedRoute` shape in ferries `REFERENCE.md` — implement exactly.
- Segment times: core ADR-C05 — one offer per seeded `departures` entry on `q.date`, in row `tz`.

## Steps
- [ ] `match.ts` nearest seeded stop within cap.
- [ ] `index.ts` generic: `routesFor(mode)` → match from/to → `Offer` per route (both directions).
- [ ] `ferry-routes.json` ≥ 10 routes per STATE default coverage, each with `source`, slugs hand-verified.
- [ ] Tests: Bangkok-area → Koh Samui area query returns seeded ferry; far query → `covers` false; reverse direction works; `bookingUrl` tagged per S01.

## Definition of done
- Search near Surat Thani pier → Koh Samui returns ≥ 1 ferry `timetable` offer with 12Go link.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- 12go`

## Notes

- 2026-10-02: Implemented generic `12go` provider, nearest-stop matching within 30 km,
  timezone-aware timetable offers, reverse-direction matching, and static JSON imports.
- 2026-10-02: Added ten ferry route rows covering Thailand, Hong Kong–Macau, Bali/Nusa
  Penida, and Bali–Gili, each with an operator/public timetable source.
- 2026-10-02: Focused verification passes: `pnpm lint`, `pnpm exec tsc --noEmit`,
  `pnpm test -- 12go` (8 passed).
