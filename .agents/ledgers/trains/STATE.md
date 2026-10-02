# Trains — State

Last updated: 2026-10-03
Last session ended: **T07 done (2026-10-03).** `srt` = SRT Thai rail seed, 124 trains / 36 stations on
Northern, Northeastern, Southern lines from SRT TTS timetable pages (real data, per-train `source`),
running days + type from SRT `timetable_data.js`. D-Ticket home link-out (no deep link), no fares.
`pnpm srt:snapshot` re-snapshots. Bangkok → Chiang Mai live: 5 offers, no errors. Next by § 4: none —
trains ledger empty except Backlog.

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

None — all trains tasks done/retired. Last: T07 (SRT seed).

## Environment

```bash
# .env — nothing needed for trains MVP. TDX + Korea + SRT are committed seed (ADR-T04, ADR-T05, ADR-T06).
# TDX_CLIENT_* / DATA_GO_KR_SERVICE_KEY stay optional in the schema (core ADR-C04), unused.
```

## Open blockers / decisions for the user

None. TDX and data.go.kr signups dropped 2026-10-02 (ADR-T04, ADR-T05); Trip.com affiliate not signing up (T04 ships untagged).

## Task ledger (T01–T07)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| T01 | TDX OAuth client + THSR adapter | | retired (ADR-T04) | C01 |
| T02 | TDX TRA adapter | | retired (ADR-T04) | T01 |
| T03 | Korea KTX seed adapter | | done | C01 |
| T04 | China rail seed + affiliate link-out | | done | C01 |
| T05 | GTFS rail pairs (KTMB, SRT) | | done | B03 |
| T06 | THSR seed timetable + booking link-out | | done | C01 |
| T07 | SRT (Thai rail) seed timetable + booking link-out | | done | C01 |

## Critical path

C01 → T06 · C01 → T03 · B03 → T05 · C01 → T07.

## Cross-ledger (this ledger blocks)

| Task | Provides | Consumed by |
|---|---|---|
| T03 | `providers/korea-tago/` folder, `index.ts` dispatch, `seed.ts` loader | buses B02 |

## Backlog

- **TDX live (THSR fares/seat flags, TRA, Taiwan buses)** — trigger: a TDX member key exists (Taiwan phone or manual review approved). Then supersede ADR-T04; T01/T02/B01 files hold the old plan.
- **THSR seat flags** in Offer (`AvailableSeatStatus`, cache 5 min) — trigger: TDX key + UI wants "seats left" badge; needs additive optional field (core ADR).
- **Live TAGO client** (`TrainInfo`, Decoding key, `_type=json`) — trigger: data.go.kr key obtained.
- **SRT Eastern / Thon Buri lines, fares, holiday calendar** — trigger: demo needs Bangkok → Aranyaprathet/Kanchanaburi or prices. Same TTS page (line 3/7); fares only via Turnstile-gated pages (`srt.md`).
- **Google Routes TRANSIT** (paid) — trigger: judges want coverage outside TW/KR/TH/MY.
