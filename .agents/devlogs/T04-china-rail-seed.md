---
task: T04
author: Ahmet
sessions: [2026-10-02]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 2
tools: [general-purpose subagent (web research)]
---

## Session 1 — 2026-10-02

### What I asked for / what came back
"implement my task ahmet train" → T04 (no key needed; T01/T03 wait on TDX / data.go.kr keys).
Came back: `china-rail` adapter, 64 cited seed trains across 5 demo pairs both ways, Trip.com
link-out, 8 tests. Earlier in session a duplicate C01 was built on `main` and discarded —
parallel session had already landed it on `dev/ahmet`.

### Methodology trace
doc `china-12306.md` → research subagent fetched public timetable pages + MTR PDF (no 12306
calls) → keep station-explicit rows only → `seed.json` → tests → red (SZ↔HK radius overlap,
registry LANDED) → city grouping → green → live route smoke 10 offers, link 200.

### Friction
- City-level timetable tables silently mix stations; most rows unusable.
- 30 km radius matched HK West Kowloon from Shenzhen; switched to nearest-station-picks-city.
- Trip.com affiliate params undocumented → shipped untagged.

### What I rejected and rewrote by hand
- Rows with conflicting train numbers (Beijing–Xi'an renumbering) and "station unconfirmed" rows.
