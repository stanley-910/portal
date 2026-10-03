# Transport search: clicks → hubs → offers

How a click on the globe becomes flights, trains, buses and ferries.

## The pipeline

1. The globe raycasts the pointer onto its sphere. `LandedTrip.origin` and `destination` are the exact clicked
   points in degrees. Search uses those points, not whichever hub was previewed.
2. The server resolves each point against bundled airports, train stations and passenger ferry terminals.
3. It ranks useful endpoint **pairs** and queries the relevant providers for a bounded shortlist. Airport codes stay
   airport codes: SHA never turns into a Shanghai city search or PVG.
4. Offers are validated and sorted deterministically. Cached fares, typical timetables and fallback candidates are
   marked **Estimated** with their source. Missing credentials and API failures never remove the local shortlist.
5. Cancelling or starting another trip aborts the old request, so late results can't restore a stale trip. Dates are
   the displayed local calendar date, not a sliced UTC timestamp.

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

The snapshot has **1,271 airports** (55 country and territory codes), **34 train stations**, **22 ferry terminals**
and **32 directed surface connections**. Surface coverage is a curated subset. No airport-to-airport service graph is
invented.

[`src/lib/transport/hubs/DATA.md`](../../src/lib/transport/hubs/DATA.md) records the pinned OurAirports source,
geography filter, licences and per-terminal caveats. The UI credits OurAirports, Wikidata and OpenStreetMap
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
- Each provider has its own 8-second deadline. One failure doesn't discard the others. An empty cache is not a
  failure or evidence that a route doesn't run.
- Provider calls happen only in route handlers on the Node runtime, so keys never reach the browser.

## Being honest about data

- Every offer says where it came from. Anything that isn't live shows an **Estimated** badge.
- Travelpayouts fares are cached, per passenger, and not confirmed seats. Connecting summaries say intermediate legs
  are unknown rather than inventing airports.
- Seeded link-out providers (12Go, BusOnlineTicket, China rail, Korea, Taiwan, Thailand) carry published typical
  departure times with a cited source. A row without a cited time or fare isn't seeded.
- Ranking uses fixed FX estimates, duration, mode and transfers for ordering only. It never changes displayed fares,
  and unknown currencies never default to USD. The first row is a suggestion, not "cheapest".
- The currency setting converts displayed amounts only. Original fares stay visible.

## Credentials

Copy `.env.example` to `.env.local`. Every key is optional: a missing one makes that provider report `NOT_CONFIGURED`
and the app still runs on seeds and estimates.

| Var | Provider | Where to get it |
|---|---|---|
| `TRAVELPAYOUTS_TOKEN`, `_MARKER`, `_TRS` | Flights, 12Go links | app.travelpayouts.com → Profile → API token. Marker is the partner ID on the dashboard; TRS is the project ID. |
| `TWELVEGO_AFFILIATE_ID` | 12Go | agent.12go.asia (form review) |
| `TDX_CLIENT_ID`, `TDX_CLIENT_SECRET` | Taiwan | tdx.transportdata.tw/register → 會員中心 → API金鑰. Non-Taiwan phones need manual review. |
| `DATA_GO_KR_SERVICE_KEY` | Korea | data.go.kr → each API's 활용신청. Store the **decoding** key. Signup needs Korean identity verification. |
| `TRIPCOM_AFFILIATE_ID` | China rail link-out | Trip.com affiliate portal |
| `BOT_REFERER_ID` | BusOnlineTicket | busonlineticket.com/affiliate-program (manual approval) |
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
