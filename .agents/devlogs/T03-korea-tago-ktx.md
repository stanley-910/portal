---
task: T03
author: Ahmet
sessions: [2026-10-02]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 2
tools: [superpowers:test-driven-development, claude-in-chrome (Korail probe), WebSearch]
---

## Session 1 — 2026-10-02

### What I asked for / what came back
Execute T03 in `portal-trains` (no push/PR/merge; tier check skipped). Came back: `korea-tago`
= Korail seed, 683 trains on Seoul–Busan/Daejeon/Dongdaegu/Gwangju-Songjeong/Gangneung and
Yongsan–Gwangju-Songjeong/Mokpo, both directions, KRW adult fares, per-weekday `days`,
zod-validated, `pnpm korea:snapshot`, 13 tests. Stub no longer claims every train query.

### Methodology trace
korail.com search in Chrome → "no trains", network shows obfuscated POST → 500 (bot
protection; stopped, not bypassed) → WebSearch → train.asamaru.net per-pair pages with 7 days
embedded → snapshot script (14 pages) → seed → tests red against stub (10 fail) → `train.ts` +
`index.ts` → green → verification → live curl 66 offers Seoul→Busan.

### Friction
- Session cut by a rate-limit stop before any file was written; resumed clean at 2394bff.
- Header `<tr>` parsed as a row on first run → split on `<tbody>`.
- Python urllib SSL store broken locally → probing done from the Node script instead.
- Fares ~9% below guide-quoted Korail fares (54,400 vs 59,800 Seoul–Busan). Kept as sourced,
  flagged in Notes; not hand-corrected.

### What I rejected and rewrote by hand
- Nearest-single-station match: Seoul query would miss Yongsan (Honam line). Switched to
  china-rail-style city grouping.
- Percent-encoded source URLs (312 KB seed) → decoded Korean URLs (205 KB).
