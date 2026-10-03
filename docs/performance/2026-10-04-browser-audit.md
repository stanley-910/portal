# Portal browser performance and flow audit

Portal can become substantially smoother by letting completed animations stop, reducing the data needed to start the globe, and preserving user work across authentication and panel navigation. The strongest first changes are to settle invisible planes, stop perpetual landed-route redraws, restore drafts, and take animation delays out of Pip's server execution. A renderer rewrite is not justified by this audit.

This is the historical audit and proposed implementation backlog at `62b1207`. The subsequent implementation, before/after evidence, and explicit profile-gated deferrals are recorded in [the implementation report](2026-10-04-implementation.md). Priorities below describe user impact and sequencing, not measured speedup percentages.

## Scope and evidence

Reviewed commit `62b1207853b6cc3c2aeab6981aa677fb302cdb59` in `/Users/stanley/worktrees/portal/2026-10-04_browser-performance`, branch `audit/browser-performance-2026-10-04`. The original checkout was clean when this worktree was created; its initially observed edits had already entered this commit. No commits or publishing were performed.

The audit covers the home globe, route and ticket interaction, shared trips, Pip, identity, transport/hotel searches, startup assets and GPU lifecycle. Sources below are relative to the repository root; line numbers refer to this commit. Next.js recommendations were checked against this project's installed 16.3.8 documentation, especially lazy loading, production optimization, fetch caching, and error handling.

Evidence levels:

- **Browser reproduction:** an instrumented local production build in Chromium with SwiftShader software WebGL, at 1440 × 900 and DPR 1. It establishes loaded bytes, redraw behavior and the tested flow defects. Its frame rate is not a hardware benchmark.
- **Source confirmed:** the mechanism follows from the current code. User-visible latency and resource savings remain unmeasured unless stated otherwise.
- **Profile first:** a plausible improvement that needs real-device measurements before committing to its complexity.

No environment files or service credentials were copied. The browser probe aborts transport searches deliberately. It did not authenticate, book, charge, send a Pip prompt, or modify a shared trip. Authenticated/OAuth completion, multiplayer behavior and live provider latency therefore require follow-up fixtures or authorized test accounts. Safari, Firefox, real mobile GPUs and production networks were not profiled.

## Measured baseline

`pnpm build` passed, including TypeScript and generated-data checks. An initial build failed because Turbopack rejects a `node_modules` symlink outside its filesystem root; installing the exact lockfile with `pnpm install --offline --frozen-lockfile` inside the worktree resolved that tooling issue. It is not an application performance finding.

There were also **75 passing offline tests** across transport search, hub search, TDX daily, solo Pip and meetup:

```sh
pnpm exec vitest run src/lib/transport/search.test.ts src/lib/transport/hub-search.test.ts src/lib/transport/providers/tdx/daily.test.ts src/lib/agent/solo.test.ts src/lib/agent/meetup.test.ts
```

These establish a baseline; they do not validate the proposed fixes.

The production browser loaded 11 Next JavaScript resources totaling **2,496,645 decoded bytes and 589,419 encoded body bytes**. The largest chunk alone was **1,913,402 decoded / 404,459 encoded bytes**, about 77% of the decoded JS. Encoded body size is not total wire traffic; it excludes headers and can describe a cached response.

The probe also records CSS, fonts and textures in [browser-probe.json](browser-probe.json). The root font configuration preloads eight font resources totaling 244,824 bytes; a further 4,804-byte font resource appears during the exercised flow. There are two earth texture resource entries, in addition to borders and provinces. Shared decode/upload work should be assessed separately from network caching.

Both the landed and reduced-motion landed samples continued clearing the full-size HUD and offscreen route canvas and issuing WebGL draws on every observed animation frame. This verifies the redraw mechanism; it does not isolate the cost of each draw or establish phone FPS. The initial idle globe deliberately rotates, so initial idle activity alone is not a bug.

