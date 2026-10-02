# F03 — Aviasales deep links with marker
REPO: (this repo) · Depends: F01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/travelpayouts.md`, then this.
**Model: sonnet** — URL building.

## Goal
Owner's ask:

> "my friend will handle flight ferry"

Every flight `Offer.bookingUrl` opens Aviasales with our `marker` so bookings attribute.
Same helper later tags 12Go links (ferries S01).

## Non-negotiables
- `link` from response is relative → prefix `https://www.aviasales.com`.
- Marker appended once; no marker → plain link (still works).
- Token never in a link. Marker is public-safe.
- Exact marker param name/format: confirm from doc [S7]/[S8]; patch doc `observed` once seen working.

## Context (anchors)
- Doc § Endpoints `links/v1/create` (≤100 req/min, ≤10 links/request) — optional server-side shortener.
- `src/lib/transport/providers/travelpayouts/map.ts` — F01.

## Steps
- [ ] `links.ts` `aviasalesUrl(link, marker?)`; export generic `withTpMarker(url)` for S01.
- [ ] `map.ts` sets `bookingUrl`.
- [ ] Tests: relative link prefixed; marker present once; no marker → unchanged.
- [ ] Manual: open one generated link, confirm Aviasales results page loads.

## Definition of done
- Clicking a flight result lands on Aviasales search for that route/date.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- travelpayouts`

## Notes

