# Browser performance implementation and verification

The implementation removes unnecessary settled rendering, reduces initial browser code, shares repeated computation and provider work, and preserves progress through common navigation flows. The verified improvements justify integrating these changes into local `main`.

Work was isolated in `audit/browser-performance-2026-10-04`. The implementation baseline is `22abdf9`, which includes the newer Pip checkout, wallet, and phone validation work. The final integration also preserves `04b7b96`, a concurrent server-only change separating live/demo booking storage; it does not change the browser workload measured here. The [original audit](2026-10-04-browser-audit.md) describes the older `62b1207` snapshot; its measurements must not be used as the direct before/after comparison for this implementation.

## Measurements

Production browser measurements use the same Chromium version, 1440 × 900 viewport, DPR 1, fresh context, and software WebGL. Transport requests are deliberately aborted in the rendering probe. The separate flow probe supplies synthetic transport/hotel responses. These runs establish bytes, rendering work, and flow behavior; they do not establish real-device FPS, battery savings, or live provider latency.

See [before.json](before.json), [after.json](after.json), [CPU benchmark](cpu-benchmark.json), and [server scheduling fixtures](server-scheduling.json) for raw evidence. The browser probe includes an extended quiet period because delta-time-capped camera transitions can take longer on software GPUs. Initial idle rotation is intentional and remains enabled, so identical pixel clicks can land at slightly different coordinates. The comparison exercises the same single-leg flow, not identical hardware frame timing. Small decorative Pip canvases can still animate after the globe sleeps.

| Production browser observation | Before | After |
| --- | ---: | ---: |
| Initial first-party JS, decoded body bytes | 2,627,632 | 1,548,067 (41.1% less) |
| Initial first-party JS, encoded body bytes | 621,512 | 528,175 (15.0% less) |
| Initial font body bytes | 244,824 | 187,868 |
| Texture resource entries | 4 (earth twice) | 3 (earth once) |
| WebGL draws in normal settled 2.2-second sample | 45 | 0 |
| Full-size HUD clears in that sample | 15 | 0 |
| WebGL draws / full-size HUD clears, reduced-motion sample | 51 / 17 | 0 / 0 |
| DOM point hit tests during six unrelated DOM updates | 15,636 | 80 |
| Landed ticket still present after closing auth with Escape | No | Yes |

Encoded body size excludes headers and is not total wire traffic. Optional font/code work can load later: across the exercised route/auth flow, first-party JS totals 2,627,632 → 1,572,990 decoded bytes, and 621,512 → 538,278 encoded bytes. The baseline additionally requested Stripe's large script on entry; the optimized entry did not. The initial globe still rotates and route/camera transitions still draw; only settled globe work reaches zero. Raw sample frame counts include the probe's own RAF and are not a dropped-frame metric.

The CPU benchmark verifies equal output before measuring seven warmed rounds. For 1,017 hover queries, median lookup work fell from **224.67 ms to 3.24 ms**. For 1,000 unrelated storage-root changes across eight subscribers on a 20-leg plan, median projection/equality work fell from **115.97 ms to 0.20 ms**. These are isolated workloads, not whole-page speedup factors.

Offline scheduling fixtures compare the previous scheduling contract with the new implementation:

| Controlled workload | Before | After |
| --- | ---: | ---: |
| First usable fares, with a slow provider finishing at 1,000 ms | 1,000 ms | 0 virtual ms |
| Provider calls for 20 concurrent queries with five distinct inputs | 20 | 5 |
| Artificial server presentation waits for a two-leg Pip plan | 4,900 ms | 0 ms |
| Queue polls during a 60-second wait | 40 | 14 |

Zero virtual milliseconds means an immediately resolved fixture is no longer blocked by an unrelated delayed task. It does not mean real searches finish instantly.

## Disposition of every audit finding

