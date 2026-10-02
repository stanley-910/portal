---
task: C02
author: Ahmet
sessions: [2026-10-02]
model: claude-opus-5-5
model_recommended: claude-sonnet-5-5
iterations: 1
tools: [superpowers:test-driven-development]
---

## Session 1 — 2026-10-02

### What I asked for / what came back
"do c02 too" (Cata's seat; owner override, Cata's branch had no C02 work). Came back: ADR-C06
query shape, `query.ts`, `search.ts` `fanOut`, GET route, 19 new tests (53 total).

### Methodology trace
Next 16 docs (route handlers, maxDuration, runtime) → ADR-C06 → `search.test.ts` + `query.test.ts`
red → implement → green → lint/tsc → live curl HKG→TPE: 200, 7× `NOT_CONFIGURED`.

### Friction
- Ran on opus while MODELS.md says sonnet; owner asked directly in an opus session.
- Providers may ignore `signal` → added race-vs-abort so hangs still return `TIMEOUT` (ADR-C07).
- Vercel duration: Fluid 300 s vs legacy 60 s max → `maxDuration = 15`, fits both.

### What I rejected and rewrote by hand
- Retries in fan-out: dropped for v1 (budget), recorded ADR-C07.
- Packed `from=lat,lng,name`: names have commas → flat params.
