---
task: B01
author: Ahmet
sessions: [2026-10-02, 2026-10-03]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 2
tools: [superpowers:test-driven-development, WebSearch, claude-in-chrome (one aborted attempt)]
---

## Session 1 — 2026-10-02 → 2026-10-03 (one run, resumed once after a rate-limit stop)

### What I asked for / what came back
Execute B01 in `portal-buses` (no push/PR/merge; tier check skipped). Came back: `tdx` provider serves
THSR + 國道客運. 9 routes, 5 operators, 1196 trips, 9 terminals. Taipei ↔ Taichung/Kaohsiung/Tainan/Yilan
both ways, weekday-aware, 10 new tests, ADR-B08.

### Methodology trace
operator sites (kingbus TLS fail, aloha168 dead, hohsin/kamalan Cloudflare, ubus no times) → taiwanbus.tw
(公路局) JS → `getData.ashx` route search + `TimeTableAPIByWeek.aspx` departures (no durations) → TDX guest
`Schedule/InterCity/1619` with browser headers = 200 + per-stop times → 9 more routes (10/20 daily guest calls)
→ 1827 cross-check vs 公路局 = identical → stop coords from `getRData.ashx?type=4` → scratch build script →
tests red (9) → `bus.ts` + `time.ts` + dispatch in `index.ts` → green → full gates → live :3001.

### Friction
- No source gives arrival times except TDX; ADR-B07's "operator sites" plan was not workable from here.
- Fares exist (taiwanbus `TMSQuery`) but vary by seat class and time band; left out rather than pick one.
- THSR Tainan (Guiren) is 11 km from the Tainan bus terminal; first bus test used it and got nothing.
- Taipei has 4 intercity terminals → "nearest terminal" would hide Yilan buses (Yuanshan/Nangang/City Hall).
- Chrome tab group was shared with the trains agent: my first navigate hit its Korail tab; sent it back, used own tab, closed it.
- Empty `modes` now returns buses too, so existing THSR tests had to pin `modes: ["train"]`.

### What I rejected and rewrote by hand
- `departures[]` + `durationMin` rows (ADR-C05 literal): per-run durations differ; trip-stop shape like THSR instead.
- Ubus booking-site search, Klook, 12Go pages for durations: booking flow / bot-blocked / third party.
- Committing the curation script: task bans a snapshot crawler; script stays in scratch, steps in Notes.
