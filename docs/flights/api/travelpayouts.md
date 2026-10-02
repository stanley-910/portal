# Travelpayouts / Aviasales — API ground truth
Checked: 2026-10-02 · Modes: flights · Seat: Cata

## Verdict
- **Data API: free, no approval.** Sign up, copy token, done. Aviasales program joined by default on signup (Terms 3.2). [S1][S9]
- **Real-time Flight Search API: gated. Effectively NOT available to us.** Needs ≥50,000 *confirmed* MAU, "no exceptions", pre-launch projects rejected. Do not apply. [S3][S4]
- Data API = **cached prices from Aviasales users' past searches** (48h window for v3 search methods; cache kept 2–7 days). Not live, not bookable, gaps on thin routes. Fine for "from $X" hints + price calendars. [S1][S2]
- Booking = **redirect to Aviasales** via `link` field / search URL + our partner ID (`marker`). No in-app booking.
- Biggest blocker: stale/sparse data (esp. SE Asia domestic routes on non-`ru` markets); default currency RUB, default market `ru` — must pass `currency` + `market` every call.
- Fallback if data empty: deep link to `https://www.aviasales.com/search/<PARAMS>` (no API needed). [S7]

## Access
| Item | Value |
|---|---|
| Signup | https://www.travelpayouts.com/ → app.travelpayouts.com (free) |
| Token | Profile → API token: https://app.travelpayouts.com/profile/api-token [S2] |
| Partner ID (`marker`) | Shown lower-left of dashboard [S8] |
| Project ID (`trs`) | Project list; needed for links API [S10] |
| Approval | Data API: none [S2][S9]. Aviasales program: default member [S11]. Some programs review Project ≤1 day [S12]; Search API: ≥50k MAU [S3] |
| Cookie | Partner ID cookie 30 days [S8] |
| Commercial | Allowed (affiliate model, we earn commission on bookings). Must follow Terms + affiliate agreement; promote only via TP tools on resources we own (Terms 3.5–3.6) [S11] |
| Attribution | No explicit "Powered by Aviasales" rule found for Data API — `unverified`. Don't imitate Aviasales/TP branding (Terms 6.5–6.6) [S11] |
| Recommended use | "inform users and generate content pages"; cache results 24h on our side [S2][S5] |

Env vars:
```
TRAVELPAYOUTS_TOKEN=      # X-Access-Token, server only
TRAVELPAYOUTS_MARKER=     # partner ID, safe to expose in links
TRAVELPAYOUTS_TRS=        # project ID, only for links/v1/create
```

## Auth + base URL
- Base: `https://api.travelpayouts.com`
- Auth: header `X-Access-Token: $TRAVELPAYOUTS_TOKEN` **or** query `token=` [S1]. Use header (keeps token out of logs/URLs).
- Send `Accept-Encoding: gzip, deflate` — docs "strongly recommend" [S1].
- Server-only: price endpoints return no `Access-Control-Allow-Origin` (observed: 401 w/o token, no ACAO). Token must never reach browser. Call from Next route handler.
- No-auth public: `autocomplete.travelpayouts.com/places2` (observed `access-control-allow-origin: *`), `api.travelpayouts.com/data/*.json` (observed 200 without token).
- Envelope: `{ success: bool, data: ..., error: string|null }`; dates ISO 8601 UTC; date params `YYYY-MM` or `YYYY-MM-DD` [S1].

