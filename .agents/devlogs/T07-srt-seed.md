---
task: T07
author: Ahmet
sessions: [2026-10-03]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 3
tools: [superpowers:test-driven-development, WebSearch]
---

## Session 1 — 2026-10-03

### What I asked for / what came back
Execute T07 in `portal-trains` (no push/PR/merge; tier check skipped). Came back: new `srt`
provider = SRT Thai rail seed, 124 trains / 36 stations on Northern, Northeastern, Southern lines,
types + running days from SRT's own data file, D-Ticket link-out, `pnpm srt:snapshot`, 16 tests,
`ProviderId` + registry one-liners (ADR-C08), `srt.md` doc.

### Methodology trace
railway.co.th (TLS reset) → web search → `ttsview.railway.co.th/SRT_Schedule2022.php` (classic
table, curl OK) → per-train page + modern API = Turnstile → skipped → found `timetable_data.js`
(types, days) → namtang `stops.txt` for coords → script → sanity check failed (train 23 two
midnight rolls) → swap/drop repair → seed → tests red (no index) → adapter → green → live 5 offers.

### Friction
- `www.railway.co.th` resets TLS; `dticket.railway.co.th` NXDOMAIN on local resolver (resolves on
  8.8.8.8, checked with `curl --resolve`).
- Spur stations listed against running order on the Southern line made a plain "≤ 1 midnight roll"
  check throw; needed adjacent-swap before drop.
- `toISOString()` date = UTC → `checked` said 2026-10-02 at 00:10 local; switched to local date.
- ESLint lints `.cache/` → cached JS saved as `.js.txt`.

### What I rejected and rewrote by hand
- Hand-typing times from third-party sites (thailandtrains.com etc.): the SRT page is the primary source.
- Throwing on irreparable columns: one tangled commuter train (355) would block the whole snapshot → skip + log.
