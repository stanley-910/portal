# Core — Recommended Model Per Task

| ID | Title | Model | Why |
|----|-------|-------|-----|
| C01 | Contract, stub registry, vitest, env schema | `claude-opus-5-5` | Frozen contract; mistakes multiply across 8 adapters |
| C02 | `/api/transport/search` fan-out route | `claude-sonnet-5-5` | allSettled + timeout over a fixed contract |

Rule: **contract + trust boundary = opus; wiring = sonnet.** Never haiku.