## Endpoints we use
| Method + path | Purpose | Key params | Key response fields |
|---|---|---|---|
| GET `/aviasales/v3/prices_for_dates` | Cheapest tickets for dates/month (replaces v1 cheap/direct/city-directions, v2 latest) | `origin`,`destination` (IATA city/airport), `departure_at`,`return_at`, `one_way` (default true), `direct`, `currency` (default RUB), `market` (default ru), `sorting`=price\|route, `unique`, `limit` (≤1000, default 30), `page` | `origin`,`destination`,`origin_airport`,`destination_airport`,`price`,`airline`,`flight_number`,`departure_at`,`return_at`,`transfers`,`return_transfers`,`duration`,`duration_to`,`duration_back`,`link` |
| GET `/aviasales/v3/grouped_prices` | Cheapest per day or per month (replaces v1 calendar/monthly) | `origin`,`destination`,`group_by`=departure_at\|month,`departure_at`,`return_at`,`direct`,`min_trip_duration`,`max_trip_duration`,`currency`,`market` | map keyed by date → same fields as above |
| GET `/aviasales/v3/get_latest_prices` | Prices found in a period | `origin`,`destination`,`period_type`=year\|month\|day,`beginning_of_period`,`group_by`=dates\|directions,`one_way`,`sorting`,`trip_class` 0/1/2,`page`,`currency`,`market` | `origin`,`destination`,`depart_date`,`return_date`,`number_of_changes`,`value`,`found_at`,`distance`,`actual` |
| GET `/v2/prices/month-matrix` | Price calendar for a month | `origin`,`destination`,`month` (YYYY-MM-DD),`show_to_affiliates`,`one_way`,`trip_duration` (weeks),`limit` (30/31),`currency`,`market` | `depart_date`,`value`,`number_of_changes`,`found_at`,`trip_class`,`actual` |
| GET `/v2/prices/week-matrix` | ±3/4 days around dates | `origin`,`destination`,`depart_date`,`return_date`,`show_to_affiliates`,`currency`,`market` | as month-matrix |
| GET `/v2/prices/nearest-places-matrix` | Alt nearby airports | `origin`,`destination`,`limit` 1–20,`distance`,`flexibility` 0–7,`depart_date`,`return_date` | top-level `prices[]`,`origins`,`destinations`,`errors` (not `data`!) |
| GET `/v1/prices/cheap` | Legacy cheapest 0/1/2 stops | `origin`,`destination`,`depart_date`,`return_date` (yyyy-mm),`page`,`currency`,`market` | `data[DEST]["0".."2"]` → `price`,`airline`,`flight_number`,`departure_at`,`return_at`,`expires_at` |
| GET `/aviasales/v3/search_by_price_range` | Tickets within budget | `origin`,`destination`,`value_min`,`value_max`,`one_way`,`direct`,`locale`,`currency`,`market`,`limit`,`page` | `departure_at`,`origin_code`,`destination_code`,`destination_name`,`price`,`transfers`,`duration`,`link` |
| GET `/aviasales/v3/get_special_offers` | Abnormally low fares | `origin` (else from IP),`destination`,`airline`,`locale`,`currency`,`market` | `price`,`airline_title`,`title`,`link`,`search_id`,`signature` |
| GET `/aviasales/v3/get_popular_directions` | Popular origins to a destination | `destination`,`locale`,`currency`,`limit` 1–30,`page` | `data.destination.city_name`, `data.origin[].city_iata`,`price`,`departure_at` |
| GET `/data/en/airports.json` · `/data/en/cities.json` · `/data/en/airlines.json` · `/data/en/countries.json` | Static reference data (no token, observed) | — | airports: `code`,`city_code`,`country_code`,`time_zone`,`iata_type`,`coordinates`,`flightable`; airlines: `code`,`name`,`is_lowcost` |
| GET `https://autocomplete.travelpayouts.com/places2` | Place autocomplete (no token) | `term`,`locale`,`types[]`=city\|airport\|country | `type`,`code`,`name`,`country_code`,`city_code`,`coordinates`,`weight` |
| GET `http://pics.avs.io/{w}/{h}/{IATA}.png` | Airline logo | — | image (observed 301 → follow redirects) |

Sources: endpoints [S1], data files [S6], autocomplete [S13].

Example (docs URL shape, header auth):
```bash
curl -s --compressed -H "X-Access-Token: $TRAVELPAYOUTS_TOKEN" \
 "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=BKK&destination=HKT&departure_at=2026-11&one_way=true&direct=false&sorting=price&currency=usd&market=us&limit=30&page=1"
```
Response (from docs [S1], trimmed; MAD→BCN example):
```json
{ "success": true,
  "data": [{ "origin": "MAD", "destination": "BCN", "origin_airport": "MAD", "destination_airport": "BCN",
    "price": 5929, "airline": "IB", "flight_number": "3002",
    "departure_at": "2023-07-28T07:00:00+02:00", "return_at": "2023-08-26T14:30:00+02:00",
    "transfers": 0, "return_transfers": 0, "duration": 165, "duration_to": 80, "duration_back": 85,
    "link": "/search/MAD2807BCN26081?t=IB1690...&search_date=11052023&expected_price_uuid=...&expected_price_currency=usd" }] }
```
(Docs list `currency` as a response field but the example omits it — check placement on first real call.)
Autocomplete (observed 2026-10-02, `term=Bangk`): `[{"type":"city","code":"BKK","name":"Bangkok","country_code":"TH","coordinates":{"lon":100.50,"lat":13.75},"weight":216126,...},{"type":"airport","code":"DMK","city_code":"BKK",...}]`

