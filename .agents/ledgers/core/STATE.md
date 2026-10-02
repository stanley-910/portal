# Core — State

Last updated: 2026-10-02
Last session ended: **C01 done (2026-10-02, Ahmet).** Contract, 7 stubs, `http.ts`, `env.server.ts`,
vitest (34 tests) landed on `dev/ahmet`. Every `F/S/T/B` task + C02 now eligible. Hand-off: C01 `## Notes`.

## Execution protocol (follow exactly)

Do not start here. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task. Then: this file →
`REFERENCE.md` once → only your task file → `MODELS.md` tier → work, tick steps → Verification
verbatim → `## Notes` → update row, "Current task", "Last session ended" → devlog → commit + push + PR
(EXECUTE § 10) → stop.

## Current task

**C02 — `/api/transport/search` fan-out route** (Cata, sonnet). Adapters parallel alongside.

## Environment

```bash
pnpm install
cp .env.example .env.local   # after C01; fill keys per .agents/SETUP.md
```

## Open blockers / decisions for the user

None.

## Task ledger (C01–C02)

Statuses: todo → in_progress → done → (blocked) · retired = dropped, ID kept.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| C01 | Contract, stub registry, vitest, env schema | | done | — |
| C02 | `/api/transport/search` fan-out route | | todo | C01 |

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