Reproduce using two terminals from the worktree:

```sh
pnpm build
pnpm exec next start -p 3107
```

```sh
node docs/performance/browser-probe.mjs
```

The probe overwrites its JSON results. Exact frame counts depend on the machine. Use real hardware and production builds for comparative timing.

## Recommended implementation order

Effort is a rough change-size estimate including validation: **S** is localized, **M** crosses a few components or contracts, and **L** changes a pipeline. It is not a delivery commitment.

| Order | Change | Priority | Effort | Main benefit |
| --- | --- | --- | --- | --- |
| 1 | Settle invisible planes and landed HUD animation | P1 | S–M | Stop work after visible motion finishes |
| 2 | Restore trip and checkout after sign-in; fix modal Escape | P1 | M | Prevent lost or invisible progress |
| 3 | Keep booking and per-leg drafts through navigation | P1/P2 | M | Eliminate repeated input and searches |
| 4 | Separate Pip animation from server work; own each stream lifecycle | P1 | M | Earlier results and predictable cancellation |
| 5 | Compact browser hub data; split optional panels | P1/P2 | M | Faster parsing and first usable globe |
| 6 | Composite route masking once; cache panel obstruction geometry | P1/P2 | M | Lower work during motion and camera follow |
| 7 | Publish partial searches and coalesce duplicate requests | P1/P2 | L | Show useful fares before the slowest provider |
| 8 | Share derived trip state; improve GPU lifecycle and quality tiers | P2 | M–L | Smoother larger trips and longer sessions |

P1 means a strong candidate for the first optimization pass or a major flow failure. P2 is meaningful follow-up. P3 items should wait for profiling or sufficient usage.

## Rendering and startup fixes

### 1 Settle invisible landed planes

**P1 · S · source confirmed and browser redraw reproduced.** `src/components/trip-globe/engine.ts:2095–2098` eases altitude and bank toward zero indefinitely. `sceneChanged()` compares their exact floating-point values at `2109–2122`, and `2144–2151` dirties WebGL for each tiny change even after the plane disappears. The same settlement issue applies to landed remote planes around `1997–2003`.

Snap these values to their final state when touchdown finishes, and omit invisible transient objects from drawable-scene comparisons. A numeric replay of the altitude update starting at 0.03 at 60 Hz changed for 5,546 iterations, approximately 92.4 seconds; that is a numerical example, not a measured browser duration.

**Acceptance:** after all visible landing, camera and pin transitions complete, ten seconds without input should cause no repeated WebGL draws attributable to the vanished plane. Check local and remote flights, normal and reduced motion, then take off again.

### 2 Stop permanently animating the landed HUD

**P1 · M · source confirmed and browser redraw reproduced.** `engine.ts:2146` makes every landed trip animated. Routes march at `3314–3324` regardless of search completion, so `drawHud()` at `3210` onward clears the overlay and runs label placement and route drawing repeatedly.

Drive animation from actual search/progress state and stop when work finishes or fails. If perpetual route motion is a deliberate visual requirement, isolate it to a cheap route layer instead of recomputing map labels. Cache static labels separately from moving routes and pointer shadows.

**Acceptance:** a landed, completed or failed search stops redrawing stationary labels; moving the pointer does not rebuild the whole label layer. Search status changes, theme changes, zoom and route edits must invalidate the correct layer.

### 3 Mask and composite routes once per frame

**P1 · M · source confirmed.** Every route with visible pins clears a viewport-sized offscreen canvas (`engine.ts:3145–3154`), applies pin cutouts, and composites that entire layer (`3175–3191`). This scales with both leg count and viewport area. At 1920 × 1080 CSS pixels and DPR 2, a single such canvas contains 8.29 million pixels.

Draw compatible routes into one layer, mask pins once, and composite once; preserve label and route ordering. Cache projected stationary geometry until camera, route or pin geometry changes. Separate exceptional styles only where visually necessary.

