# Buses — State

Last updated: 2026-10-02
Last session ended: **Ledger written (meta session).** No code.

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

**B03 — GTFS build pipeline** (Ahmet, opus) is the keyless start; § 4 order may hand T-tasks first.

## Environment

```bash
pnpm gtfs:build          # after B03; downloads to .cache/gtfs/, writes providers/gtfs/pairs/
```

## Open blockers / decisions for the user

- TDX key (see trains STATE) blocks B01 live. Korean account blocks B02 live.
- Ahmet: apply to BusOnlineTicket affiliate (needs live website URL — use Vercel deploy). Commission only; B05 ships untagged otherwise.
- Team: city list for GTFS pairs. Default: Bangkok, Chiang Mai, Phuket, Krabi, Surat Thani, Hat Yai, Pattaya, KL, Penang/Butterworth, Ipoh, JB, Singapore(Woodlands).

## Task ledger (B01–B05)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| B01 | TDX intercity bus via stop-pair index | | todo | T01 |
| B02 | Korea express + intercity bus | | todo | T03 |
| B03 | GTFS build pipeline + gtfs adapter | | todo | C01 |
| B04 | 12Go bus route seed | | todo | S02 |
| B05 | BusOnlineTicket seed + deep links | | todo | C01 |

## Critical path

C01 → B03 → T05 · T01 → B01 · T03 → B02 · S02 (Cata) → B04.

## Cross-ledger

| Task | Provides | Consumed by |
|---|---|---|
| B03 | `scripts/gtfs-build.mts`, `providers/gtfs/` | trains T05 (rail), ferries backlog (namtang `route_type` 4) |
| ← T01 | TDX client | B01 |
| ← T03 | TAGO client | B02 |
| ← S02 | 12Go adapter + `SeedRoute` | B04 |

## Backlog

- **myBAS / Prasarana feeds** — trigger: city-bus legs wanted.
- **Transitland departures** (10k/month, non-commercial) — trigger: live lookups needed outside our feeds.
- **Daily GTFS rebuild GitHub Action** — trigger: data older than 7 days at demo week.
