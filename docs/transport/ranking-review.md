# Deterministic transport ranking review

Reviewed `b26dea648d384605e838e3e02bc1bc910e7bc04f` (2026-10-02 work session), before integrating globe clicks with transport hubs. This is a correctness review of server-side search, HTTP handling and the Travelpayouts adapter, not a verification of real-world flight connectivity.

## Findings first

| Finding in the merged implementation | Consequence | Review change |
| --- | --- | --- |
| Amounts sorted without currency identity | A small JPY amount could outrank a USD amount as though they were comparable | Currency-aware grouping; no implicit FX conversion |
| Departure timestamps compared lexically | Different UTC offsets could reverse chronological order | Compare parsed instants |
| Comparator indexed `segments[0]` unconditionally | An empty upstream segment array could crash the entire search | Validate provider offers; defensive public ranking helper |
| Fan-out had no individual deadline | One hanging adapter could hold all healthy results indefinitely | Independent 8-second deadline, composed cancellation signal, and promise race even for signal-ignoring adapters |
| Synchronous `covers`/`search` throws escaped isolation | A single provider defect could fail the request | Isolate both synchronous and asynchronous failures |
| HTTP boundary accepted other non-2xx statuses and confused body aborts with parse errors | Invalid/error bodies could reach mappers; cancellation diagnostics were inconsistent | Classify all non-2xx responses, fetch aborts and body-read aborts without returning raw errors |
| Travelpayouts response types were assertions, not runtime validation | Null/wrong envelopes, invalid dates, absent durations or malformed fares could throw or invent zero-duration journeys | Validate envelopes and essential rows; typed `BAD_RESPONSE` failures |
| Explicit airport codes broadened to metropolitan city codes | NRT/ICN selections could search TYO/SEL; airport-pair intent could be lost | Preserve explicit airport codes; require returned airport identity to match explicit queries |
| Connecting results were represented as a single segment | A connecting summary looked like a direct flight | Request `direct=true`; omit summaries with transfers instead of inventing segments |
| Offer IDs omitted airline | Airlines sharing a flight number could collide | Include airline and actual airport endpoints in the ID |
| Upstream booking links accepted arbitrary origins/protocols | An upstream URL could lead users somewhere other than the intended booking site | Only HTTPS `www.aviasales.com/search/…`, without embedded credentials; omit unsafe links |
| Coordinate-based queries reused clicked coordinates as airport coordinates | A cached airport flight could be drawn from a non-airport location | Use the adapter's airport snapshot for coordinate-fallback results when known; preserve explicit hub coordinates |

The existing fan-out already reduced ordinary rejected promises to public error codes; this review preserves that useful redaction rather than exposing exception messages.

## Ranking contract

`rankOffers(offers: readonly Offer[], currency: string): Offer[]` is exported by `src/lib/transport/search.ts`. It returns a new array and does not mutate the supplied array or offers. This module imports the server provider registry: use it for server-side merging, not in a client component.

The order is:

1. Valid priced offers in the requested currency, cheapest first. Currency codes are compared case-insensitively.
2. Other valid priced offers, grouped by currency code in ordinal alphabetical order, then cheapest **within that currency**. The order between these currency groups is organizational, not an economic recommendation.
3. Unpriced offers. The helper also treats negative/nonfinite/malformed prices defensively as unpriced; the actual search boundary rejects such malformed offers instead.
4. Within each equal-price group (or the unpriced group), first departure by UTC instant, then provider ID, then offer ID using ordinal string comparison. Invalid/missing departures sort last within their group in the defensive helper.

Example for a USD request: `USD 10`, `USD 200`, `EUR 20`, `EUR 500`, `JPY 1`, unpriced. This **does not** claim that EUR 500 is cheaper than JPY 1.

`09:00+08:00` is earlier than `08:00+01:00` on the same calendar day: 01:00 UTC versus 07:00 UTC. Lexical comparison would get this wrong.

This is price-first display ordering, not Pareto ranking, shortest-duration ranking, a multi-leg planner, an airport-access-cost calculation, or a guarantee of the best available journey. It does not prefer live data over cached data at equal prices. Identity-identical ties retain input order; the helper does not deduplicate offers. It does not compute party totals or convert currencies.

## Search and failure contract

- Mode filtering precedes `covers`. An empty requested mode list means all modes.
- `covers` is only cheap provider eligibility. Plausible endpoints, an IATA code, a nearby airport or a cached fare do not verify current route operation or seat availability.
- Eligible providers run concurrently. Each gets its own 8,000 ms timer and a signal combining its deadline with request cancellation. A promise race bounds an adapter that ignores the signal; its underlying noncooperative operation may continue, but cannot hold up the result or cause an unhandled late rejection through this wrapper. This cannot preempt synchronous CPU-blocking code.
- Deadline timers/listeners are cleaned after settlement. Provider cancellation never aborts the parent request or another provider's controller.
- The existing error union has no `CANCELLED` member. Caller cancellation therefore uses `TIMEOUT`, like a deadline expiry; no interface change was introduced.
- Healthy providers survive another provider's timeout, synchronous exception, malformed batch or rejected promise. A mixed valid/malformed offer batch keeps valid siblings and adds one `BAD_RESPONSE` for that provider.
- Boundary validation checks nonempty segments, finite/nonnegative fares and durations, offset-bearing valid timestamps, arrival not before departure, place coordinates, provider ownership and supported mode. Only requested modes are returned.
- Public errors contain only `provider`, `code`, `retryable`. Unknown exceptions become retryable `UPSTREAM_ERROR`; raw messages, bodies, tokens and URLs are never included in `errors`.

HTTP classification:

| Condition | Public code | Retryable |
| --- | --- | --- |
| 401 / 403 | `AUTH_FAILED` | No |
| 429 | `RATE_LIMITED` | Yes |
| 5xx | `UPSTREAM_ERROR` | Yes |
| Other non-2xx responses | `UPSTREAM_ERROR` | No |
| Network failure | `UPSTREAM_ERROR` | Yes |
| Aborted/timed-out fetch or body read | `TIMEOUT` | Yes |
| Malformed JSON or non-abort body-read failure | `BAD_RESPONSE` | No |

`fetchJson<T>` remains a type assertion convenience, not a generic schema validator. Adapters must validate their payloads.

## Travelpayouts semantics

The review follows [flight ADR-F01/F02](../../.agents/ledgers/flights/DECISIONS.md) and the checked-in [provider research](../../.agents/docs/api/travelpayouts.md): Data API cached fares only, explicit currency and market, no real-time Search API. The implementation still uses `/aviasales/v3/prices_for_dates`, server-only header authentication, a 30-row limit and 24-hour Next fetch revalidation.

- `kind` stays `cached`; `asOf` is populated only when the source supplies a valid `found_at`. We do not stamp the fetch time as the fare's observation time. An upstream cache plus our revalidation interval can make data older than the provider cache alone.
- Attribution explicitly says cached fare **per passenger**, availability unverified. `passengers` does not make the Data API check seats or quote the whole group; no fare multiplication is performed. The source's booking link can still encode its original passenger count.
- When upstream currency is supplied at envelope or row level, it must match the requested currency; otherwise the batch fails. When absent, the documented requested-currency convention is used. No conversion is inferred from the amount.
- A successful envelope must explicitly contain an array. `success: true, data: []` means normal cache sparsity; absent/non-array data is malformed, not proof of no service.
- Malformed essential rows fail the Travelpayouts batch with `BAD_RESPONSE`. This intentionally favors honesty over partially accepting a corrupt provider payload. Unsupported connecting rows, wrong dates and mismatched airport pairs are omitted instead.
- The mapper requires positive duration, valid offset-bearing departure, nonnegative finite amount, airline, flight number and an explicit transfer count. It uses `duration_to`, or `duration` when the former is absent. Arrival is calculated from departure plus duration and emitted in UTC, not invented in destination local time.
- Direct-flight-only support is a deliberate limitation of the current one-segment mapper. Supporting connecting cached summaries needs connection details or an explicit summary representation in the shared contract, not a fabricated direct segment.
- Explicit airport IATA codes are preserved and are not translated to city codes. The coordinate-only fallback remains the old seven-record snapshot with a 150 km nearest-airport cutoff and metropolitan-code lookup. It is not a global resolver. The hub integration should send explicit airport places. Explicit metropolitan codes are not a substitute for airport-pair selection; strict returned-airport matching may omit those results.
- A safe link is a search redirect, not a verified bookable offer. Manually appending an affiliate marker is retained; affiliate tracking itself has not been verified. Unsafe/malformed links are omitted without losing an otherwise valid cached offer.

The checked-in HKG–BKK response is an offline fixture, not evidence that that flight or fare operates on the displayed date. No provider credential, live API, airline schedule or booking availability was tested in this review.

## Integration contracts

The review changes did not alter `types.ts` or `registry.ts`. The subsequent
click-to-hub integration implements the API/UI recommendations below; see
[the integrated flow and final verification](README.md).

- Reuse `rankOffers(offers, query.currency)` after merging server-side airport-pair searches; it is not a browser-safe import from `search.ts`.
- Supply explicit airport IATA codes and corresponding airport coordinates. Do not describe candidate airport pairs as connected without evidence.
- Validate real calendar dates and query shape at the API boundary, and return `Cache-Control: no-store`; provider-internal caching remains separate.
- Keep UI request cancellation/race protection and visible source labels. Every non-live result needs the project's **estimated** badge even when `kind` is `cached` or `timetable`.
- Show foreign currencies explicitly rather than presenting the first item as a globally cheapest journey. Never treat a per-passenger cached price as a group quote or assume the booking link matches the selected party size.
- Keep per-mode deterministic demo fallback separate from provider data and visibly estimated. This adapter does not silently synthesize flight offers after a failed/empty cache lookup.
- If the product needs a distinct cancellation code, party price basis, connection summaries, or estimated synthetic offers in the shared contract, those are explicit follow-up interface decisions, not implicit claims made by this review.

## Offline verification

The tests use checked-in fixtures, fake providers, fake timers and stubbed `fetch`; no test relies on external network access. Coverage includes same-/cross-currency ordering, equal-instant offsets, deterministic ties, immutability, missing segments, malformed offers, concurrent fan-out, hanging providers, cancellation, sync throws, error redaction, HTTP status/body failures, malformed Travelpayouts envelopes/rows, direct-only mapping, explicit airport matching, currency mismatch and unsafe links.

Run from the worktree:

```sh
pnpm exec vitest run src/lib/transport/search.test.ts src/lib/transport/http.test.ts src/lib/transport/providers/travelpayouts/travelpayouts.test.ts
pnpm exec eslint src/lib/transport/search.ts src/lib/transport/http.ts src/lib/transport/search.test.ts src/lib/transport/http.test.ts src/lib/transport/providers/travelpayouts/*.ts
pnpm test
pnpm exec tsc --noEmit
git diff --check
```

At the initial review checkpoint, the focused suite passed **90 tests across three files** and the then-current full suite passed **164 tests across ten files**. The later integration resolved temporary hub-import/test-typing issues and passed the full checks; current results are recorded in [README.md](README.md#verification). `next typegen` is needed before standalone typechecking a fresh checkout to generate Next's route helper types.

The merged PR also introduced a second Vitest config that shadowed the existing ESM config. Integration retains one `vitest.config.mts`, including both application and script test globs, avoiding that ambiguity.
