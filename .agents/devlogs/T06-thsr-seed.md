---
task: T06
author: Ahmet
sessions: [2026-10-02]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 2
tools: [superpowers:test-driven-development, claude-in-chrome (link check)]
---

## Session 1 — 2026-10-02

### What I asked for / what came back
Execute T06 in `portal-trains` (no push/PR/merge; tier check skipped). Came back: `tdx` provider
= THSR seed, 181 trains Taipei↔Zuoying both directions, 12 stations, per-train `days`, IRS
booking link-out, zod-validated seed, reproducible `pnpm thsr:snapshot`, 13 tests.

### Methodology trace
TDX guest GeneralTimetable / DailyTimetable → 401 (curl) → thsrc.com.tw timetable page →
found its `POST /TimeTable/Search` (full stop list per train) → 14 calls for week 2026-10-12..18
+ TDX guest Station (200 with browser headers) → script → `seed.json` → tests red (stub) →
adapter → green → tsc red (JSON tuples not castable) → zod schema parse → green → live smoke 78 offers.

### Friction
- zsh did not word-split `set -- $od`: first 14 calls sent `StartStation="TaiPei ZuoYing"` →
  405 "操作異常". Redone with explicit vars.
- Search for day D also returns the night-before cross-midnight trains → filter on `RunDate`.
- IRS booking host drops curl (empty reply); verified in Chrome instead.

### What I rejected and rewrote by hand
- `seedJson as Seed` cast (T04 pattern) — fails with tuple types; replaced by `seedSchema.parse`.
- Hand-curating from PDF: the site endpoint gives exact per-stop times, less error-prone.
