# F01 — Travelpayouts `prices_for_dates` adapter
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/travelpayouts.md`, then this.
**Model: sonnet** — mapper over documented JSON.

## Goal
Owner's ask:

> "my friend will handle flight ferry"

Replace `providers/travelpayouts/index.ts` stub with a real adapter: query with IATA codes on
both `Place`s → cheapest cached fares as `Offer[]`. F02 adds lat/lng → IATA; F03 deep links.

## Non-negotiables
- Token via `X-Access-Token` header only. Never in URL, logs, fixtures.
- Always send `currency` + `market` (ADR-F02). `kind: "cached"` (ADR-F01).
- Empty `data` = `[]`, not error. 401 → `AUTH_FAILED`, 429 → `RATE_LIMITED`, `success:false` → `BAD_RESPONSE`.
- No token → `NOT_CONFIGURED` (ADR-C04).

## Context (anchors)
- `src/lib/transport/http.ts` — C01 `fetchJson`.
- `src/lib/env.server.ts` — add `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS`, `TRAVELPAYOUTS_MARKET`.
- Doc § Endpoints: `departure_at` accepts `YYYY-MM` or `YYYY-MM-DD`; `one_way=true` returns 1 ticket per date group; `link` relative.
- Doc § Gotchas: `currency` field placement inconsistent — trust what we sent.

## Steps
- [ ] `covers(q)`: `modes` empty or has `flight`, and both places have `iata`.
- [ ] `client.ts`: build URL (`origin`, `destination`, `departure_at=q.date`, `one_way=true`, `sorting=price`, `currency`, `market`, `limit=30`), `next: { revalidate: 86400 }`.
- [ ] `map.ts`: `data[]` → `Offer` (`id = travelpayouts:${origin}-${destination}-${departure_at}-${flight_number}`, segment depart = `departure_at`, arrive = depart + `duration_to` min, `carrier = airline`, `number = airline+flight_number`, note `transfers`).
- [ ] Record fixture: real response (token stripped) or doc example → `__fixtures__/prices_for_dates.json`.
- [ ] Tests: maps fixture → expected offers; empty `data` → `[]`; `success:false` → `BAD_RESPONSE`; missing token → `NOT_CONFIGURED`; URL includes `currency` + `market`, excludes `token=`.

## Definition of done
- Live curl HKG→BKK next month returns ≥ 1 offer `kind:"cached"` or empty with no error.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- travelpayouts`

Live (after C02): `pnpm dev`; curl search with `HKG`→`BKK`; expect offers or `[]`, no `travelpayouts` entry in `errors`.

## Notes

