# Flights — State

Last updated: 2026-10-02
Last session ended: **Ledger written (meta session).** No code. Doc: `docs/api/travelpayouts.md`.

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

**F01 — Travelpayouts adapter** (Cata, sonnet). Waits on C01.

## Environment

```bash
# .env.local
TRAVELPAYOUTS_TOKEN=...   # app.travelpayouts.com/profile/api-token
TRAVELPAYOUTS_MARKER=...
```

## Open blockers / decisions for the user

- Cata: create Travelpayouts account, copy token + marker (SETUP.md § Travelpayouts). Unblocks F01 live Verification.

## Task ledger (F01–F03)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| F01 | Travelpayouts `prices_for_dates` adapter | | todo | C01 |
| F02 | Place → IATA resolver from airports/cities snapshot | | todo | F01 |
| F03 | Aviasales deep links with marker | | todo | F01 |

## Critical path

C01 → F01 → {F02, F03}.

## Cross-ledger

| Task | Provides | Consumed by |
|---|---|---|
| F03 | `TRAVELPAYOUTS_MARKER` link helper pattern | ferries S01 (TP-tracked 12Go links reuse same marker) |

## Backlog

- **Price calendar** (`v3/grouped_prices`) — trigger: UI wants cheapest-day strip.
- **Airline logos** (`pics.avs.io/{w}/{h}/{IATA}.png`) — trigger: ticket UI shows carrier.
- **Nearby airports** (`v2/prices/nearest-places-matrix`) — trigger: empty results common in testing.
