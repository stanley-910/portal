---
task: T05
author: Ahmet
sessions: [2026-10-02]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 3
tools: [superpowers:test-driven-development]
---

## Session 1 — 2026-10-02

### What I asked for / what came back
Execute T05 in `portal-trains` (no push/PR/merge; tier check skipped). Came back: `gtfs`
provider serves trains. KTMB feed added (ETS, ERT, SH, ST; Komuter excluded), namtang
`route_type` 2 on. 36 pairs / 404 departures; KL→Penang 11 ETS, JB↔SG shuttle via Woodlands.
SRT: 0 usable legs — feed problem, documented, not faked.

### Methodology trace
doc `gtfs.md` § Feed URLs → downloaded KTMB (46 KB) + namtang (42 MB) → inspected trips per
route → real KTMB subset as fixture `__fixtures__/ktmb/` → 6 tests red (5 fail, calendar check
already passed from B03) → pins + nearest-centre stop + `MODES` += train → green → live build
→ SRT BKK→CNX departing 00:00, 7 min long → new red test → 300 km/h cap → green → doc patched
→ live smoke via `/api/transport/search`.

### Friction
- First-inside-radius stop rule put KL arrivals at Sungai Buloh (14 km out) and Penang at
  Bukit Mertajam. Rule now: stop nearest city centre within the visit.
- Woodlands CIQ sits 6 km from JB centroid, 12 km from SG → JB↔SG pair didn't exist. Pinned.
- Namtang SRT: long-distance trains have minute-step placeholder times; real-timed trips stop at
  Rangsit. Task's "BKK→CNX returns SRT" only holds on the fixture.

### What I rejected and rewrote by hand
- Shrinking the KL radius to dodge Sungai Buloh — would have broken bus terminals (TBS).
- Keeping placeholder SRT legs "because the step says SRT" — they'd show 7-min BKK→CNX trains.
