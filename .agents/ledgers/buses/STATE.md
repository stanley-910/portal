# Buses — State

Last updated: 2026-10-02
Last session ended: **B05 done (2026-10-02, Ahmet).** `busonlineticket` adapter on `buses` (not yet merged to
`dev/ahmet`): 22 MY/SG/TH pairs, first/last bus of top-5 operators per pair (ADR-B06), route-page
links, `refererid` only if `BOT_REFERER_ID`. KL→SG 10 offers live. Hand-off: B05 `## Notes`.
Next here: B02 (needs T03 + Korean account), B04 (needs S02).

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

None eligible in buses: B02 waits on T03, B04 on S02 (Cata). § 4 decides.

## Environment

```bash
pnpm gtfs:build          # cached zip < 24 h reused; --fresh re-downloads; writes providers/gtfs/pairs/ + meta.json
```

## Open blockers / decisions for the user

- Korean account blocks B02 live. (B01 retired — no TDX key, trains ADR-T04.)
- Ahmet: apply to BusOnlineTicket affiliate (needs live website URL — use Vercel deploy). Commission only; B05 shipped untagged — set `BOT_REFERER_ID` once approved, no code change.
- Team: city list for GTFS pairs. Default: Bangkok, Chiang Mai, Phuket, Krabi, Surat Thani, Hat Yai, Pattaya, KL, Penang/Butterworth, Ipoh, JB, Singapore(Woodlands).

## Task ledger (B01–B05)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| B01 | TDX intercity bus via stop-pair index | | retired (trains ADR-T04) | T01 |
| B02 | Korea express + intercity bus | | todo | T03 |
| B03 | GTFS build pipeline + gtfs adapter | | done | C01 |
| B04 | 12Go bus route seed | | todo | S02 |
| B05 | BusOnlineTicket seed + deep links | | done | C01 |

## Critical path

C01 → B03 → T05 · T03 → B02 · S02 (Cata) → B04.

## Cross-ledger

| Task | Provides | Consumed by |
|---|---|---|
| B03 | `scripts/gtfs-build.mts`, `providers/gtfs/` | trains T05 (rail), ferries backlog (namtang `route_type` 4) |
| ← T03 | TAGO client | B02 |
| ← S02 | 12Go adapter + `SeedRoute` | B04 |

## Backlog

- **Namtang fares** (`fare_attributes`/`fare_rules`, THB, 65 MB) — trigger: UI wants bus prices; stream-filter by pair stops at build.

- **myBAS / Prasarana feeds** — trigger: city-bus legs wanted.
- **Transitland departures** (10k/month, non-commercial) — trigger: live lookups needed outside our feeds.
- **Daily GTFS rebuild GitHub Action** — trigger: data older than 7 days at demo week.
