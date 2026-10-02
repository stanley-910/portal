# Trains — State

Last updated: 2026-10-02
Last session ended: **T05 done (2026-10-02).** `gtfs` now trains too: KTMB feed (ETS/Intercity/ST, 163
departures, KL→Penang 11, JB↔SG via Woodlands pin). Namtang SRT = placeholder times → 0 legs (doc patched).
Build: stop nearest city centre per visit, 300 km/h cap. KTMB calendar ends 20261015 → rebuild before demo.
Next by § 4: T03 (live needs data.go.kr key, see blockers).

## Execution protocol (follow exactly)

`.agents/EXECUTE.md` § 4 picks the task. This file → `REFERENCE.md` once → task file →
`MODELS.md` tier → work → Verification verbatim → `## Notes` → update row/pointer/"Last session
ended" → devlog → commit + push + PR (EXECUTE § 10) → stop.

## Current task

**T03 — Korea KTX seed adapter** (Ahmet). Keyless — hand-curated seed (ADR-T05).

## Environment

```bash
# .env — nothing needed for trains MVP. TDX + Korea are committed seed (ADR-T04, ADR-T05).
# TDX_CLIENT_* / DATA_GO_KR_SERVICE_KEY stay optional in the schema (core ADR-C04), unused.
```

## Open blockers / decisions for the user

None. TDX and data.go.kr signups dropped 2026-10-02 (ADR-T04, ADR-T05); Trip.com affiliate not signing up (T04 ships untagged).

## Task ledger (T01–T06)

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| T01 | TDX OAuth client + THSR adapter | | retired (ADR-T04) | C01 |
| T02 | TDX TRA adapter | | retired (ADR-T04) | T01 |
| T03 | Korea KTX seed adapter | | todo | C01 |
| T04 | China rail seed + affiliate link-out | | done | C01 |
| T05 | GTFS rail pairs (KTMB, SRT) | | done | B03 |
| T06 | THSR seed timetable + booking link-out | | done | C01 |

## Critical path

C01 → T06 · C01 → T03 · B03 → T05.

## Cross-ledger (this ledger blocks)

| Task | Provides | Consumed by |
|---|---|---|
| T03 | `providers/korea-tago/` folder, `index.ts` dispatch, `seed.ts` loader | buses B02 |

## Backlog

- **TDX live (THSR fares/seat flags, TRA, Taiwan buses)** — trigger: a TDX member key exists (Taiwan phone or manual review approved). Then supersede ADR-T04; T01/T02/B01 files hold the old plan.
- **THSR seat flags** in Offer (`AvailableSeatStatus`, cache 5 min) — trigger: TDX key + UI wants "seats left" badge; needs additive optional field (core ADR).
- **SRT intercity timetable** (namtang times are placeholders, T05 Notes) — trigger: judges want BKK↔CNX/Hat Yai trains; seed from railway.co.th like T04/T06.
- **Live TAGO client** (`TrainInfo`, Decoding key, `_type=json`) — trigger: data.go.kr key obtained.
- **Google Routes TRANSIT** (paid) — trigger: judges want coverage outside TW/KR/TH/MY.