**Acceptance:** count full-size clears/composites for 1, 6 and 20 legs at DPR 1 and 2. They should no longer scale one-for-one with every compatible leg. Compare pin cutouts and route overlap visually.

### 4 Ship a compact browser hub catalogue

**P1 · M · measured bundle size and source-confirmed imports.** The engine imports preview code, which imports `src/lib/transport/hubs/catalog.ts:3–7`, bringing in 4,008 airport records and 57 surface hubs. `airports.json` is 1,542,287 source bytes. `src/lib/places/search.ts:1–2` also depends on the same catalogue. City rendering adds 5,527 labels in a 179,316-byte source file. Source bytes do not translate directly to compressed transfer savings, but the browser measurement confirms a large loaded chunk.

Generate a compact preview/search representation with only required coordinates, labels, modes, ranks and identifiers. Keep provider-specific metadata and rich hub records on the server. Share one spatial index across hover and place-name lookup; consider loading lower-ranked labels only at useful zoom levels. Retain immediate offline preview and globally useful search coverage.

**Acceptance:** compare production chunks, encoded sizes and JS evaluation time; test place/IATA search, snapping, hover labels and hub resolution against representative worldwide cases. Confirm no provider code or credentials enter the client.

### 5 Defer optional panels and trim startup preloads

**P2 · M · source confirmed, benefit to measure.** `src/app/globe-screen.tsx:6–12` statically imports Pip, ticket search and solo checkout; `src/app/layout.tsx:5,34–36` eagerly includes auth panel code. Conditional rendering does not itself defer these imports. `src/app/fonts.ts:3–23` puts four families and eight weight/style faces at the root. `src/app/globals.css:5–12` loads feature styles globally.

Use client-side dynamic boundaries for checkout, modal contents and larger optional panels, with stable-size fallbacks and intent preloading. Keep the actual globe and immediately visible controls on the critical path. Preserve font tokens and type design while removing unnecessary preloads or scoping faces used only by later content. Consider feature CSS splitting after measuring unused CSS; its measured compressed size is much smaller than JS, so do not prioritize it first.

The installed Next lazy-loading guide warns that dynamically importing a Client Component from a Server Component does not currently provide automatic client code splitting. Place the boundary appropriately and verify emitted/requested chunks.

**Acceptance:** closed optional UI does not load its feature chunk; first opening remains responsive; no flash, layout jump, hydration error or missing typeface. Do not lazy-load the core globe merely to improve a synthetic initial-byte score.

### 6 Replace repeated page-wide obstruction scans

**P2 · M · source confirmed.** `trip-globe.tsx:222–228` supplies `elementFromPoint` to a 24-pixel grid (`free-area.ts:13–18`). That means 3,600 DOM hit tests at 1920 × 1080 and 6,360 at 2560 × 1440. Pip follow refreshes this roughly every second (`engine.ts:1817–1819`); a body-wide child-list observer triggers reframing on unrelated changes (`trip-globe.tsx:176–190`). Call counts are deterministic; their elapsed cost is not yet measured.

Register obstructing panel rectangles and derive free space from cached geometry. Invalidate from relevant panel state, targeted ResizeObservers and viewport changes. If generic hit testing remains necessary, cache/coarsen it and skip scans when obstruction geometry is unchanged.

**Acceptance:** trace Pip follow and streamed messages; unchanged panels should not cause thousands of hit tests per second. Preserve camera framing around opened/resized panels and intentional exclusions for route-following cards.

### 7 Make render resolution adaptive

**P2 · M · profile first.** Both canvases use the same DPR capped at 2 (`engine.ts:1206–1224`), with antialiasing (`557`) and up to twelve pin-shadow computations per surface pixel (`shaders.ts:206`). A fixed ceiling does not account for weak GPUs, large screens or sustained thermal limits.

