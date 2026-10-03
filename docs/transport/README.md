# Transport search: clicks → hubs → offers

How a click on the globe becomes flights, trains, buses and ferries.

## Planned demo cache work

[TODO: collect real transit listings and add a simulated booking path](briefs/demo-listing-cache.md)
tracks rail across China, Taiwan, Japan, Korea and Southeast Asia, plus buses, ferries and flights.

## The pipeline

1. The globe raycasts the pointer onto its sphere. `LandedTrip.origin` and `destination` are the exact clicked
   points in degrees. Search uses those points, not whichever hub was previewed.
2. The server resolves each point against bundled airports, train stations and passenger ferry terminals.
3. It ranks useful endpoint **pairs** and queries the relevant providers for a bounded shortlist. Airport codes stay
   airport codes: SHA never turns into a Shanghai city search or PVG.
4. Offers are validated and sorted deterministically. Cached fares, typical timetables and fallback candidates are
   marked **Estimated** with their source. Missing credentials and API failures never remove the local shortlist.
5. Cancelling or starting another trip aborts the old request, so late results can't restore a stale trip, and a
   cancelled search never reads as failed. A search that drops its connection is retried once before the card says
   it failed, and one still running after 4 seconds says "Still looking." Dates are the displayed local calendar date,
   not a sliced UTC timestamp.

## Hover preview

While idle or flying, the globe shows the nearest bundled airport, station or ferry terminal under the pointer.

- It's a local lookup over the same catalog and radii as landing: airport 200 km, station 100 km, ferry terminal 60 km.
- It picks the nearest hub across modes. That's not a promise of a connection: landing may choose different hubs
  based on the other end, and a nearby hub can be across a border.
- It uses the surface point under the pointer, not the raised plane. Off-globe, drag or uncovered places clear the
  label instead of snapping to a distant hub.
- Scans run at most every 80 ms and React updates only when the hub changes. Hover makes no network requests.
- `catalog.ts`, `geo.ts` and `preview.ts` are browser-safe. Provider code, credentials and the connection graph stay
  out of the hover path.

A hub's country is metadata about the hub. It's not a claim that the pointer is inside that country.

## Coverage and provenance

The snapshot has **4,008 airports worldwide** (233 country and territory codes), **34 train stations**, **23 ferry terminals**
and **36 directed surface connections**. Surface coverage is a curated subset. No airport-to-airport service graph is
invented.

[`src/lib/transport/hubs/DATA.md`](../../src/lib/transport/hubs/DATA.md) records the pinned OurAirports source,
worldwide scope, licences and per-terminal caveats. The UI credits OurAirports, Wikidata and OpenStreetMap
contributors. Resolving hubs makes no external geocoding request.

```sh
python3 scripts/snapshot-hubs.py --check  # offline validation
python3 scripts/snapshot-hubs.py          # refresh airports from the pinned source
```

## Relevance rules

`src/lib/transport/hubs/resolve.ts` is a pure geographic resolver, not a routing engine.

- Radii: airports **200 km**, stations **100 km**, ferry terminals **60 km**. No global-nearest fallback, so an ocean
  click can have no hubs.
- A pair has one mode and two different hubs. Rail and ferry pairs need a bundled directed edge; a missing edge means
  unknown, not "no service".
- An airport pair is only a geographic candidate. Flights are dropped below 100 km click-to-click or 150 km
  airport-to-airport.
- Each leg must make progress: access plus hub-to-hub distance can't exceed `1.75 × click distance + 25 km`. This
  rejects detours such as Shenzhen rail for HK → Macau.
- Within a mode, lower scores win:
  `accessKm + 0.25 × max(0, accessKm + legKm − clickKm) − 8 × (originImportance + destinationImportance)`.
- Ties break on stable pair IDs. Up to **4 flight**, **3 train** and **3 ferry** pairs are searched.
- Surface providers match a click to their own stations or cities with one shared radius:
  `clamp(0.2 × click-to-click km, provider floor, 100 km)`. The floor is that provider's old fixed radius. Short trips
  keep it, so both ends can't snap to one city. Long trips get up to the 100 km station radius. The nearest station or
  city still wins. A floor above 100 km stays as it is.
