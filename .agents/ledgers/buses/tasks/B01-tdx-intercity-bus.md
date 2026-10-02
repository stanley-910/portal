# B01 — Taiwan intercity bus seed (`tdx` provider)
REPO: (this repo) · Depends: T06 · Status: todo
Read first: STATE.md, REFERENCE.md, ADR-B07, then this.
**Model: sonnet** — hand-curated data + mapper beside T06's THSR seed.

## Goal
Owner's ask:

> "TDX Bus API … Free for Buses"

> "what other apis do i need and those i need to sign lets mock datas for those" (2026-10-02)

No TDX key (ADR-B07). Serve 國道客運 offers for demo pairs from a hand-curated seed in the
`tdx` provider folder.

## Non-negotiables
- Zero request-time network calls. No stop-pair index, no TDX bus endpoints, no snapshot crawl.
- Seed rows per core ADR-C05: `departures` `HH:MM`, `tz: "Asia/Taipei"`, `durationMin`, operator (`carrier`), route number if published, fare TWD if published, `source` (operator timetable page URL + date read). No times known → row not seeded.
- `kind: "timetable"`, `mode: "bus"`.

## Context (anchors)
- Default pairs, both directions: Taipei–Taichung, Taipei–Kaohsiung, Taipei–Tainan, Taipei–Yilan. Sources: Kuo-Kuang, Ubus, Aloha, Ho-Hsin operator sites.
- Terminal coords hand-entered with `source` (Taipei Bus Station, Taichung Chaoma, Kaohsiung, Tainan, Yilan Zhuanyun).
- T06 built `providers/tdx/` (`index.ts`, `schema.ts`, `seed.json`, `links.ts`, `index.test.ts`) as THSR-only, modes `["train"]`. Read it first; add bus beside it, keep THSR behaviour and tests green.
- Trap: shares `providers/tdx/index.ts` and `index.test.ts` with trains (T02 retired, so no parallel conflict).

## Steps
- [ ] `tdx/bus-terminals.json` + `tdx/bus-seed.json`.
- [ ] Bus schema (zod, like `schema.ts`); `bus.ts`: nearest terminal within 10 km, seeded pair only → one `Offer` per departure on `q.date`, ISO `+08:00`.
- [ ] `index.ts`: `covers` includes seeded bus pairs; dispatch bus when `q.modes` empty or has `bus`.
- [ ] Tests: Taipei→Taichung bus offers; reverse direction; `modes:["train"]` excludes bus; unseeded pair → `covers` false; every row has `source`; no request-time `fetch`.

## Files touched
- `src/lib/transport/providers/tdx/index.ts`, `index.test.ts`, `schema.ts`
- `src/lib/transport/providers/tdx/bus.ts` (new)
- `src/lib/transport/providers/tdx/bus-terminals.json`, `bus-seed.json` (new)

## Definition of done
- Taipei → Taichung, any date, returns 國道客運 timetable offers.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- tdx`

Seed (after C02, empty `.env`): curl `/api/transport/search` Taipei → Taichung, modes bus (query shape per C02); expect `tdx` bus offers.

## Notes

