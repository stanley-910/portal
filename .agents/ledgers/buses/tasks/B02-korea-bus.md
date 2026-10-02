# B02 — Korea express bus seed (`korea-tago` provider)
REPO: (this repo) · Depends: T03 · Status: todo
Read first: STATE.md, REFERENCE.md, ADR-B07, then this.
**Model: sonnet** — hand-curated data + mapper on T03's seed loader.

## Goal
Owner's ask:

> "data.go.kr … Free for Buses"

> "what other apis do i need and those i need to sign lets mock datas for those" (2026-10-02)

No data.go.kr key (ADR-B07). Express (고속) bus offers for any date from a hand-curated KoBus
seed. Intercity (시외) dropped.

## Non-negotiables
- Zero request-time network calls. No `ExpBusInfo` / `SuburbsBusInfo`, no 시외 path.
- Seed rows per core ADR-C05: `departures` `HH:MM`, `tz: "Asia/Seoul"`, `durationMin`, grade (`carrier`, e.g. "Express Premium"), fare KRW, `source` (KoBus timetable page URL + date read).
- `kind: "timetable"`, `mode: "bus"`.

## Context (anchors)
- Default pairs, both directions: Seoul Express Bus Terminal–Busan, –Daegu (Dongdaegu), –Gwangju (U-Square), –Daejeon.
- Terminal coords hand-entered with `source`.
- T03 `seed.ts` loader + `index.ts` dispatch.
- Trap: shares `providers/korea-tago/index.ts`, `seed.ts`, `korea-tago.test.ts` with T03 (dependency, done first).

## Steps
- [ ] `korea-tago/bus-terminals.json` + `korea-tago/bus-seed.json`.
- [ ] Extend `seed.ts`; `bus.ts`: nearest terminal within 10 km, seeded pair only → one `Offer` per departure on `q.date`, ISO `+09:00`, KRW price.
- [ ] `index.ts`: `covers` includes seeded bus pairs; dispatch bus when `q.modes` empty or has `bus`.
- [ ] Tests: Seoul→Busan bus offers any date (not only today); reverse direction; `modes:["train"]` excludes bus; unseeded pair → `covers` false; no request-time `fetch`.

## Files touched
- `src/lib/transport/providers/korea-tago/index.ts`, `seed.ts`, `korea-tago.test.ts`
- `src/lib/transport/providers/korea-tago/bus.ts` (new)
- `src/lib/transport/providers/korea-tago/bus-terminals.json`, `bus-seed.json` (new)

## Definition of done
- Seoul (Express Bus Terminal) → Busan tomorrow returns express bus offers with KRW fares.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- korea-tago`

Seed (after C02, empty `.env`): curl `/api/transport/search` Seoul Express Bus Terminal 37.5049,127.0050 → Busan (query shape per C02), modes bus; expect `korea-tago` bus offers.

## Notes

