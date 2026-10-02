# Rome2Rio — API ground truth
Checked: 2026-10-02 · Modes: trains, buses (multimodal: also air, ferry, car, walk) · Seat: Ahmet

## Verdict
- **Not available. Do not plan on it.** API page said "Unfortunately, we are currently **not accepting new applications**" (archived 2024-10-09). By 2026-08-23 `/documentation/` itself is **404**. [S1][S2]
- Old free host `free.rome2rio.com` **does not resolve** (DNS NXDOMAIN, observed 2026-10-02). Old RapidAPI listing gone ("API not found"). [O1][S5]
- Live site behind Cloudflare challenge (HTTP 403 "Just a moment…" to curl) → scraping = blocked + was ToS-forbidden ("You mustn't scrape our site"). [O1][S3]
- No public affiliate/widget for embedding search found on current site; footer now only "Advertise", "Get Listed" (operators). Deep link to rome2rio.com page = only option, no commission program found `unverified`.
- Biggest blocker: product no longer offered to new partners. Fallback: Google Routes API `TRANSIT` (paid, billing account; pricing `unverified`), Transitous (free, non-commercial, open-source only), our own per-country providers (TDX, data.go.kr, GTFS).

## Access
| Path | Status | Source |
|---|---|---|
| Rome2rio API partner signup (`/partners/signup`) | last archived 2019; now not accepting | [S1][S3] |
| `/documentation/` | 2024: "not accepting new applications"; 2026-08: 404 | [S1][S2] |
| RapidAPI `rome2rio-12` | "API not found"; gateway 403 "not subscribed" for grandfathered | [S5] unverified |
| Grandfathered partners | may still have keys; we don't | [S5] unverified |

Historic ToS (2019 signup page, for context) [S3]: must show attribution; **no caching/storing data**; no SEO use; no scraping; free tier 1 concurrent request, **300 req/hour**, 429 on exceed.

Env vars:
```
# ROME2RIO_API_KEY — do not add; key unobtainable
GOOGLE_MAPS_API_KEY=       # fallback: Routes API computeRoutes TRANSIT (server only)
# Transitous needs no key (non-commercial only)
```

## Auth + base URL
- Historic: `http://free.rome2rio.com/api/1.4/{json|xml}/Search?key=…` — host dead now. [S4][O1]
- Nothing current.

## Endpoints we use
None from Rome2Rio. Historic v1.4 Search shape for reference only (if a grandfathered key ever appears) [S4]:

| Op | Purpose | Key params | Key response fields |
|---|---|---|---|
| `GET /api/1.4/json/Search` | multimodal A→B | `key`, `oName`/`dName` or `oPos`/`dPos` (lat,lng), `oKind`/`dKind`, `currencyCode`, `languageCode`, flags `noAir noRail noBus noFerry noCar noRideshare noPrice noStop`… | `elapsedTime currencyCode languageCode places[] airlines[] aircrafts[] agencies[] vehicles[] routes[]` (entities referenced by index) |
| `GET /api/1.4/json/Geocode`, `Autocomplete` | place lookup | `query` | `unverified` |
- Docs note: "Rome2Rio does not provide live transit prices or airfares through this API" — indicative prices only. [S4]

Fallback example — Google Routes API transit (docs shape; requires billing account):
```bash
curl -s -X POST https://routes.googleapis.com/directions/v2:computeRoutes \
  -H "Content-Type: application/json" \
  -H "X-Goog-Api-Key: $GOOGLE_MAPS_API_KEY" \
  -H "X-Goog-FieldMask: routes.duration,routes.legs.steps.transitDetails" \
  -d '{"origin":{"address":"Taipei Main Station"},"destination":{"address":"Zuoying Station"},
       "travelMode":"TRANSIT","computeAlternativeRoutes":true}'
```
Response: `routes[].legs[].steps[].transitDetails{stopDetails,transitLine,…}` (field list per Google docs; not observed here). [S6]

## Limits
- Rome2Rio: n/a. Historic free: 300/h, 1 concurrent. [S3]
- Google Routes TRANSIT: no intermediate waypoints; `departureTime`/`arrivalTime` within −7 d … +100 d; field mask mandatory; up to 3 alternatives. Pricing/quota: see Google pricing page `unverified` here. [S6]
- Transitous: free only if project open-source **and** non-commercial **and** light on resources; must link https://transitous.org/sources/ visibly; base `https://api.transitous.org/api/` (MOTIS 2 API). [S7]

## Coverage
- Rome2Rio: n/a.
- Google transit: varies by region; China mainland transit not offered (`unverified`); Korea transit supported (`unverified`).
- Transitous: whatever GTFS feeds are aggregated — check https://transitous.org/sources/ per country. [S7]

## Errors
- Historic: 429 Too Many Requests on rate limit [S3]. Current: DNS failure / Cloudflare 403. [O1]

## Gotchas
- Old blog posts / third-party "Rome2rio API integration" sellers (adivaha etc.) still advertise it — marketing, not access.
- api-evangelist GitHub profile lists `free.rome2rio.com/api/1.4` as if live — it isn't. [O1]
- Even if key existed, ToS banned caching → conflicts with our cache-everything strategy.
- Transitous non-commercial clause: OK for hackathon demo if repo open-source; re-check before any launch.

## Sources
| URL | What it confirms | Verified |
|---|---|---|
| [S1] https://web.archive.org/web/20241009043313/https://www.rome2rio.com/documentation/ | "currently not accepting new applications" | yes (archive of primary) |
| [S2] https://web.archive.org/web/20260823163903/https://www.rome2rio.com/documentation/ | 404 Page not found, © 2026 | yes (archive of primary) |
| [S3] https://web.archive.org/web/20191104201939/https://www.rome2rio.com/partners/signup | partner ToS: attribution, no cache, no scrape; free 300/h, 1 concurrent, 429 | yes (archive, 2019) |
| [S4] https://web.archive.org/web/20240502161024/https://www.rome2rio.com/documentation/1-4/search/ | v1.4 Search URL, params, response fields, no live prices | yes (archive) |
| [S5] https://github.com/mauriciabad/flights/issues/7 | RapidAPI listing gone, 403 not subscribed | unverified (secondary) |
| [S6] https://developers.google.com/maps/documentation/routes/transit-route | computeRoutes TRANSIT, field mask, limits | yes |
| [S7] https://transitous.org/api/ | usage policy, base URL, attribution | yes |
| [O1] dig/curl 2026-10-02 | `free.rome2rio.com` unresolvable; www → Cloudflare 403 | observed |
