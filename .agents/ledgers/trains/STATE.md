# Trains — State

Last updated: 2026-10-02
Last session ended: **T06 done (2026-10-02).** `tdx` = THSR seed: 181 trains (Taipei↔Zuoying,
week 2026-10-12..18 from thsrc.com.tw), 12 stations, `days` per train, IRS booking link-out.
Next by § 4: T03 (live needs data.go.kr key, see blockers); then T05 (B03 done).

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

**T03 — Korea TAGO client + KTX adapter** (Ahmet). Live calls need data.go.kr key (Open blockers).

## Environment

```bash
# .env.local
DATA_GO_KR_SERVICE_KEY=...                     # data.go.kr, DECODING key
```

## Open blockers / decisions for the user

- **data.go.kr signup = Korean nationals + 본인인증 only.** Need someone with Korean phone/i-PIN to create account and share key. Blocks T03 live + B02. If none: T03 falls back to seed (ADR then).

## Task ledger (T01–T06)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| T01 | TDX OAuth client + THSR adapter | | retired (ADR-T04) | C01 |
| T02 | TDX TRA adapter | | retired (ADR-T04) | T01 |
| T03 | Korea TAGO client + KTX adapter | | todo | C01 |
| T04 | China rail seed + affiliate link-out | | done | C01 |
| T05 | GTFS rail pairs (KTMB, SRT) | | todo | B03 |
| T06 | THSR seed timetable + booking link-out | | done | C01 |

## Critical path

C01 → T06 · C01 → T03 · B03 → T05.

## Cross-ledger (this ledger blocks)

| Task | Provides | Consumed by |
|---|---|---|
| T03 | `providers/korea-tago/client.ts` | buses B02 |

## Backlog

- **TDX live (THSR fares/seat flags, TRA, Taiwan buses)** — trigger: a TDX member key exists (Taiwan phone or manual review approved). Then supersede ADR-T04; T01/T02/B01 files hold the old plan.
- **THSR seat flags** in Offer (`AvailableSeatStatus`, cache 5 min) — trigger: TDX key + UI wants "seats left" badge; needs additive optional field (core ADR).
- **Google Routes TRANSIT** (paid) — trigger: judges want coverage outside TW/KR/TH/MY.
