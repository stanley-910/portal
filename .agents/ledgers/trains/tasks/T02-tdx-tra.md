# T02 — TDX TRA adapter
REPO: (this repo) · Depends: T01 · Status: retired
**Retired 2026-10-02 by trains ADR-T04** (no TDX key; dropped, not replaced).
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/taiwan-tdx.md`, then this.
**Model: sonnet** — second mapper on T01 client.

## Goal
Owner's ask:

> "Taiwan High Speed Rail (TDX API) … Free for Trains"

Add conventional rail (TRA) — covers places THSR does not (east coast, Hualien, Taitung).

## Non-negotiables
- v3 wrapper shapes (`Stations`, `TrainTimetables`, `ODFares`) — not v2 bare arrays.
- Reuse T01 client + limiter. One timetable call per (OD, date), cached.
- Station snapshot committed; TRA has ~240 stations — snap within 10 km, prefer `StationClass` major.

## Context (anchors)
- `/v3/Rail/TRA/Station`, `/v3/Rail/TRA/DailyTrainTimetable/OD/{O}/to/{D}/{date}`, `/v3/Rail/TRA/ODFare/{O}/to/{D}`.
- `TrainTypeName` → `carrier` suffix (e.g. "TRA Tze-Chiang").

## Steps
- [ ] Extend snapshot script → `tra-stations.json`.
- [ ] `tra.ts` + dispatch in `index.ts` (THSR and TRA both when both cover; dedupe not needed — different trains).
- [ ] Fixture from first live call (secrets stripped) or doc shape.
- [ ] Tests: wrapper parse; fare by `TrainType` match; Hualien query returns TRA, not THSR.

## Definition of done
- Taipei → Hualien returns TRA offers.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- tdx`

## Notes

