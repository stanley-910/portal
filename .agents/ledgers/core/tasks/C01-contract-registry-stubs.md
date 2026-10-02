# C01 — Contract, stub registry, vitest, env schema
REPO: (this repo) · Depends: — · Status: todo
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
- All env vars optional (ADR-C04). App boots with empty `.env.local`.
- Provider modules and `env.server.ts` import `server-only` — client import must fail build.

## Context (anchors)
- `package.json` — no `test` script, no vitest. Add both.
- `.gitignore` — `.env*` swallows `.env.example`; add `!.env.example`.
- `tsconfig.json` — check `@/*` alias for vitest resolution (`vite-tsconfig-paths` or `resolve.alias`).
- Env var names: each `.agents/docs/api/*.md` § Access lists them. Collect all into schema + `.env.example`.

## Steps
- [ ] `pnpm add server-only` · `pnpm add -D vitest` · add `"test": "vitest run"`.
- [ ] `vitest.config.ts` with `@` alias.
- [ ] `src/lib/transport/types.ts` from PLAN § Contract.
- [ ] `src/lib/transport/http.ts`: `fetchJson`/`fetchText` mapping 401/403→`AUTH_FAILED`, 429→`RATE_LIMITED` (retryable), 5xx→`UPSTREAM_ERROR` (retryable), abort→`TIMEOUT`, parse fail→`BAD_RESPONSE`.
- [ ] `src/lib/env.server.ts` zod schema, every var from docs optional; export `env`.
- [ ] `.env.example` with every var, empty. `.gitignore` `!.env.example`.
- [ ] `src/lib/transport/providers/<id>/index.ts` stub for every `ProviderId` (7); `registry.ts` exports them.
- [ ] Tests: `http.test.ts` (each status → code, abort → TIMEOUT, using mocked `fetch`); `registry.test.ts` (every `ProviderId` registered once; stub `search` rejects `NOT_CONFIGURED`).

## Definition of done
- `pnpm test` green; `pnpm lint && pnpm exec tsc --noEmit` clean.
- `pnpm dev` boots with no `.env.local`.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test`

## Notes

