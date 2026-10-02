# C01 — Contract, stub registry, vitest, env schema
REPO: (this repo) · Depends: — · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: opus** — contract both seats freeze against; a wrong shape costs eight adapters.

## Goal
Owner's ask:

> "we will implement these apis to our system my friend will handle flight ferry i will do the other two"

This task makes the parallel split safe: lands the contract, every provider stub, the test
runner and the env schema so `F/S/T/B` tasks touch only their own `providers/<id>/` folder.
`C02` (Cata) builds the fan-out route on top.

## Non-negotiables
- `types.ts` matches core `PLAN.md` § Contract exactly. Deviation = new ADR-C first.
- Every `ProviderId` registered with stub throwing `ProviderFailure("NOT_CONFIGURED")`.
- All env vars optional (ADR-C04). App boots with empty `.env`.
- Provider modules and `env.server.ts` import `server-only` — client import must fail build.

## Context (anchors)
- `package.json` — no `test` script, no vitest. Add both.
- `.gitignore` — `.env*` swallows `.env.example`; add `!.env.example`.
- `tsconfig.json` — check `@/*` alias for vitest resolution (`vite-tsconfig-paths` or `resolve.alias`).
- Env var names: each `.agents/docs/api/*.md` § Access lists them. Collect all into schema + `.env.example`.

## Steps
- [x] `pnpm add server-only` · `pnpm add -D vitest` · add `"test": "vitest run"`.
- [x] `vitest.config.ts` with `@` alias.
- [x] `src/lib/transport/types.ts` from PLAN § Contract.
- [x] `src/lib/transport/http.ts`: `fetchJson`/`fetchText` mapping 401/403→`AUTH_FAILED`, 429→`RATE_LIMITED` (retryable), 5xx→`UPSTREAM_ERROR` (retryable), abort→`TIMEOUT`, parse fail→`BAD_RESPONSE`.
- [x] `src/lib/env.server.ts` zod schema, every var from docs optional; export `env`.
- [x] `.env.example` with every var, empty. `.gitignore` `!.env.example`.
- [x] `src/lib/transport/providers/<id>/index.ts` stub for every `ProviderId` (7); `registry.ts` exports them.
- [x] Tests: `http.test.ts` (each status → code, abort → TIMEOUT, using mocked `fetch`); `registry.test.ts` (every `ProviderId` registered once; stub `search` rejects `NOT_CONFIGURED`).

## Definition of done
- `pnpm test` green; `pnpm lint && pnpm exec tsc --noEmit` clean.
- `pnpm dev` boots with no `.env`.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test`

## Notes

- `http.ts`: `fetchJson(url, init)` / `fetchText(url, init)`; `init` = `RequestInit` + required `signal` (POST ok, e.g. TDX token). `fetchJson` returns `unknown` — zod-parse in adapter.
- Status map: 401/403 `AUTH_FAILED`; 429 `RATE_LIMITED`↻; ≥500 `UPSTREAM_ERROR`↻; other non-2xx `UPSTREAM_ERROR`; abort/timeout `TIMEOUT`↻; network `UPSTREAM_ERROR`↻; bad JSON `BAD_RESPONSE`. ↻ = retryable. No retries inside — retry policy is C02's one place.
- Stubs: `providers/stub.ts` → `stubProvider(id, modes)`; `covers` = mode match only (so C02 curl shows each stub as `NOT_CONFIGURED`, proves wiring). Adapter replaces `providers/<id>/index.ts` with its own `export default` provider; may reuse `servesModes` from `../stub`.
- Stub modes: travelpayouts flight · 12go ferry,bus · tdx train,bus · korea-tago train,bus · china-rail train · busonlineticket bus · gtfs train,bus.
- `env.server.ts`: `env` (parsed once), `parseEnv(source)` for tests. Blank strings = unset. Append vars here + `.env.example`.
- `server-only` aliased to its `empty.js` in `vitest.config.mts`; tests import server modules freely.
- Fresh worktree: `pnpm exec next typegen` before `tsc` (`LayoutProps` lives in `.next/types`).
- Not in schema: `GOOGLE_MAPS_API_KEY` (Rome2Rio fallback, backlog only per ADR-T03).