- Surface providers also get one raw-coordinate search over their own seeds, so the partial hub graph can't hide
  train or bus coverage.

Distances are great-circle, not road distance or travel time. There's no border, check-in, visa, connection-time or
access-cost model, and no transfer composition.

## Search API

```sh
curl --get 'http://localhost:3000/api/transport/search' \
  --data-urlencode 'from={"name":"Hong Kong","lat":22.305,"lng":114.165}' \
  --data-urlencode 'to={"name":"Shanghai","lat":31.23,"lng":121.47}' \
  --data-urlencode 'date=2026-11-15' \
  --data-urlencode 'modes=flight,train,ferry' \
  --data-urlencode 'currency=USD' \
  --data-urlencode 'resolve=hubs'
```

- Places are flat `fromName`/`fromLat`/`fromLng` (and `to*`) params or strict JSON. Dates are real `YYYY-MM-DD`.
  Passengers are 1–9. Omitted `modes` means all. Bad input returns `400 {"code":"BAD_QUERY","fields":[...]}`.
- The response is `{ offers, errors, tookMs }`. With `resolve=hubs` it adds `hubs` (clicked places, candidates, ranked
  pairs), `offerPairs` (offer ID → pair IDs) and `estimates` (shortlisted pairs with no offers).
- Each provider has its own deadline: 8 seconds, or 10 for Duffel, which gives airlines 6 seconds and then needs about
  2 more of its own. One failure doesn't discard the others. An empty cache is not a failure or evidence that a route
  doesn't run.
- A provider that times out or fails still gives its modelled estimates (`fallback` on the provider), with the failure
  in `errors`. Travelpayouts' distance-based flight estimate is that fallback for flights, so a flight between
  airports 300 km or more apart never comes back empty because Duffel or Travelpayouts was slow. Only `estimated`
  offers pass as a fallback.
- Provider calls happen only in route handlers on the Node runtime, so keys never reach the browser.

## Being honest about data

- Every offer says where it came from. Anything that isn't live shows an **Estimated** badge.
- Hotel results use the landed city and selected transport arrival date. `/api/hotels/search` asks optional
  Duffel Stays and LiteAPI for date-specific rates; missing access, failed calls or no matches retain the bundled
  city catalogue or deterministic local fallback, marked estimated. Hostels keep their own estimate fallback.
  Results can be filtered to 2–5 stars or hostels, support 1–4 occupants, calculate the required rooms, and rank
  by a weighted nightly price and distance-to-city-centre score.
- Duffel production flight offers are live quotes from the airline, per passenger, shown without the Estimated badge. Test-mode inventory is marked Estimated and explicitly attributed as test data. Production offers
  expire within minutes, so they're for showing and later booking, not for storing as a price. Without a token,
  Travelpayouts covers every flight leg on its own.
- Travelpayouts fares are cached, per passenger, and not confirmed seats. Connecting summaries say intermediate legs
  are unknown rather than inventing airports.
- Seeded link-out providers (12Go, BusOnlineTicket, China rail, Korea, Taiwan, Thailand) carry published typical
  departure times with a cited source. A row without a cited time or fare isn't seeded.
- `official-ferries` adds cited typical operator timetables for Singapore–Batam (HarbourFront and Tanah Merah),
  Singapore–Bintan and Busan–Hakata, with independent directions, weekday restrictions and local arrival offsets.
  It is an offline **timetable** subset: no live seats or prices, no date-specific cancellation calendar. Every result
  shows its checked date and source. Batam durations are separately attributed reseller estimates; Camellia's Hakata
  arrival is the next-day disembarkation start. Check-in/border notes appear in the existing result source details.
