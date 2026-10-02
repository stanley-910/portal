# Core — State

Last updated: 2026-10-02
Last session ended: **C02 done (2026-10-02, Ahmet, on owner's request — Cata's seat).** Search route
`/api/transport/search` + `fanOut` + `parseSearchQuery` on `dev/ahmet`; ADR-C06 (query shape),
ADR-C07 (race, no retries). Core ledger complete. Hand-off: C02 `## Notes`.

## Execution protocol (follow exactly)

Do not start here. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task. Then: this file →
`REFERENCE.md` once → only your task file → `MODELS.md` tier → work, tick steps → Verification
verbatim → `## Notes` → update row, "Current task", "Last session ended" → devlog → commit + push + PR
(EXECUTE § 10) → stop.

## Current task

**None — core complete.** Next work lives in `F/S/T/B` ledgers (EXECUTE § 4).

## Environment

```bash
pnpm install
cp .env.example .env         # after C01; fill keys per .agents/SETUP.md
```

## Open blockers / decisions for the user

None.

## Task ledger (C01–C02)

Statuses: todo → in_progress → done → (blocked) · retired = dropped, ID kept.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| C01 | Contract, stub registry, vitest, env schema | | done | — |
| C02 | `/api/transport/search` fan-out route | | done | C01 |

## Critical path

C01 → C02 → (all adapters already unblocked by C01; C02 only needed for end-to-end curl).

## Cross-ledger (this ledger blocks)

| Task | Provides | Consumed by |
|---|---|---|
| C01 | `types.ts`, `registry.ts`, stubs, `http.ts`, `env.server.ts`, vitest | every `F/S/T/B` task |
| C02 | `fanOut`, search route | every adapter's live Verification curl |

## Backlog

- **Multi-leg composition** (e.g. flight + ferry) — trigger: UI asks for door-to-door.
- **Place resolver service** (city → station ids for every provider) — trigger: ≥ 3 adapters duplicate nearest-station logic.
- **Response cache (Supabase/KV)** — trigger: a provider quota is hit in testing.
