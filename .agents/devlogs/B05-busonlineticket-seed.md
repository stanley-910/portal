---
task: B05
author: Ahmet
sessions: [2026-10-02]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 2
tools: [superpowers:test-driven-development]
---

## Session 1 — 2026-10-02

### What I asked for / what came back
Execute B05 in `portal-buses` (no push/PR/merge; tier check skipped). Came back: `busonlineticket`
provider = seed of 8 cities / 22 directed MY-SG-TH pairs / 109 operator rows, zod-validated,
route-page deep links with optional `refererid`, 12 tests, ADR-B06.

### Methodology trace
doc `busonlineticket.md` → curl KL→SG route page → found per-operator schedule table + JSON-LD
(first/last bus, trips, est. duration) → probed 32 slugs (`melaka`, `hat-yai` 404 → `all_route.js`
names `Malacca`, `Hatyai`) → parsed 22 pages → top-5 operators per pair → `seed.json` → Wikipedia
API city coords → tests red (stub) → adapter → green → registry test red (BOT still in stub list) →
LANDED += busonlineticket → green → 44 link checks 200 → live search on :3001, 10 offers.

### Friction
- Python `urllib` failed on a self-signed cert in the local TLS chain; switched fetching to curl.
- Route pages give only first/last bus per operator, not each run → 2 offers per operator (ADR-B06).
- `pnpm test -- busonlineticket` does not filter; full suite runs.
- First tz-mismatch test used `routes[0]`, a Hat Yai row whose tz is legitimately Bangkok.

### What I rejected and rewrote by hand
- Operator websites as time source: dozens of operators, few publish timetables.
- POST search / fares scraping: no permission (doc § Gotchas).
- Hat Yai tz assumed +07:00 at origin; flagged `unverified` in Notes.
