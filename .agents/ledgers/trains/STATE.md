# Trains — State

Last updated: 2026-10-02
Last session ended: **Ledger written (meta session).** No code.

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

**T01 — TDX OAuth client + THSR adapter** (Ahmet, opus). Waits on C01 + TDX key.

## Environment

```bash
# .env.local
TDX_CLIENT_ID=...  TDX_CLIENT_SECRET=...      # tdx.transportdata.tw member → API keys
DATA_GO_KR_SERVICE_KEY=...                     # data.go.kr, DECODING key
```

## Open blockers / decisions for the user

- **TDX signup needs Taiwan phone SMS.** Else email tdx@motc.gov.tw for manual review (time unknown). Ahmet: start day 1. Blocks T01/T02 live Verification + B01.
- **data.go.kr signup = Korean nationals + 본인인증 only.** Need someone with Korean phone/i-PIN to create account and share key. Blocks T03 live + B02. If none: T03 falls back to seed (ADR then).

## Task ledger (T01–T05)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| T01 | TDX OAuth client + THSR adapter | | todo | C01 |
| T02 | TDX TRA adapter | | todo | T01 |
| T03 | Korea TAGO client + KTX adapter | | todo | C01 |
| T04 | China rail seed + affiliate link-out | | todo | C01 |
| T05 | GTFS rail pairs (KTMB, SRT) | | todo | B03 |

## Critical path

C01 → T01 → T02 · C01 → T03 · B03 → T05.

## Cross-ledger (this ledger blocks)

| Task | Provides | Consumed by |
|---|---|---|
| T01 | `providers/tdx/client.ts` token + quota-aware fetch | buses B01 |
| T03 | `providers/korea-tago/client.ts` | buses B02 |

## Backlog

- **THSR seat flags** in Offer (`AvailableSeatStatus`, cache 5 min) — trigger: UI wants "seats left" badge; needs additive optional field (core ADR).
- **TRA live delay** (`StationLiveBoard`) — trigger: demo is same-day.
- **Google Routes TRANSIT** (paid) — trigger: judges want coverage outside TW/KR/TH/MY.