Separate WebGL render scale from crisp text/HUD resolution. Experiment with lowering WebGL scale during dragging or sustained frame pressure, then restore with hysteresis. Only add shadow/MSAA quality tiers if real traces identify them as meaningful costs.

**Acceptance:** real Safari/iPhone and integrated-GPU Chrome measurements, including visual inspection of labels and coastlines. Resolution must not oscillate. No specific FPS gain is established by this audit.

### 8 Let settled animation work sleep

**P2 · M · source confirmed.** `engine.ts:2130–2164` schedules RAF continually, reads dimensions, simulates, raycasts and invokes listeners even when dirty flags avoid drawing. The wrapper rounds and serializes flight data every frame (`trip-globe.tsx:230–242`), including where callbacks are absent. Idle drift is deliberate (`engine.ts:2046–2047`).

First preserve the intended active animation, then sleep when there is no animation/input/subscriber work. Wake for input, resizing, assets, presence and state changes. Cache dimensions with ResizeObserver and skip optional callback preparation without consumers. Pause decorative drift when the globe is obscured. Browsers already throttle background RAF; this is not a claim of unrestricted hidden-tab rendering.

**Acceptance:** settled/reduced-motion/covered states consume little work; remote movement and new input immediately wake rendering. Overlay positioning must still follow actual camera changes.

### 9 Own and release GPU resources

**P2 · M · source confirmed.** `engine.ts:625–636` disposes the sky but does not explicitly delete the engine's textures, buffers, VAOs, programs or shader handles; `attrib()` at `1112` does not retain buffer ownership. `sky.ts:124,182–189` also leaves a corner buffer untracked. Context loss/restoration is not handled.

Retain allocation handles, delete them deterministically, delete shader objects after linking, cancel obsolete texture work and recreate state after context restoration. Keep the existing restriction against calling `loseContext()` during Strict Mode teardown on a reused canvas. Missing explicit cleanup is not proof of permanently unreclaimable GPU memory.

**Acceptance:** repeated mount/unmount allocation/delete counters balance; intentional context loss restores a usable scene or provides a useful recovery action. Do not infer success from heap-only measurements.

### 10 Stage optional startup work and share texture decoding

**P2/P3 · M · source confirmed and duplicate resource path reproduced.** Startup builds models and compiles four shader programs (`engine.ts:559–595`), then bakes a procedural 2048 × 1024 sky (`sky.ts:14–15,151–175`). Earth is separately fetched/decoded for the GPU and CPU mask (`engine.ts:599–600,1168,1183`). The probe records both earth requests; cache behavior determines actual network duplication.

Share the decoded source between consumers with explicit ownership/closing. Render a usable globe before preparing optional sky/model refinements; compare a smaller initial sky bake. Profile before introducing workers or OffscreenCanvas, since the engine depends heavily on DOM and canvas state. A supplied `skySeed` could cause another bake after initialization, but no current caller supplies it; treat that as latent cleanup.

**Acceptance:** first usable frame and main-thread startup tasks improve while decoded bitmaps are released correctly. Textures encode data; preserve lossless channel values and color-space behavior rather than converting them through a photographic image optimizer.

## Flow and interaction fixes

### 11 Restore the home trip across authentication

**P1 · M · source confirmed, authenticated completion not exercised.** Auth success reloads the page (`auth-panel.tsx:119–122`). Home then starts with `legs=null` (`globe-screen.tsx:55`) and resumes the pending save without restoring the route (`133–138`). Success UI and `SoloCheckout` render only inside the conditional ticket (`226–288`). A save can succeed invisibly; Book can establish checkout state with no card to display it.

Persist a versioned, validated route/pick draft with the pending intent, restore it before continuing, and place recovery notices outside the ticket condition. Alternatively, explicitly open the saved trip after authentication. Preserve intentional identity and room reconnection semantics; replacing the hard reload alone is insufficient.

