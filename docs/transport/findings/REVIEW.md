# Transport data implementation review

The reviewed combined result is in `/Users/stanley/worktrees/hku-hackathon/2026-10-03_transport-review`.
Three Codex agents handled trains, boats/borders and stays; the coordinating agent handled global flights,
reviewed source and code findings, merged changes and fixed cross-feature date/freshness issues.

| Ticket | Implemented | Still needed |
| --- | --- | --- |
| A — Trains | Independent official KTMB refresh and horizon checks; optional TDX dated schedules; Vietnam official timetable snapshot; remove invented China fares; source attribution | KTMB upstream dates after Oct 17; authorized Japan/rail reseller access; authenticated TDX verification; live rail seats/fares |
| B — Boats | Bidirectional Singapore–Batam/Bintan and Busan–Hakata timetable subsets; source evidence and monthly review check; remove suspended SkyPier seed | Approved live booking API; automatic refresh permission/contract for sources; other seed corridors remain typical timetables |
| C — Borders | Source/operator/access research for all seven groups; ferry coverage above; sourced check-in/timezone/border caveats; BOT attribution | HK coaches, China–Laos, Osaka/China–Korea and further international coverage remain incomplete; partner schema/access needed |
| D — Flights | 4,008 global airports; long-haul smoke; timezone/date-line arrival display, hotel dates and night splits; truthful Duffel test inventory | Real Duffel production airline entitlement check; absent cached routes remain estimates |
| E — Stays | Optional LiteAPI with documented contract tests, nationality/public pricing/room/tax validation; no-key/failure fallback; query-scoped UI and honest saved budgets | Production LiteAPI key or Duffel Stays enablement; actual four-city live inventory check; dedicated approved hostel source |

## Validation

- `pnpm test`: 789 passed, one opt-in live booking test skipped; 81 files passed.
- `pnpm lint`: passed, one existing LogoReveal warning.
- Next route type generation and `pnpm exec tsc --noEmit`: passed.
- Eight real app-route searches passed (HK–Shanghai, Hanoi–Saigon, Singapore–Batam both ways,
  Tanah Merah–Bintan, Busan–Hakata, Taipei–Zuoying, HK–London). No fabricated train/ferry fares.
- Four-city hotel smoke returned estimates with current credentials. This is working fallback, not verified live access.
- Browser: real globe clicks opened the hotel panel; optional nationality selector and Estimated attribution rendered,
  no page errors. A delayed nationality-change request immediately hid the previous results and re-enabled only
  matching results. Screenshot `.cache/transport-review-hotels.png` is local inspection evidence.
- Offline airport/hub, ferry source-evidence, Vietnam snapshot and KTMB horizon checks passed.
- Hover scan: 4,008 airports; p95 0.65 ms on this host vs unchanged 80 ms throttle. Dataset gzip 184 KB.

All source tables, rejected alternatives and access requirements are copied into [the PR draft](PR-DRAFT.md).
No account creation, personal identity submission, payment, contract or provider messages were performed.

## Integration

The first portion was included in main by concurrent commit `3571fdc`. The remaining reviewed transport changes
and the [new demo cache TODO](../briefs/demo-listing-cache.md) are being committed on
`transport/review-2026-10-03` for integration with the current main. Ticket worktrees are preserved.
No provider signup, payment, outreach or PR publication was performed. The cache expansion is queued, not completed.