### Booking deep link
| Form | Format |
|---|---|
| From API `link` | `https://www.aviasales.com` + `link` (path starts `/search/...`) [S1] |
| Search results | `https://www.aviasales.com/search/{ORIG}{DDMM}{DEST}[{DDMM}][class]{adults}[children][infants]` e.g. `PAR1607NYC2007c321`; class: none=economy, `c` business, `w` premium, `f` first; **adults mandatory**; case-sensitive [S7] |
| Pre-filled form | `https://www.aviasales.com/?params=PARAMS` [S7] |
| Make it a partner link | `POST https://api.travelpayouts.com/links/v1/create` header `X-Access-Token`, body `{trs, marker, shorten, links:[{url, sub_id?}]}` → `result.links[].partner_url`; ≤100 req/min/marker, ≤10 links/req [S10] |
| Raw `marker=` query param on aviasales URL | Docs say verify `marker=` appears in expanded link [S7]; appending it by hand ourselves = `unverified` — use links API |

## Limits
| Item | Value |
|---|---|
| Rate (per minute, since 2024-06-14) | `v3/prices_for_dates` 600, `v3/grouped_prices` 600, `v3/get_latest_prices` 300, `v3/search_by_price_range` 600, `v3/get_special_offers` 600, `v3/get_popular_directions` 600, `v2/prices/month-matrix` 300, `v2/prices/week-matrix` 60, `v2/prices/nearest-places-matrix` 60, `v1/prices/cheap` 300, `v1/prices/direct` 180, `v1/prices/calendar` 300, `/data/*.json` 600 [S5] |
| Over limit | 429; blocked until the minute window resets [S5] |
| Headers | `X-Rate-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Reset` (seconds) [S5] |
| Scope of limit | per token? per IP? — not stated → `unverified` |
| Staleness | v3 search methods: tickets found "in the last 48 hours" [S1]. Cache stored "7 days" (Data API page) vs "2 to 7 days depending on type" (access page) — docs disagree [S1][S2]. v1 has `expires_at`; don't show expired prices [S1] |
| Our caching | Docs recommend 24h cache [S9]. Data files: `s-maxage=86400` (observed) |
| Pagination | `limit` + `page` (v3); `page` of 100 (v1 cheap) [S1] |
| Search API (n/a to us) | 100 req/h per user IP; results live ~15 min [S4][S9] |

## Coverage
- Flights only, worldwide, whatever Aviasales users searched. Cached prices, not schedules, not availability. [S1]
- **Market matters**: cache split by market (e.g. `ru`, `us`); default from origin, fallback `ru` [S1]. Try `market=us` / `th`; list in Google Sheet linked from [S1].
- `show_to_affiliates=true` (v2 default) = only prices found via partner markers → fewer results; set `false` for more [S1].
- Currency conversion table (RUB base): `http://yasen.aviasales.com/adaptors/currency.json` [S1] — `unverified` still live.

## Errors
| Case | Shape |
|---|---|
| Bad/missing token | HTTP 401, `text/plain` body `Unauthorized` (observed) |
| Rate limit | HTTP 429 [S5] |
| Logical error | `{"success": false, "data": {}, "error": "<short text>"}` [S1] |
| Old dates | no error, empty data [S1] |
| nearest-places no cache | `errors` contains "Some error occurred" [S1] |