**Acceptance:** guest Save and Book through email, signup and OAuth show the recovered route and visible result exactly once. Cover refresh, failed save and unavailable browser storage. Do not persist payment/passport form data as part of a general route draft.

### 12 Keep booking input through folding and minimization

**P1 · M · source confirmed.** Shared plan minimization unmounts `FloatingTripPlan` (`trip-room.tsx:184–195`); collapsing a leg unmounts its booking content (`trip-plan.tsx:266–427`). Booking state is local and details are uncontrolled inputs (`leg-booking.tsx:45,267–345`), so entered but unsubmitted details disappear.

Keep a stable in-memory draft owner keyed by trip and leg, or keep the form mounted but hidden/inert. Suspend hidden animation subscriptions. Clear sensitive values on explicit cancellation, completion or leaving the trip.

**Acceptance:** fill details, collapse/reopen, minimize/expand and receive collaborator edits without losing values or submitting anything. Invalidated offers must be explained rather than silently reusing incompatible details.

### 13 Preserve fare and hotel choices when revisiting a leg

**P2 · M · source confirmed.** Home keys TicketSearch by active leg/date (`globe-screen.tsx:228`), while TicketSearch initializes date, selected row, return and hotel state afresh (`ticket-search.tsx:228–240`). Existing `picks` are not rehydrated, and `useOffers` only retains the mounted instance's last result (`use-offers.ts:28–72`). Going Back loses the reviewed UI state and triggers another search.

Keep per-leg drafts in the flow owner, keyed by stable leg identity. Store selection by offer ID rather than index; restore dates, stay and return choices. Add bounded query reuse with explicit freshness and offer expiry. Revalidate bookable prices before purchase.

**Acceptance:** choose a nondefault fare/date/stay, proceed, then go Back/Forward. Choices remain and identical fresh searches are reused. Changing route or dates invalidates only affected choices.

### 14 Make authentication modal behavior exclusive

**P1/P2 · S–M · browser reproduced and source confirmed.** Auth's window Escape listener (`auth-panel.tsx:52–56`) does not consume the event. TicketSearch's window listener (`ticket-search.tsx:257–269`) also handles it and dismisses the route. In the probe, opening the URL-driven auth dialog over a landed ticket and pressing Escape removed both the dialog and ticket. No login or save was submitted. Declaring `aria-modal` does not create focus containment, background inertness or focus restoration.

Use a dialog primitive and one topmost-overlay Escape policy. Consume Escape before underlying route handlers; disable background shortcuts while modal. Maintain Tab/Shift-Tab containment and return focus to the opening control.

**Acceptance:** Escape closes auth while retaining the landed ticket/route. `/` does not open background place search. Keyboard focus cannot move into the globe while auth is open.

### 15 Remove Pip presentation waits from server execution

**P1 · M · source confirmed.** `src/lib/agent/solo.ts:122–130` awaits animation sleeps before emitting subsequent steps and returning its tool result. Constants in `marks.ts:20–29` add **2.5 seconds for one new leg, 4.9 seconds for two, 12.1 seconds for five**, excluding model/search latency. Shared edits also wait (`tools.ts:262–275`).

Send authoritative plan updates promptly and enqueue ordered presentation events in the browser. Run fare search and model continuation while the animation plays. Preserve shared Undo boundaries and avoid stale animation events overwriting a newer plan. Reduced motion should not retain invisible server animation delays.

**Acceptance:** fake-clock tests show immediate tool completion; browser animations remain ordered, interruptible and consistent with the latest plan.

### 16 Own the entire solo Pip stream lifecycle

**P1 · M · source confirmed.** `home-pip.tsx:145–156` resolves `send()` after response headers and launches `void read(...)`; composer pending then clears (`agent-chat.tsx:448–460`). Overlapping runs share activity and globe mutation callbacks, and either completion clears activity (`home-pip.tsx:186–211`). There is no browser AbortController. Tool searches use independent deadlines rather than the parent signal (`solo.ts:153,181,239`); sleeps and the fallback path also lack a complete cancellation chain. Partial failed replies lack a clear retry state.

