# Ticket D findings: global airports and long-haul flights

Research: 2026-10-03. Findings recorded before implementation. No signup, paid access or airline enablement requested.

| Source | Corridors covered | Live fares? | Live seats? | Can book via API? | Access (key, contract, identity checks) | Terms on scraping | Reliability notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [OurAirports](https://ourairports.com/data/) | Worldwide airport locations | No | No | No | Public-domain download, no key | No scraping needed | Keep existing pinned CSV and checksum; remove Asia geography filter, retain scheduled service/IATA/type filters. Geography is not route availability. |
| [Duffel](https://duffel.com/docs/api/offer-requests) | HKG–LHR, HND–SFO, SIN–SYD eligible, connections allowed | Yes in live mode | Returned offer only, reprice before purchase | Yes | Existing token; live account/airline access required | Use documented API | Configured token is test mode. Synthetic test airline results cannot prove commercial airline coverage. |
| [Travelpayouts Data API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API) | Worldwide, subject to recent searches in cache | No, cached | No | Link-out only through this API | Existing partner token | Use documented API | Empty cache does not mean no flight; retain modelled fallback and explicit connection count. |
| [Rail Europe RailAPI](https://agent.raileurope.com/) | European rail, future scope | Partner quote | Subject to partner inventory | Yes | Commercial partner onboarding | No scraping selected | Rejected for this ticket: non-Asian ground travel is out of scope. |
| [Amtrak GTFS realtime](https://media.amtrak.com/2023/11/amtrak-fiscal-year-2023-ridership-exceeds-expectations-as-demand-for-passenger-rail-soars/) | US and some cross-border rail, future scope | No | No | Not through GTFS | Feed access/licence needs a separate review | No scraping selected | Operator confirms schedule/status feeds; no claim that they expose fares or booking. Out of scope. |

## Choices and limits

Use OurAirports for all world scheduled-service airports with IATA codes. Keep Duffel live quotes and Travelpayouts cached fares/modelled fallback for all three routes. No new provider is needed.

[Published Duffel airline coverage](https://duffel.com/flights/airlines) lists Cathay Pacific, ANA, Japan Airlines, Korean Air, Qatar and others through Travelport; British Airways, United, Singapore Airlines, Qantas and others have direct connections. This is not the same as this account being enabled for them. [Airline access is requested per account](https://help.duffel.com/hc/en-gb/articles/4402097037586-Requesting-access-to-new-airlines), and the [airlines resource](https://duffel.com/docs/api/airlines) is a reference catalogue, not an account entitlement list. The published list omits ZIPAIR, Air Premia and Norse Atlantic, and labels Scandinavian Airlines as coming soon. Treat these as unverified coverage gaps requiring Duffel confirmation, not an authoritative cannot-sell blacklist. The configured test token cannot establish which real airlines this account can sell. Travelpayouts may have cached fares for a gap; it is not guaranteed and cannot book via the Data API.

## Validation

Implementation results, measurements and smoke evidence will be appended below. Tests use offline fixtures. Live probes report only route, aggregate counts, status and provider mode, never credentials.

- Global snapshot: 4,008 airports in 233 country/territory codes (formerly 1,271/55), unchanged source pin/checksum.
- Hover benchmark (`node scripts/benchmark-hub-hover.mts`): 1,000 scans, median 0.21 ms, p95 0.65 ms,
  max 1.60 ms on this host, against the unchanged 80 ms throttle. This is a Node scan benchmark, not a mobile
  browser frame-time guarantee. Airport JSON: 1,542,287 source bytes; minified 1,253,709 bytes / gzip 184,234 bytes.
- Real adapter probes for 2026-11-15: Duffel test API returned 12 mapped offers on each route with connections
  (HKG–LHR 8, HND–SFO 9, SIN–SYD 6); these are synthetic inventory. Travelpayouts returned one cached connecting
  HKG–LHR fare and one cached nonstop SIN–SYD fare; HND–SFO used the modelled fallback.
- Fixed a pre-existing freshness issue exposed by the probe: Duffel `live_mode: false` now yields Estimated,
  with explicit test-inventory attribution. This also prevents the booking flow from treating test inventory as a live quote.
- Added arrival calendar dates on Best/Flights rows, including previous-day and +2-day date-line cases.
- Added checks for disconnected or backwards Duffel connections; tests retain known offset/UTC durations.
- `scripts/smoke-long-haul.mts` runs production adapters through the installed Vitest/Vite loader and writes
  only sanitized diagnostics to `.cache/long-haul-check.json`. It does not place orders. No new runtime dependency.