- SkyPier–Taipa was removed: HKIA currently lists it as temporarily unavailable, and SkyPier is restricted to airside
  transfers. Old 12Go reverse routes still work but are explicitly **modelled estimates**, because the seed does not
  independently cite reverse departure times. BusOnlineTicket now exposes its existing source and checked date.
- [Boats and borders findings](findings/boats-and-borders.md) records all candidates and remaining gaps. Live ferry,
  HK cross-border coach, China–Laos rail and additional international sea coverage require verified source access;
  an affiliate ID does not unlock an undocumented booking API.
- Ranking uses fixed FX estimates, duration, mode and transfers for ordering only. It never changes displayed fares,
  and unknown currencies never default to USD. The first row is a suggestion, not "cheapest".
- The currency setting converts displayed amounts only. Original fares stay visible.

## Credentials

Copy `.env.example` to `.env.local`. Every key is optional: a missing one makes that provider report `NOT_CONFIGURED`
and the app still runs on seeds and estimates.

| Var | Provider | Where to get it |
|---|---|---|
| `DUFFEL_ACCESS_TOKEN` | Live flights and hotel rates | app.duffel.com → Developers → Access tokens. Self-serve; a test token only returns Duffel Airways and test hotels. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Booking a leg | dashboard.stripe.com → Developers → API keys; the webhook secret from `stripe listen`. Without the key, paying is a no-charge test checkout. See `docs/booking/README.md`. |
| `SUPABASE_SECRET_KEY`, `BOOKING_ENCRYPTION_KEY` | Booking a leg | Supabase → Project Settings → API keys; `openssl rand -base64 32`. Without them, booking rows live in memory. |
| `TRAVELPAYOUTS_TOKEN`, `_MARKER`, `_TRS` | Flights, 12Go links | app.travelpayouts.com → Profile → API token. Marker is the partner ID on the dashboard; TRS is the project ID. |
| `TWELVEGO_AFFILIATE_ID` | 12Go link attribution only | agent.12go.asia (form review); live API access is separate and not implemented. |
| `LITEAPI_API_KEY` | Optional live hotel rates | Owner-approved LiteAPI production account; explicit guest nationality required. |
| `TDX_CLIENT_ID`, `TDX_CLIENT_SECRET` | Taiwan | tdx.transportdata.tw/register → 會員中心 → API金鑰. Non-Taiwan phones need manual review. |
| `DATA_GO_KR_SERVICE_KEY` | Korea | data.go.kr → each API's 활용신청. Store the **decoding** key. Signup needs Korean identity verification. |
| `TRIPCOM_AFFILIATE_ID` | China rail link-out | Trip.com affiliate portal |
| `BOT_REFERER_ID` | BusOnlineTicket link attribution only | busonlineticket.com/affiliate-program (manual approval); XML API access requires separate documentation. |
| `LTA_DATAMALL_ACCOUNT_KEY` | Singapore GTFS | datamall.lta.gov.sg → request for API |
| `MOBILITYDB_REFRESH_TOKEN` | GTFS discovery (build time) | mobilitydatabase.org account |
| `TRANSITLAND_API_KEY` | Live departures (optional) | transit.land, Explorer plan (non-commercial) |
| `DATA_GOV_MY_API_TOKEN` | Malaysia (optional) | Not needed for GTFS downloads |

Rome2rio no longer accepts API partners, and Amadeus Self-Service shut down on 2026-07-17. Don't use either.

## Checks

```sh
pnpm test
pnpm lint
python3 scripts/snapshot-hubs.py --check
BASE_URL=http://localhost:3000 node scripts/smoke-transport-review.mts  # eight app-route checks
node scripts/benchmark-hub-hover.mts  # offline hover scan and dataset size
node --env-file-if-exists=.env.local scripts/smoke-long-haul.mts 2026-11-15  # Duffel + Travelpayouts adapters
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ferry-sources.mts --check # monthly source review
node --env-file-if-exists=.env.local scripts/smoke-flights.mts HKG PVG 2026-11-15  # real Travelpayouts call
BASE_URL=http://localhost:3015 node scripts/smoke-globe.mjs                       # browser check against pnpm start
```