| Audit item | Implementation and evidence |
| --- | --- |
| 1. Invisible landed planes | Snap completed landing state and exclude invisible plane motion from scene differences. Ten-second normal/reduced-motion renderer regressions assert no additional globe draws or scheduled frames. |
| 2. Perpetual landed HUD | Animate dashes only during search; cache static label layout/rasterization. Search completion/failure permits sleep. Tests verify searching routes do not recompute labels. |
| 3. Route masks | Draw compatible routes into one mask and composite once per frame. Cache projected arcs. Tests cover 1, 6, and 20 routes and camera invalidation. |
| 4. Browser catalogue | Generate lossless compact tuples from canonical data; preserve every hub field and source. Use a spherical spatial index for hover hubs/city labels; lazily build place search. Catalogue equality and exhaustive nearest comparisons pass. Browser-safe meetup totals prevent a server catalogue import through trip adoption. |
| 5. Optional panels/fonts | Dynamically load ticket, hotel, solo checkout, and Stripe functionality; stop preloading the optional small-caps font. Core globe remains eager. Browser resources confirm the changes; opening optional panels is exercised by the flow probe. |
| 6. Obstruction scans | Cache registered panel rectangles and invalidate on relevant geometry changes. Unrelated streamed DOM text no longer triggers page-wide point hit testing. Route-following cards remain excluded. |
| 7. Adaptive resolution | **Profile-gated, not applied.** No real-device GPU evidence justifies lowering resolution, antialiasing, or shadow quality. Preserve appearance; profile Safari/iPhone and integrated-GPU Chrome before choosing quality tiers. |
| 8. Sleeping animation | Sleep settled rendering, pause hidden/obscured scenes, and wake for input, assets, resize, presence, and Pip presentation. Tests cover delayed remote interpolation. Pip explicitly requests frames while presentation work remains. |
| 9. GPU lifecycle | Track/delete GPU resources and shaders, abort pending texture work, close decoded bitmaps, and rebuild after context restoration while preserving the trip. Allocation/delete and recovery tests pass. |
| 10. Startup/decode | Share earth texture fetch/decode between GPU upload and land mask; prepare heavy procedural sky after the first frame. Tests assert three texture fetches and closed bitmaps. Smaller sky textures, workers, and postponing lightweight models remain profile-gated because they add quality/first-interaction tradeoffs. |
| 11. Auth restoration | Version/validate pending intents with the server's bounded save schema; restore route/picks before saving. Queue `showTrip` until the engine starts. Schema/restoration tests pass; real email/OAuth completion was not exercised. No payment/passport drafts are persisted. |
| 12. Folded forms | React Activity retains shared plan/leg booking forms and chat drafts while suspending hidden effects. Existing booking lifecycle remains authoritative. Browser verifies Pip minimization; authenticated shared-room folding is not live-tested. |
| 13. Revisiting legs | Preserve per-leg date/tab/fare/stay drafts and stable selected offer IDs, including late progressive results that would otherwise push a selection out of the top three. Cache eligible nonlive queries briefly; route/date changes invalidate affected choices. Browser verifies Back and hotel-tab persistence. |
| 14. Exclusive auth modal | Native modal dialog provides inert background and focus handling. Keyboard events stay inside the dialog; Escape preserves the ticket. Browser checks focus and Escape. |
| 15. Pip presentation waits | Remove server sleeps; emit plan/marks promptly and play presentation on the browser. Preserve ordered marks and reduced-motion follow preferences. Offline scheduling and cancellation tests cover the server contract. |
| 16. Solo stream lifecycle | Own the controller until the full NDJSON body completes; one active run, Stop, cancellation, interrupted reply state, retry, and final partial-line decoding. Tests cover blocked-read cancellation and partial/unicode frames. Replies that already applied a trip suppress retrying the original edit and ask for a follow-up; a browser fixture verifies this after a disconnect. |
| 17. Hotel refinement | Show loading for changed queries, preserve filters when hidden, and expose Retry. Browser delays/fails the second query and verifies recovery. |
| 18. Checkout recovery | Catch transport failures locally, preserve forms, disable further mutation controls for uncertain outcomes, and expose an explicit booking-status reload. Release Stripe elements on unmount. No payment was submitted; actual lost-response reconciliation with Stripe/Duffel remains a test-account follow-up. |
| 19. Identity critical path | Use verified claims for read-only shell display; retain remote user verification for mutations. Memoize request-local identity reads, parallelize independent shared-Pip checks, bound optional profile reads to 1.5 seconds, and retain verified identity when enrichment throws. Refresh claims after color updates. Tests cover unavailable enrichment. |
| 20. Progressive search | Preserve JSON API and add cumulative validated NDJSON results: first useful result immediately, subsequent bursts coalesced at 50 ms, final result always emitted. Preserve ranking, deduplication, errors, attribution and estimated data. Fixture tests cover early/final output and burst bounds. |
| 21. Overlapping searches | Share canonical concurrent provider calls with independent reader cancellation; abort upstream only when its last reader leaves. Browser reuse targets 32 cache entries, evicts only inactive searches, and expires completed nonlive results after 60 seconds. Active readers are never evicted to meet the cache target. Completed live quotes are never cached. |
| 22. Shared projections | Weakly cache immutable leg rows/lists, stays, dates and cost splits across subscribers. Retain unaffected row/derived-value identity. Tests cover votes, dates, departures, stop changes and separate room snapshots; CPU benchmark measures repeated unrelated updates. |
| 23. Meetup fanout | At most six origin groups × five cities, four coordinate jobs at once, six concurrent calls per provider, and duplicate-origin/query sharing. Queue time counts against deadlines. Tests cover budgets/cancellation. This bounds work rather than promising lower latency for every large request. |
| 24. Provider/list tails | Return valid preferred Duffel hotel results promptly and cancel unused secondary work; parallelize/coalesce TDX dates/token work. Render trip metadata before cost enrichment; cap enrichment at four reads with a shared 2.5-second budget. Liveblocks still returns complete Storage documents: reducing history bytes requires a separate persisted projection/schema migration. |
| 25. Queue polling | Share concurrent room reads, wake immediately on same-instance completion, and back off polling from 1.5 to 5 seconds. Cross-instance polling and abandoned-run recovery remain. No distributed event service was introduced. |

