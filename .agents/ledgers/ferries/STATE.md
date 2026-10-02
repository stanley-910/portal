# Ferries — State

Last updated: 2026-10-02
Last session ended: **S01 and S02 implemented.** 12Go deep links, generic seed adapter,
and ten curated ferry routes landed. Verification: `pnpm lint`, `pnpm exec tsc --noEmit`,
`pnpm test -- 12go` (8 passed).

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

**B04 — bus 12Go seed** (next; buses ledger).

## Environment

```bash
# .env.local — one of:
TRAVELPAYOUTS_MARKER=...      # TP 12Go program (join in TP dashboard)
TWELVEGO_AFFILIATE_ID=...     # direct agent.12go.asia program
```

## Open blockers / decisions for the user

- Cata: apply to 12Go affiliate program (TP Programs → 12Go, or agent.12go.asia) day 1; review may decline low-traffic sites. Fallback: untagged links. Unblocks commission only, not S01/S02.
- Team: pick seed coverage (which ferry routes). Default: Thailand gulf + Andaman islands, HK–Macau, Bali–Lombok/Gili. Needed by S02.

## Task ledger (S01–S02)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| S01 | 12Go route deep links + affiliate tag | | done | C01, F03 |
| S02 | Generic 12Go seed adapter + ferry route seed | | done | S01 |

## Critical path

C01 → F03 → S01 → S02 → (buses B-ledger 12Go bus seed).

## Cross-ledger (this ledger blocks)

| Task | Provides | Consumed by |
|---|---|---|
| S02 | `providers/12go/index.ts`, `match.ts`, `SeedRoute` shape, `links.ts` | buses `B04` (bus seed) |

## Backlog

- **Email 12Go for API** (affiliate@12go.asia) — trigger: demo traction; terms confidential, never commit their docs.
- **GTFS ferry feeds** (e.g. HK ferry operators) via buses `gtfs` pipeline — trigger: B05 lands and a ferry feed exists.
