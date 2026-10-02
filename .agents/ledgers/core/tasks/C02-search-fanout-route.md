# C02 — `/api/transport/search` fan-out route
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: sonnet** — mechanical fan-out over C01's contract; invariant is a timeout + allSettled.

## Goal
Owner's ask:

> "we will implement these apis to our system"

One GET route that parses a query, fans out to covering providers in parallel, merges offers,
reports per-provider errors. Adapters (`F/S/T/B`) plug in without touching this file.

## Non-negotiables
- One provider throwing, hanging or rate-limited never fails the request (core PLAN invariant).
- Per-provider timeout via `AbortSignal.timeout(PROVIDER_TIMEOUT_MS)`, default 8000; total under Vercel `maxDuration`.
- HTTP 400 + `{ code: "BAD_QUERY" }` only for invalid query. Otherwise 200.
- No caching decision here beyond `Cache-Control: no-store` default; adapters own provider caching.

## Context (anchors)
- `src/lib/transport/registry.ts` — C01. `providers`.
- `src/lib/transport/types.ts` — C01. `SearchQuery`, `ProviderFailure`.
- Next docs: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `.../route-segment-config/maxDuration.md`.
- Query shape: `from`/`to` as `lat,lng,name[,iata]`? Pick one, write ADR-C06. Simplest: `fromLat,fromLng,fromName,fromIata?` etc. Zod-parse.

## Steps
- [ ] ADR-C06: query-string shape for `Place`.
- [ ] `src/lib/transport/search.ts` `fanOut(q): Promise<{offers, errors, tookMs}>` — filter `covers`, `Promise.allSettled`, map `ProviderFailure` → `ProviderError`, unknown throw → `UPSTREAM_ERROR`, sort offers by depart.
- [ ] `src/app/api/transport/search/route.ts` GET, `runtime = "nodejs"`, zod parse → `fanOut`.
- [ ] Tests (`search.test.ts`, fake providers): one ok + one throws + one hangs → 200 shape with 1 offer source, 2 errors, hang → `TIMEOUT`; `modes` filter skips non-matching providers; no covering provider → empty offers, empty errors.

## Definition of done
- With only stubs: curl returns 200, `offers: []`, `errors` = every covering provider `NOT_CONFIGURED`.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test`

Live: `pnpm dev`, then curl one HKG→TPE query (shape per ADR-C06); expect 200 and `NOT_CONFIGURED` errors only.

## Notes