## Gotchas
- **Default currency RUB, market ru.** Always send `currency=usd|eur|thb` + `market`. Docs example uses typo `cy=usd` — real param is `currency`.
- `price`/`value` are numbers in requested currency; docs list a `currency` field but examples place it inconsistently (top-level in v1/v3 special offers) — verify on first call; trust the `currency` we sent.
- Response shapes differ per version: v3 `data[]`, grouped_prices/v1 `data{key:...}`, nearest-places top-level `prices[]`. Normalise in one adapter.
- `one_way=true` on `prices_for_dates` returns **1 ticket per date group**; use `one_way=false` for more [S1].
- `origin`/`destination` are IATA *city or airport*; city code (BKK) ≠ airport code (DMK) — resolve via `cities.json`/`airports.json`.
- `link` is relative; prefix `https://www.aviasales.com`. Sold-out → redirects to new search [S1].
- Deprecated: `/v1/airline-directions` (since 2022-03-14), v1 cheap/direct/calendar/city-directions + v2 latest superseded by v3 [S1].
- Data API page: "To obtain access to the API to search for plane tickets ... send a request" — that's the gated Search API, not Data API.
- FAQ says Data API "does not have such restrictions" (rate) — outdated; per-minute table [S5] wins.
- Old Search API (`v1/flight_search`) EOL 2026-06-15; new one at `tickets-api.travelpayouts.com/search/affiliate/start` — still MAU-gated [S4].
- Search API rules (if ever): server-side only, no localhost IPs, no scraping, no mixing with other metasearch APIs, Book button per result [S14].

## Sources
| URL | What it confirms | Verified |
|---|---|---|
| [S1] https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API | All Data API endpoints, params, fields, auth header, RUB default, markets, 48h, link prefix | yes (updated 2026-09-06) |
| [S2] https://support.travelpayouts.com/hc/en-us/articles/203956083-Requirements-for-Aviasales-data-API-access | Free w/o restrictions, token in profile, 2–7 day cache | yes |
| [S3] https://support.travelpayouts.com/hc/en-us/articles/210995808-Requirements-for-Aviasales-Flight-Search-API-access | Search API ≥50k confirmed MAU, no exceptions | yes |
| [S4] https://support.travelpayouts.com/hc/en-us/articles/30565016140434-Aviasales-Flights-Search-API-real-time-and-multi-city-search | New Search API, 100 req/h/IP, headers, MAU gate | yes |
| [S5] https://support.travelpayouts.com/hc/en-us/articles/4402565416594-API-rate-limits | Per-minute limits, 429, rate headers | yes |
| [S6] https://support.travelpayouts.com/hc/en-us/articles/203956063-Base-of-IATA-codes | cities/airports/airlines JSON URLs | yes + observed |
| [S7] https://support.travelpayouts.com/hc/en-us/articles/5711895629714-Aviasales-affiliate-links | Search URL PARAMS format | yes |
| [S8] https://support.travelpayouts.com/hc/en-us/articles/203955653-ID-and-SubID-Affiliate-marker-and-additional-marker | marker = partner ID, 30-day cookie, SubID | yes |
| [S9] https://support.travelpayouts.com/hc/en-us/articles/204529267-FAQ-about-Aviasales-API | 24h cache advice, Search results 15 min | yes (partly outdated) |
| [S10] https://support.travelpayouts.com/hc/en-us/articles/25289759198226-API-for-Travelpayouts-partner-links | links/v1/create, limits | yes |
| [S11] https://support.travelpayouts.com/hc/en-us/articles/360004162111-Terms-of-the-Travelpayouts-Travel-Affiliate-Network | Default Aviasales membership, IP/branding rules | yes |
| [S12] https://support.travelpayouts.com/hc/en-us/articles/360012014540-How-long-does-Project-review-take | Review ≤1 day where required | yes |
| [S13] https://support.travelpayouts.com/hc/en-us/articles/360002322572-Autocomplete-API-for-countries-cities-and-airports-by-Aviasales | places2 params/fields | yes + observed |
| [S14] https://support.travelpayouts.com/hc/en-us/articles/34788165535250-Search-API-usage-rules | Search API usage rules | yes |
| https://support.travelpayouts.com/hc/en-us/articles/20384016664594 | Aviasales Data API "Requires brand approval: No", Search API "Yes" | yes |
| https://travelpayouts.github.io/slate/ | Dev docs + Postman (not read in full) | unverified |

Note: support.travelpayouts.com HTML returns 403 to bots; read via Zendesk JSON `https://support.travelpayouts.com/api/v2/help_center/en-us/articles/<id>.json`.