Use run IDs and a per-run controller, with explicit serialization or replacement behavior and Stop. Track/await stream reading through completion, guard stale events, and clean readers/frames in `finally`. Combine the request signal with each tool deadline. Preserve partial text and make interrupted replies visibly retryable. Keep the intentional room-wide lifetime of shared Pip distinct from solo navigation lifetime.

**Acceptance:** overlapping prompts, Stop, unmount, network interruption and delayed tool events cannot let old runs change the trip or clear newer activity; providers receive cancellation. Retrying does not duplicate already-applied edits.

### 17 Show hotel refinement progress and provide retry

**P2 · S–M · source confirmed.** A mismatched hotel query returns empty/idle (`hotel-search/query.ts:17–21`), but skeletons require `!result` (`hotel-search.tsx:102–108`). Once any result exists, changing filters can leave a blank area. Errors say Try again without a retry control (`109`); unchanged input does not rerun the effect (`53–65`). Leaving the Hotels tab unmounts its filters (`ticket-search.tsx:460–473`).

Represent the current query as searching, reserve result space, add an explicit retry attempt and keep filter/query state across tabs. If showing old results during refinement, identify them as updating and prevent selecting them as if they matched the new query.

**Acceptance:** delay/fail the second query, verify a visible busy state and usable retry, then switch tabs and retain filters.

### 18 Recover checkout transport failures locally

**P2 · M · source confirmed.** Shared booking's task runner (`leg-booking.tsx:70–82`) and solo settle/pay (`solo-checkout.tsx:37–60`) do not handle rejected Server Action transport promises locally. Business failures have notices, but network failures bypass them.

Catch transport failures at the UI boundary, preserve the draft and show recovery. When payment outcome is uncertain, read authoritative booking/payment status before offering another mutation. Never blindly auto-retry a charge.

**Acceptance:** drop responses before and after booking/payment work; the user sees a recoverable status, entered data remains and reconciliation prevents duplicate operations.

## Data loading and shared state fixes

### 19 Render the shell without waiting for display-profile enrichment

**P1/P2 · M · source confirmed.** `/` awaits identity before returning the globe (`src/app/page.tsx:7`). `getCurrentUser()` sequentially calls remote auth and profile lookup (`supabase/server.ts:43–50`) without an application deadline. Shared entry then reads its room (`t/[id]/page.tsx:21–23`); connection and shared Pip repeat related identity/room work.

Separate verified authorization identity from optional display enrichment; use the existing verified-claims path where its semantics suffice. Memoize repeated reads within a request, parallelize independent reads, and bound optional enrichment. Consider a stable globe shell with identity-dependent controls resolving separately. Do not weaken authorization or treat unverified session data as trusted; sensitive actions retain their checks.

**Acceptance:** delayed/unavailable profile services do not hold the usable shell indefinitely; authorization, sign-out and profile refresh behavior remain correct. Measure authenticated entry separately from the unconfigured guest baseline here.

### 20 Publish fast search results before the slowest provider

**P1 · L · source confirmed.** `transport/search.ts:174` awaits every provider, `hub-search.ts:28` awaits every hub pair, and `api/transport/search/route.ts:22` sends one final JSON response. A slow configured flight provider can hide already-available rail results for its deadline; Duffel's is 10 seconds (`providers/duffel/client.ts:11`). This is a code-derived bound, not measured production latency.

Stream validated batches, or provide an initial local result plus subsequent remote updates. Preserve request identity, provenance, estimated badges, cancellation and final ranking. Keep selected offer identity and row placement stable as results arrive; display source progress truthfully.

**Acceptance:** a delayed provider fixture does not block the first useful result; late old-date results never reappear; complete output agrees with current dedup/ranking behavior. Preserve deterministic demo fallbacks.

