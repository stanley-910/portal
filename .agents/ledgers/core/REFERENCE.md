# Core — REFERENCE (shared orientation for every transport ledger)

Verified against repo at `6a97255` (2026-10-02). Other ledgers' `REFERENCE.md` point here and
add only provider specifics. Reality diverges → trust code, patch this file.

## Stack

| Thing | Value |
|---|---|
| Framework | Next.js `16.3.8`, App Router, `src/` dir. **Not the Next you know** — read `node_modules/next/dist/docs/` first (AGENTS.md) |
| React | 19.2.8 |
| Package manager | pnpm 11 (`packageManager` in `package.json`); needs Node ≥ 22.13 |
| Validation | zod 4 (already a dep) |
| Tests | vitest 5, `vitest.config.mts`, `src/**/*.test.ts`, node env |
| Deploy | Vercel Hobby (limits: `docs/research/free-tiers.md`) |
| Branch | `main` |

## Commands

```bash
pnpm install
pnpm dev                      # runs scripts/tokens.mts then next dev on :3000
pnpm lint
pnpm exec tsc --noEmit
pnpm test                     # after C01
curl -s 'localhost:3000/api/transport/search?fromName=..&fromLat=..&fromLng=..&toName=..&toLat=..&toLng=..&date=YYYY-MM-DD' | jq   # ADR-C06
```

## Next 16 docs to read before route work

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — GET is dynamic by default (since v15)
- `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` — `use cache` needs Cache Components config; not enabled in `next.config.ts` today
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/{runtime,maxDuration,preferredRegion}.md`

## Files (after C01/C02 land)

| Path | Owner task | What |
|---|---|---|
| `src/lib/transport/types.ts` | C01 only | contract (core PLAN.md § Contract) |
| `src/lib/transport/registry.ts` | C01 only | `providers: TransportProvider[]`, all ids pre-registered |
| `src/lib/transport/providers/<id>/index.ts` | adapter tasks | one per `ProviderId`; stub until its task lands |
| `src/lib/transport/providers/<id>/__fixtures__/` | adapter tasks | recorded responses, secrets stripped |
| `src/lib/transport/providers/<id>/*.test.ts` | adapter tasks | vitest, fixture-only |
| `src/lib/transport/http.ts` | C01 | `fetchJson/fetchText(url, {signal, headers})` → throws `ProviderFailure` on 401/403/429/5xx/parse |
| `src/lib/transport/search.ts` | C02 | `fanOut(q)` |
| `src/lib/transport/query.ts` | C02 | `parseSearchQuery` (ADR-C06) |
| `src/lib/env.server.ts` | C01 (vars added by adapter tasks, append-only) | zod schema, all optional |
| `src/app/api/transport/search/route.ts` | C02 | GET handler |
| `.env.example` | C01 (append-only) | every env var, empty values |

## Existing code worth knowing

- `src/components/trip-globe/airports.ts` — `Airport {code, city, lat, lng, weight}`, mock hubs; POR-6 replaces with static dataset. Good `Place` source for flights (`iata`).
- `scripts/tokens.mts` — runs under plain `node` (type stripping). Same trick works for smoke scripts.
- `.gitignore` ignores `.env*` — C01 adds `!.env.example`.

## Conventions

- Route handlers return `{ offers, errors, tookMs }`; HTTP 200 even with provider errors. 400 only for bad query.
- No display strings from API. `ProviderErrorCode` only.
- Times: ISO 8601 with offset. Never naive local strings in `Segment`.
- Money: `amount` number in major units + ISO 4217 `currency`. No FX conversion in adapters.
- Logs: `console.warn({ provider, code, ms }, "PROVIDER_FAILED")` shape; never log keys or full URLs containing keys.
- Fixtures: strip tokens, cookies, personal data before commit.