`smoke-flights` writes a secret-free report to `.cache/live-api-check.json`. A `200` with zero fares confirms access,
not route availability.

## File map

| File | Responsibility |
| --- | --- |
| `src/components/trip-globe/engine.ts` | Picking, throttled hover preview, exact click events |
| `src/lib/transport/hubs/` | Bundled hubs, provenance, pairing (`resolve.ts`), hover lookup (`preview.ts`) |
| `src/lib/transport/client-query.ts` | Click coordinates and local date serialisation |
| `src/lib/transport/query.ts` | Request validation |
| `src/lib/transport/registry.ts` | The provider list. Each provider lives in `providers/<id>/index.ts`. |
| `src/lib/transport/hub-search.ts` | Bounded pair searches, merge, dedup, estimate IDs |
| `src/lib/transport/search.ts` | Provider isolation, offer validation, ordering |
| `src/app/api/transport/search/route.ts` | The search route |
| `src/components/ticket-search/` | The landing ticket: offers, estimates, nearby hubs, attribution |

## Long-haul coverage

Global airports use the same pinned OurAirports source and bounded pair search. Overnight and date-line
arrivals show their destination calendar date in both Best and Flights rows; unknown local clocks stay hidden.
[Ticket D findings](findings/flights.md) record airline-access limits, source choices and live probe evidence.
A Duffel test token proves API wiring only. A missing cached fare is not evidence that a route does not operate.

## Live stays (Ticket E)

`/api/hotels/search` runs optional Duffel Stays and LiteAPI searches in parallel within a shared 8-second deadline, preferring
Duffel when it has matching hotels. `LITEAPI_API_KEY` is an optional **server-only** key from an owner-approved
LiteAPI account. No key, missing guest nationality, sandbox credentials/results, provider errors, timeout, empty
inventory or invalid quotes preserve the existing local hotel/hostel estimates. No account or key is needed to search.

LiteAPI covers coordinate-based hotel searches in Hong Kong, Shanghai, Seoul, Tokyo and elsewhere, subject to actual
inventory and account access. The hotel panel's optional guest-nationality selector supplies the required ISO-2
nationality; it is never inferred from a destination. Each live rate identifies its provider, requested dates and party.
Public selling-price floors and complete room allocations are checked. Rates with additional local charges are
excluded until those charges can be displayed. Hotel details and rates are fetched without persistent caching.
Live quotes are not linked to another seller's checkout. Hostels still show **Estimated**: no dedicated hostel source
has been approved yet.

[Research and rejected sources](findings/stays.md) records commercial/access gates, caching/display requirements and
hostel follow-up. Tests use offline documentation-shaped fixtures, not claimed production availability. After the owner
configures a permitted production key in the app server, run the read-only smoke check with actual dates/nationality:

```sh
node scripts/stays-smoke.mts http://localhost:3000 2027-01-15 2027-01-18 HK
```

It reports source/freshness for all four demo cities and exits 2 when any only returns estimates. It never books.

## Train data refresh and remaining access gates

[Train findings](findings/trains.md) records official and rejected sources for all seven brief corridors.
No train provider currently confirms seats or sells a booking through an API. Train schedules remain `timetable`
and display Estimated. China rail now omits its former duration-based invented fare; the source contains no price.
China rail, Korail, THSR and SRT offers carry their actual seed source and checked date.

