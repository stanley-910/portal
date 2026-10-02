# T04 — China rail seed + affiliate link-out
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/china-12306.md`, then this.
**Model: sonnet** — static data + URLs.

## Goal
Owner's ask:

> "China High-Speed Rail (12306) … Free for Trains"

No legal live source (ADR-T02). Show curated high-speed timetables for demo pairs and link out
for prices/booking.

## Non-negotiables
- Never call 12306 at request time. `station_name.js` only via one-off script, if at all.
- Seed rows cite `source` (public timetable page, operator notice). `kind: "timetable"`, no price.
- Link-out: Trip.com affiliate (12Go `links.ts` only if S01 already `done` — not a dependency). Trip.com param names `unverified` — confirm or ship untagged.

## Context (anchors)
- Demo pairs (default): Beijing–Shanghai, Shanghai–Hangzhou, Guangzhou–Shenzhen, Shenzhen–Hong Kong West Kowloon, Beijing–Xi'an.
- Station coords hand-entered with source.

## Steps
- [ ] `china-rail/seed.json` (pairs, train numbers G/D, `departures` + `tz` per core ADR-C05, durationMin, source).
- [ ] `index.ts` match nearest seeded station within 30 km → offers on `q.date` with `+08:00`.
- [ ] `links.ts` Trip.com train search URL (or 12Go) per pair.
- [ ] Tests: Shanghai→Beijing returns seeded G trains; unseeded pair → `covers` false.

## Definition of done
- Shenzhen → Hong Kong returns timetable offers with working link-out.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- china-rail`

## Notes

