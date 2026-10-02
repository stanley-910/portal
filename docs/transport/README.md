# Clicks → hubs → transport offers

Implemented on `feat/click-to-transport-hubs`, originally based on `36e386e` and
integrated with remote `main` at `0807cd0` before publishing. The merge retains
main's new providers, best-option ordering, date picker, navbar, sky and multiplayer planes.
The merged provider/ranking code was reviewed and hardened first; see
[ranking review](ranking-review.md).

## What works

1. The globe raycasts pointer positions onto its sphere and already exposes
   unsnapped `LandedTrip.origin` / `destination` in degrees. Search now uses those
   points, **not** the position of whichever hub is previewed locally.
2. The server resolves each point against bundled Asia-wide airport locations
   and representative train stations/passenger ferry terminals.
3. It ranks useful endpoint **pairs**, then queries the relevant transport
   providers for a bounded shortlist. Airport codes remain airport codes: SHA
   does not silently turn into a Shanghai city search or PVG.
4. Returned offers are validated and sorted deterministically. Cached fares,
   typical timetables, and bundled fallback candidates are visibly **Estimated**,
   with their sources. Missing credentials and API failures do not remove the
   local shortlist.
5. Canceling or starting another trip aborts the old request and prevents late
   results from restoring a stale trip. Search uses the displayed local calendar
   date rather than slicing a UTC timestamp.

## Hover preview

Idle hover and in-flight plane movement now show the nearest bundled **airport,
train station or ferry terminal** under the pointer. The mock airport dataset
has been removed. Labels identify the mode for stations/ferries and show the
airport IATA code plus city for flights; long labels are shortened to fit the
viewport. The full label is available to assistive technology.

- The preview is a local lookup over the same catalog/radii used by landing
  resolution: airport 200 km, station 100 km, ferry terminal 60 km.
- It chooses the nearest hub across modes, not a country, a flight offer, or a
  guaranteed connection. The landing search can choose different hubs based on
  the other endpoint. A nearby hub can be across a border.
- It uses the surface point under the pointer, **not** the elevated plane or a
  point clamped to the horizon. Camera pan/zoom under a stationary pointer also
  updates the lookup. Off-globe, pointer-leave, drag/pinch, or uncovered locations
  clear the moving label rather than snapping to a distant hub.
- A small cache limits scans to once per 80 ms while moving; unchanged ground
  coordinates require no scan. React updates only when the selected hub changes.
  No geocoding, route search, provider request or API token is used on hover.
- `catalog.ts`, `geo.ts` and `preview.ts` are browser-safe. Provider registries,
  credentials and the surface connection graph are not imported into the hover
  path. Data attribution remains visible on the globe.
- `onTakeoff` now receives `Hub | null` and fires even outside coverage.
  `LandedTrip.from/to` are nullable local preview hubs; `origin/destination`
  remain the authoritative unsnapped points, and `distanceKm` is click-to-click.
  Uncovered takeoff/landing still work without crashing or retaining old results.

This is **not country-boundary lookup**: a hub's country is metadata about the
hub, not a claim that the pointer is inside that country. Shared-room globes get
this local visual preview too; this does not add shared search results or planning.

## Coverage and data provenance

The checked-in snapshot contains **1,271 airports** (55 country/territory codes),
**34 train stations**, **22 ferry terminals/piers**, and **32 directed estimated
surface connections**. Surface coverage is a curated subset, not every station
or dock. No airport-to-airport service graph is fabricated.

[Dataset documentation](../../src/lib/transport/hubs/DATA.md) records the pinned
OurAirports commit/checksum, exact geography filter, source/licence information,
and per-terminal caveats. It includes the whole of some transcontinental
countries; “Asia-wide” is broad geographic coverage, not exhaustive service coverage.
The UI credits OurAirports, Wikidata and OpenStreetMap contributors, with an ODbL
link. Runtime hub resolution makes **no external geocoding request**.

```sh
python3 scripts/snapshot-hubs.py --check  # fully offline validation
python3 scripts/snapshot-hubs.py          # refresh airports from the pinned source
```

## Relevance policy (heuristic, not a routing engine)

`src/lib/transport/hubs/resolve.ts` is a pure, testable geographic resolver:

- Candidate radii: airports **200 km**, stations **100 km**, ferry terminals
  **60 km**. No global-nearest fallback: an ocean/out-of-coverage click may have
  no hubs.
- Candidate pairs must have the same mode and different hub IDs. Rail/ferry
  pairs require an exact directed bundled edge. A missing edge means unknown
  connectivity, not “no service exists.”
- An airport pair is only a **geographic candidate**. For short hops, flights
  are excluded below 100 km click-to-click or 150 km airport-to-airport.
- Each leg must make geometric progress toward the destination. Combined
  straight-line access plus hub-to-hub distance cannot exceed
  `1.75 × click distance + 25 km`; this rejects backwards/large-detour legs in
  overlapping catchments (e.g. Shenzhen rail for HK → Macau).
- Within a mode, lower scores win:
  `accessKm + 0.25 × max(0, accessKm + legKm − clickKm) − 8 × (originImportance + destinationImportance)`.
  Importance is a bounded dataset hint, not measured connectivity.
- Ties use stable hub-pair IDs. Up to **4 flight pairs**, **3 train pairs**, and
  **3 ferry pairs** are searched. All nearby hubs are considered before pairing,
  so a connected station is not lost behind a closer unconnected station.
- The response includes up to three candidates per mode/endpoint, prioritizing
  those in retained pairs; it can include four to preserve all selected airport
  endpoints. Groups appear flight, train, ferry; this is not a cross-mode “best
  journey” recommendation.
- The globe requests flight/train/bus/ferry. Surface providers also receive one
  raw-coordinate search using their own broader station/route seeds, so this
  intentionally partial hub graph cannot suppress newly added train/bus coverage.
  Those offers keep their actual provider endpoints, not an unrelated airport pair.

Access distances are great-circle distances, **not road distance or travel time**.
The resolver has no road network, border/check-in penalty, visa eligibility,
airport minimum connection time, or cost of getting to the hub. A nearby hub
across a border can be returned; the UI says access excludes borders/transfers.
There is no global optimality claim, transfer composition, or Pareto ranking.

## Search API

Existing direct provider callers keep their contract. Add `resolve=hubs` for
coordinate resolution:

```sh
curl --get 'http://localhost:3000/api/transport/search' \
  --data-urlencode 'from={"name":"Hong Kong","lat":22.305,"lng":114.165}' \
  --data-urlencode 'to={"name":"Shanghai","lat":31.23,"lng":121.47}' \
  --data-urlencode 'date=2026-11-15' \
  --data-urlencode 'modes=flight,train,ferry' \
  --data-urlencode 'currency=USD' \
  --data-urlencode 'resolve=hubs'
```

Dates must be real `YYYY-MM-DD` calendar dates; numeric JSON coordinates must be
finite and in range. `modes` omitted/empty means all modes. Invalid input returns
`400 {"code":"BAD_QUERY","fields":[...]}`. Both flat `fromName/fromLat/fromLng`
(and `to*`) parameters and strict numeric JSON places are accepted. Passengers
remain limited to 1–9 per ADR-C06; optional `providerIds` are preserved in JSON places. Responses use `Cache-Control: no-store`; provider
internal caching is separate.

The existing fields remain `{ offers, errors, tookMs }`. In hub mode the response
also includes:

- `hubs`: original clicked places, `from`/`to` candidate lists, ranked `pairs`
  and search limits. Each hub has a stable ID, mode, location and source.
- `offerPairs`: offer ID → requested pair IDs; duplicated provider offers are
  merged and sorted using `rankOffers`. A search association is not proof of
  an exact ferry boarding terminal (legacy 12Go records are approximate areas).
- `estimates`: IDs of shortlisted pairs with no returned provider offers. These
  retain local demo usefulness without inventing departure times or fares.

Each eligible provider has an independent 8-second deadline. One failure does
not discard healthy provider results. Errors are sanitized and deduplicated by
provider/code across pair searches; the response currently does not expose
per-pair error diagnostics. A normal empty cache is not a failure or evidence
that a route does not operate.