- **KTMB:** independently refresh the published official GTFS without depending on Thailand's server:
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/refresh-ktmb.mts`.
  `--check --min-days=7` checks the bundled horizon offline; refresh also rejects an upstream calendar with fewer
  than seven days left, an invalid feed or no usable rail pairs before writing anything. Other feeds survive,
  withdrawn KTMB services are removed, and service dates are never extended. On 2026-10-03 the live official feed
  still ends **2026-10-17** (18 city pairs, 163 departures); the November demo cannot use that feed yet.
  The workflow `.github/workflows/refresh-ktmb.yml` prepares a daily artifact at 04:15 Malaysia time, with a SHA-256
  download report. It has read-only repo permissions and does not commit, open a PR or deploy. A maintainer must
  review/apply the artifact and deploy the snapshot to update the app. No API key is required.
- **Vietnam:** `vietnam-rail` supplies five typical Hanoi → Saigon and five reverse departures from the operator's
  published timetable. It preserves explicit next-day/two-day arrivals, including month/year boundaries. No price
  is invented. The page does not establish a service calendar, so attribution tells users to confirm the date.
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/snapshot-vietnam-trains.mts` refreshes a cached
  build-time snapshot (24-hour cache; `--fresh` bypasses it). Tests use recorded endpoint rows. Runtime never
  scrapes or depends on the source being online. The source has no robots.txt (404 observed 2026-10-03) or linked
  reuse terms; the script stops if robots.txt changes so its directives can be reviewed. This is not a claim of an
  open-data licence or permission for bulk redistribution.
- **Japan:** remains blocked for implementation; NAVITIME documents routing but requires licensed access, and the
  official JR basic PDF is not a complete dated service calendar. Do not label route tariffs as live inventory.
- **China/Korea/Taiwan/Thailand:** existing schedules remain available without keys. Genuine quotes/booking need
  approved operator or rail reseller access. TDX and TAGO are schedule/data sources, not booking contracts.
  A 12Go affiliate ID is insufficient: its API requires prior consent and separate confidential conditions.

Offline Vietnam snapshot verification: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/snapshot-vietnam-trains.mts --check`.
GTFS metadata distinguishes per-feed `refreshedAt` from the bundle's assembly `builtAt`; a KTMB refresh does not
claim a new Thailand download.

### Optional TDX dated THSR timetables

With both `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET`, the existing `tdx` provider now authenticates using the official
OAuth client-credentials endpoint and loads `/v2/Rail/THSR/DailyTimetable/TrainDate/{TrainDate}`. It queries the
requested and previous start dates to handle after-midnight boarding, uses destination **arrival** times, and keeps
all responses `timetable` (Estimated): this API does not quote fares or reserve seats. A bounded five-minute cache
reduces repeated requests; the supplied abort signal and an eight-second deadline cover authentication and both
reads. Missing keys retain existing seed behavior. Upstream/auth/schema/timeout failures use the bundled seeds
as `estimated` via the existing provider fallback, with an error in the search response. An authoritative empty
schedule remains empty, rather than inventing dated services from typical timetables. Taiwan bus seed behavior
continues as before; failure fallback also preserves those bus choices.

The current [official rail-v2 OpenAPI document](https://tdx.transportdata.tw/webapi/File/Swagger/V3/268fc230-2e04-471b-a728-a726167c1cfc)
was retrieved October 3. `tdx/__fixtures__/official-contract.json` records its relevant sections; the daily fixture
is explicitly synthetic contract-test data, not observed service. No authenticated call was verified because no
TDX credentials are configured. After authorized credentials are available, run:

```sh
node --env-file-if-exists=.env.local scripts/smoke-tdx.mts 2026-10-14
```

The report `.cache/tdx-smoke.json` contains only status/date/count, never credentials or access tokens. A successful
schedule call does not prove booking access or seat availability.

## Quote and arrival boundaries

Known destination-local arrival dates drive hotel searches and shared-trip nights, including overnight and
previous-day date-line arrivals. Estimated or unknown local schedules retain the departure-date fallback.
Hotel results belong to their complete query, including dates, occupants and nationality; stale rows disappear
while a replacement query runs. Saved stays are **planning estimates** because the current room model stores
only a nightly budget, not a provider quote's date, occupancy and rate restrictions. New hotel picks do not imply
live rates after a trip is retimed. Duffel test inventory is Estimated and the server rejects non-live choices at
booking settlement; the explicit opt-in booking test harness uses synthetic live-choice fixtures.