### 21 Share overlapping Pip and ticket searches

**P2 · M · source confirmed.** Solo instructions direct planning then fare search (`solo.ts:63–66`). Plan emissions activate browser `useOffers` while `search_routes` independently calls `searchFromCoordinates` (`solo.ts:151`). There is no application in-flight coalescing across these consumers, and Duffel uses uncached POSTs. Travelpayouts already caches responses, so this is not a claim that all providers lack caching.

Have the card and Pip consume one search ID/result, or coalesce complete canonical provider queries with bounded expiry. Include all relevant passenger/query inputs and isolate sensitive/user-scoped offers. A cancelled consumer must not abort another consumer's shared work. Revalidation remains mandatory at booking.

**Acceptance:** overlapping identical searches cause one provider invocation per canonical query, while differing inputs remain distinct. Expired offers are not silently reused.

### 22 Derive shared plan projections once

**P2 · M · source confirmed; CPU benefit unmeasured.** `trip/plan.ts:51–76` reconstructs legs/stops/votes and compares serialized results (`464–465`). Stays, split and dates also serialize derived structures (`85–138,460–462`). Multiple components subscribe independently, and each `LegCard` derives the entire date plan (`multiplayer/trip-plan.tsx:201`). Storage-root updates can run selectors even when equality prevents a React commit; cursor presence is separate and should not be blamed for this path.

Select structurally shared underlying slices, derive stable projections once per trip, and pass one date plan down. Retain unchanged per-leg identities before memoizing cards. Avoid copying full search results into projections that need only a selected price or date.

**Acceptance:** profile the three-leg demo and a 20-leg stress case during votes, fare arrival, edits and chat storage updates. Count selector executions/allocations separately from commits; preserve date and split correctness.

### 23 Bound meetup provider fanout

**P2 · M · source confirmed upper bound.** `agent/meetup.ts:139–154` evaluates five cities for every origin group; each coordinate search can produce four flight pairs, each invoking applicable providers. Two groups can therefore initiate up to 40 Duffel searches plus 40 Travelpayouts lookups, before surface providers. Actual counts depend on valid pairs and caching. The tool schemas require a minimum group count but lack a maximum (`solo.ts:222`, `tools.ts:284–292`).

Deduplicate/cap groups, budget total calls and use provider-aware concurrency limits plus an overall deadline. Evaluate strongest candidates first if needed, making any loss of exhaustive ranking explicit. Preserve estimated fallback output on exhaustion.

**Acceptance:** synthetic 2/4/large-group tests assert call budget, peak concurrency, cancellation and bounded completion, with understandable partial-result status.

### 24 Remove avoidable provider and trip-list tails

**P2 · S–M · source confirmed.** Three targeted changes are justified:

- `hotels/live.ts:12–14` waits for both sources even though a valid Duffel result always wins. Return that result as soon as it is available; await LiteAPI only when needed and cancel unused work without unhandled rejections. Test fast preferred/slow fallback and failed preferred cases.
- TDX current/previous-day reads are sequential (`providers/tdx/index.ts:125–126`), and completed-result caching lacks in-flight sharing (`daily.ts:30–55`). Coalesce token/day requests, then run independent dates concurrently. Test concurrent consumers and cancellation isolation.
- `trip/server.ts:66–98` fetches every listed room's full Storage for costs and waits up to 2.5 seconds before returning rows. Show metadata rows first and enrich visible costs; avoid loading chat/history merely to calculate a collapsed cost summary. Test a slow room and a large saved-trip list.

### 25 Reduce shared Pip queue polling at scale

**P3 · M–L · source confirmed.** Each waiting shared request polls the full Storage document every 1.5 seconds (`agent/run.ts:151–162`). With several queued users and growing history, this multiplies payload and reads.

