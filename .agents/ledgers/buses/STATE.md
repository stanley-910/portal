# Buses — State

Last updated: 2026-10-03
Last session ended: **B01 done (2026-10-03, Ahmet).** `tdx` provider now train+bus on `buses` (not yet merged to
`dev/ahmet`): 9 國道客運 routes / 1196 trips, Taipei ↔ Taichung, Kaohsiung, Tainan, Yilan both ways. Times from
TDX guest `Schedule` read once at curation, cross-checked 公路局 (ADR-B08); no fares. Taipei→Taichung bus 72 offers
live. Hand-off: B01 `## Notes`. Next here: B02 (needs T03), B04 (needs S02).

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

- Team: city list for GTFS pairs. Default: Bangkok, Chiang Mai, Phuket, Krabi, Surat Thani, Hat Yai, Pattaya, KL, Penang/Butterworth, Ipoh, JB, Singapore(Woodlands).

## Task ledger (B01–B05)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| B01 | Taiwan intercity bus seed (`tdx` provider) | | done | T06 |
| B02 | Korea express bus seed (`korea-tago` provider) | | todo | T03 |
| B03 | GTFS build pipeline + gtfs adapter | | done | C01 |
| B04 | 12Go bus route seed | | todo | S02 |
| B05 | BusOnlineTicket seed + deep links | | done | C01 |

## Critical path

C01 → B03 → T05 · T03 → B02 · S02 (Cata) → B04.

## Cross-ledger

| Task | Provides | Consumed by |
|---|---|---|
| B03 | `scripts/gtfs-build.mts`, `providers/gtfs/` | trains T05 (rail), ferries backlog (namtang `route_type` 4) |
| ← T06 | `providers/tdx/` THSR seed provider | B01 |
| ← T03 | `providers/korea-tago/` folder + `seed.ts` loader | B02 |
| ← S02 | 12Go adapter + `SeedRoute` | B04 |

## Backlog

- **Namtang fares** (`fare_attributes`/`fare_rules`, THB, 65 MB) — trigger: UI wants bus prices; stream-filter by pair stops at build.

- **Live TDX intercity bus** (stop-pair index from `StopOfRoute` + `Schedule`, old PLAN D2) — trigger: TDX key obtained.
- **Taiwan bus fares** (taiwanbus.tw `TMSQuery` matrix: seat class × time band) — trigger: UI wants bus prices.
- **Live Korea bus** (`ExpBusInfo` + 시외 `SuburbsBusInfo`) — trigger: data.go.kr key obtained.
- **BusOnlineTicket affiliate** — not signing up (2026-10-02); B05 ships untagged, adds `refererid` only if `BOT_REFERER_ID` is set — trigger: owner wants commission.
- **myBAS / Prasarana feeds** — trigger: city-bus legs wanted.
- **Transitland departures** (10k/month, non-commercial) — trigger: live lookups needed outside our feeds.
- **Daily GTFS rebuild GitHub Action** — trigger: data older than 7 days at demo week.
