# T05 — GTFS rail pairs (KTMB, SRT)
REPO: (this repo) · Depends: B03 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/gtfs.md`, then this.
**Model: sonnet** — filter over B03 pipeline.

## Goal
Owner's ask:

> "we will implement these apis to our system … i will do the other two"

B03 builds the GTFS pair pipeline for buses. Extend it to rail (`route_type` 2): KTMB ETS/
Intercity (MY↔SG shuttle) and SRT from Thai namtang feed.

## Non-negotiables
- Same build-time pipeline; no runtime zip parsing.
- `Segment.mode = "train"` for `route_type` 2; operator from `agency_name`.
- KTMB calendar end date checked at build (fails loudly if past).

## Context (anchors)
- B03 `scripts/gtfs-build.mts`, `providers/gtfs/` (B03 Notes say exact names).

## Steps
- [ ] Include `route_type` 2 in build filter; tag mode.
- [ ] Tests: KL Sentral → Butterworth/Padang Besar pair returns ETS; Bangkok → Chiang Mai returns SRT + buses.

## Definition of done
- KL → Penang (Butterworth) returns train offers.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- gtfs`

## Notes