Travelpayouts currently maps **direct cached flight summaries only**. Its prices
are per passenger, not party totals, and do not confirm seats. Connecting-flight
support requires a richer summary/segment contract. The UI deliberately avoids
labeling the first row “cheapest journey.” Main's best-option heuristic is retained:
known fixed FX estimates, duration, mode and segment-count penalties affect ordering
only, never displayed fares. Unknown currencies do not default to USD. The first
row is a suggested option; the remaining offers are available under Other options.
Changing the departure date reruns the same precise clicked coordinates, preserving
request cancellation and local-calendar semantics. The legacy seven-airport fallback is
still used by direct coordinate-only provider callers **without** `resolve=hubs`.

The 12Go adapter is a bundled estimated timetable, not a live fare source. Its
mode assignment now follows the actual seed being mapped instead of relabeling
ferries as buses when both modes are requested. Main's bus seed and other surface
adapters are retained. Their checked-date freshness values are accepted as calendar
dates rather than fabricated timestamps.

## File map

| File | Responsibility |
| --- | --- |
| `src/components/trip-globe/engine.ts` | Screen picking, throttled surface-hover preview and unsnapped coordinate events |
| `src/lib/transport/hubs/preview.ts` | Browser-only nearest-hub selection and hover cache |
| `src/lib/transport/client-query.ts` | Click coordinates and local departure-date serialization |
| `src/lib/transport/query.ts` | Public request validation |
| `src/lib/transport/hubs/` | Bundled data, provenance, geographic pairing and tests |
| `src/lib/transport/hub-search.ts` | Bounded pair searches, merge, dedup and fallback IDs |
| `src/lib/transport/search.ts` | Provider isolation, runtime offer validation, price ordering |
| `src/app/api/transport/search/route.ts` | Existing GET route with optional hub resolution |
| `src/app/globe-screen.tsx` | Landing search lifecycle and resolved ticket |
| `src/components/transport/results.tsx` | Offers, estimated alternatives, nearby hubs and attribution |
| `scripts/smoke-flights.mts` | Real external API check with safe diagnostics |
| `scripts/smoke-globe.mjs` | Browser pointer-click and cancellation regression check |

## Verification

From the worktree:

```sh
pnpm install --frozen-lockfile
pnpm exec next typegen  # needed before standalone tsc on a fresh checkout
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
python3 scripts/snapshot-hubs.py --check
```

Browser check (uses a running app, a separate headless browser and no personal
browser profile; does not require a provider token):

```sh
pnpm exec playwright install chromium
pnpm start --port 3015 # after pnpm build, in another terminal
BASE_URL=http://localhost:3015 node scripts/smoke-globe.mjs
```

The pre-merge hover integration passed **207 tests**. The final main integration
checks cover both suites, real surface-provider validation, and the browser flow
including navbar/date-picker retention. Run the commands above for the current
suite count. There is one inherited ESLint warning in the generated LogoReveal
bundle (`@typescript-eslint/no-unused-expressions`); no lint errors. Local HTTP smoke checks returned HK → Shanghai rail/airport candidates,
Seoul → Shanghai and Shanghai → Tokyo airport candidates, HK → Macau ferry
results, and no origin candidates for an ocean click. The browser check also
caught and fixed a clipped ticket close control in the new scrolling layout.

### Real external flight fetch: verified with cached fares

After credentials were added, the external check on 2026-10-02 at 17:49 UTC
returned HTTP 200 and **one cached HKG → PVG fare** for 2026-11-01. The running
app's full Hong Kong → Shanghai coordinate search also returned HTTP 200,
**two flight offers**, five hub pairs and no provider errors. These were real
provider responses, not fixtures; they do not confirm live seats or prices.
The safe aggregate report is [live-api-check.json](live-api-check.json).
The earlier missing-credential blocker is resolved.

Put the token in **this worktree's** ignored `.env.local` (never commit it), then:

```sh
node --env-file-if-exists=.env.local scripts/smoke-flights.mts HKG PVG 2026-11-15
```

Choose a future date with likely cache coverage. The script sends the token only
to the configured Travelpayouts endpoint in its authentication header, uses a
15-second timeout, and writes a secret-free aggregate report to
`docs/transport/live-api-check.json`. A `200` response with zero fares confirms
access, not route availability. A positive count proves the real API returned
**cached fares**, not live inventory. Restart Next after adding credentials to
also exercise the app's full adapter/mapping path.