Use event-driven wakeups or a compact queue/status record when usage warrants it. Preserve existing ordering, recovery and ownership semantics; this is less urgent than the visible flow failures and render loop work.

**Acceptance:** concurrent queue tests retain order and recovery while reducing full-document reads. Measure bytes/read count with realistic history size.

## Smaller improvements and profile gates

- **DPR cache correctness:** `engine.ts:1211` clears country sprites on DPR changes, while city cache keys at `2893` omit DPR. Clear both caches or include DPR; verify monitor changes and browser zoom without blurry/mis-sized labels. Small, source-confirmed fix.
- **Stationary hover work:** hub previews skip unchanged points, but place names still scan 5,527 cities every 80 ms (`engine.ts:2173`, `place-name.ts:23`). Share/cache spatial queries based on actual point movement. Measure before introducing a worker.
- **Reduced-motion camera policy:** `pip-saucer.tsx:84–99` automatically follows Pip; reduced motion snaps camera movement rather than removing automatic follow. Make automatic follow opt-in for reduced motion and retain an explicit Follow action.
- **Cursor rendering:** cursor state crosses React (`trip-globe.tsx:204,268–272`) but is already quantized and change-detected. Only move it to imperative DOM updates if profiling shows meaningful commits; it is not an unconditional React render every frame.
- **Allocation and cache polish:** reuse pin typed arrays (`engine.ts:2497–2498`) and city winner buffers after eliminating unnecessary draws. Bound sprite/cursor caches if long-session memory traces demonstrate growth.
- **Field visibility:** `layout.tsx` includes general analytics, but the source search found no dedicated performance marks/Web Vitals instrumentation. Add first usable globe, first useful fare, final fare, Pip first text, plan applied and save/checkout acknowledgement measures. Aggregate timings without recording conversations, passport details or trip coordinates.

## Verification plan

Use the existing tests as a correctness baseline, then add targeted regressions for changed behavior. Do not write tests that merely duplicate implementation details.

1. **Rendering:** production builds on Chrome, Firefox, Safari and a real iPhone/Android device; empty globe, settled 1/6/20-leg trips, drag/zoom, pointer movement, remote presence, Pip follow, modal open, reduced motion and context recovery. Record draw counts, frame-time percentiles, long tasks and memory over repeated mounts.
2. **Loading:** cold/warm caches and constrained network/CPU; compare emitted/requested JS, first usable globe and font/layout stability. Keep guest and authenticated measurements separate.
3. **Search:** fast/slow/erroring fixtures, rapid date/route changes, duplicate consumers, cancellation, expiry and provider budget exhaustion. Measure first useful result separately from final completeness.
4. **Flow:** guest Save/Book round trips, Back/Forward across legs, collapse/minimize during details entry, hotel refinement retry, Escape and focus behavior, concurrent/interrupted Pip turns, and uncertain payment response reconciliation.
5. **Multiplayer:** edits, votes, stays and early departure by different clients while another user types. Confirm preserved drafts and correct live cost splits; compare selector cost at demo and stress sizes.

For active interaction, use the target display's frame budget (16.7 ms at 60 Hz, 8.3 ms at 120 Hz) as a design target, not an achieved result. For settled scenes, the clearer acceptance criterion is avoiding unnecessary repeated draws. Establish device baselines before promising numeric improvements.

## Existing work to preserve

The renderer already has separate WebGL/HUD dirty flags, cached label sprites, pooled arc points, instanced stars, a baked sky, surface scissoring, throttled hub lookup and reduced-motion handling. Home chat batches text updates by animation frame and memoizes completed messages. Offer searches abort superseded browser requests and guard stale results. Fare lists are already short, and chat only auto-scrolls near the bottom. Provider fallbacks and data provenance are part of the product contract.

These strengths make targeted changes preferable to replacing the renderer, adding blanket memoization, virtualizing every list, or caching all fares indiscriminately. Begin with unnecessary redraws and lost user state, then measure the next bottleneck.