Smaller audit suggestions are covered by DPR-aware sprite invalidation, stationary-hover reuse, imperative native cursor updates, avoiding absent optional callback serialization, reusable typed arrays, bounded sprite/geometry/cursor caches, and local `portal:*` performance measures. Timing measures retain only the latest sample per name and transmit no telemetry.

## Verification and remaining limits

- `pnpm test`: **951 passed, 3 skipped**, across 101 passing test files. The skips are the explicitly opt-in live booking test, demo seeding test, and CPU benchmark; the CPU benchmark was run separately.
- `pnpm build`: passed, including TypeScript and generated-data checks.
- `pnpm lint`: zero errors; one existing unused-expression warning in `design-system/paper-atlas/components/LogoReveal/logo-reveal.js`.
- `git diff --check`: clean.
- [Production browser flow fixtures](flow-regressions.json): Back preserves the nondefault fare with no repeat search, hotel filters/loading/retry work, auth focus and keyboard behavior preserve the ticket, and Pip keeps its draft, owns stream cancellation, and suppresses duplicate retries after an applied edit.
- Before/after screenshots were visually inspected at 1280 × 800 with reduced motion; the globe, navigation and paper styling retain their appearance. Procedural sky and Pip greeting vary between sessions.

The flow probe uses only local fixtures and does not submit auth, bookings, payments, or a model prompt. Its Pip lifecycle checks replace the browser-only initial identity with a synthetic account and intercept the entire response stream; this does not test or bypass server authorization. Renderer tests simulate context loss/resource lifetime, but long real-device sessions, mobile visual quality, Safari/Firefox, authenticated multiplayer collaboration, actual OAuth completion and live provider/payment behavior need separate device/test-account runs. No FPS percentage is claimed.

The implementation deliberately avoids completed live-offer caching, lower-fidelity graphics, and a new Liveblocks schema without the evidence or migration required to justify them. These are explicit limits of the original profile-first suggestions, not claimed completed optimizations.

## Reproduce

Use the lockfile, a local dependency installation, and a production build in each isolated checkout. Turbopack rejects a `node_modules` symlink outside its filesystem root; `pnpm install --offline --frozen-lockfile` works with this host's dependency store.

```sh
pnpm test
pnpm lint
pnpm build
pnpm exec next start -p 3107
```

In another terminal:

```sh
PROBE_LABEL=after PROBE_OUTPUT=docs/performance/after.json node docs/performance/browser-probe.mjs
PORTAL_PROBE_URL=http://localhost:3107 node scripts/flow-browser-probe.mts
PERF_OUTPUT=docs/performance/cpu-benchmark.json pnpm exec vitest run scripts/performance-benchmark.test.mts
PORTAL_SERVER_BENCH_REPORT=docs/performance/server-scheduling.json pnpm exec vitest run src/lib/server-performance.test.ts
```

For the before measurement, build `22abdf9` in a separate checkout, run it on port 3108, and run the same browser script with `PROBE_URL=http://localhost:3108 PROBE_LABEL=before PROBE_COMMIT=22abdf9 PROBE_OUTPUT=docs/performance/before.json`. Run browsers sequentially; do not infer hardware FPS from SwiftShader frame counts. Reports overwrite their output files intentionally.
