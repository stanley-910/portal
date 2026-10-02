# B01 — Taiwan intercity bus seed (`tdx` provider)
REPO: (this repo) · Depends: T06 · Status: done
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
- [x] `tdx/bus-terminals.json` + `tdx/bus-seed.json`.
- [x] Bus schema (zod, like `schema.ts`); `bus.ts`: nearest terminal within 10 km, seeded pair only → one `Offer` per departure on `q.date`, ISO `+08:00`.
- [x] `index.ts`: `covers` includes seeded bus pairs; dispatch bus when `q.modes` empty or has `bus`.
- [x] Tests: Taipei→Taichung bus offers; reverse direction; `modes:["train"]` excludes bus; unseeded pair → `covers` false; every row has `source`; no request-time `fetch`.

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

- Done 2026-10-03 (Ahmet). `providers/tdx/`: `bus-terminals.json` (9 terminals), `bus-seed.json` (9 routes, 1196 trips), `bus.ts`, `time.ts` (shared `timeline`/`at`/`runsOn`), schema += `busSeedSchema`/`busTerminalsSchema`, `index.ts` modes `["train","bus"]`.
- Source deviation (ADR-B08): times from TDX guest `Schedule/InterCity/{route}` read once (10 calls, browser UA + Referer), not operator sites — kingbus TLS fails, aloha168 no answer, hohsin/kamalan Cloudflare, ubus no times. Cross-checked taiwanbus.tw `TimeTableAPIByWeek` (1827 identical both ways; 1610A 23 runs both). Curation script not committed (scratch only); re-run = same 10 GETs.
- Shape deviation: trips with terminal stops + `days` (like THSR trains), not `departures[]`+`durationMin` rows — per-run durations differ, one run serves several pairs (7500R: Tainan→Chaoma→Taipei).
- Routes: Ubus 1619/1610/1611, Kuo-Kuang 1827/1878, Ho-Hsin 7513/7500, Kamalan 1915, Capital 1572. Aloha: none (site down, not in 公路局 search). 1917 fetched, not seeded (Luodong, no terminal).
- Terminals: Taipei Bus Station (+ alias 臺北車站(鄭州)), Yuanshan, Nangang, Taipei City Hall, Chaoma, Taichung Station (3 alias stops), Kaohsiung Jianguo, Tainan, Yilan. Coords from taiwanbus.tw `getRData.ashx?type=4`.
- Matching: every terminal ≤ 10 km counts (Taipei has 4); per trip origin/destination = nearest to query point. THSR Tainan (Guiren) is 11 km from Tainan bus terminal → no bus from THSR-Tainan coords.
- No fares: 全票 varies by seat class (三排/四排) + time band (taiwanbus `TMSQuery.aspx?routedata=1610A1`). Backlog.
- `bookingUrl`: Ubus → `booking.ubus.com.tw` (302 = live); others → taiwanbus.tw route page `QueryResult.aspx?rno={route}0` (info, not booking; operator sites unverifiable from here).
- THSR tests: default `modes` now `["train"]` (empty modes also returns buses); "bus excludes" check moved Zuoying → Chiayi (Zuoying is 5.5 km from Kaohsiung bus terminal).
- Verification `pnpm lint && pnpm exec tsc --noEmit && pnpm test -- tdx`: eslint clean, tsc clean, `Test Files 9 passed (9) · Tests 109 passed (109)` (filter ignored, full suite). First run of new tests: 9 red (before `bus.ts`).
- Live: `next dev -p 3001`, `/api/transport/search` Taipei→Taichung `modes=bus` date 2026-10-14 → 72 `tdx` offers (Ubus 1619 ×33, Ho-Hsin 7500 ×28, Kuo-Kuang 1827 ×11); Yilan→Taipei → 49 (1878, 1915, 1572).

