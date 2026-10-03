# TODO: real transit listings cached for a simulated booking demo

Requested 2026-10-03. This is queued work, not a claim that the cache or simulated checkout is complete.
The immediate goal is real, source-backed listings available offline for a demo, with a clearly simulated booking
path. Commercial live booking access is not a prerequisite for this phase. Build-time scripts and browser-assisted
collection are authorized; prefer official feeds where available and cache publicly accessible listings otherwise.

## Collection checklist

- [ ] China: expand beyond the current 70 entries to major high-speed corridors and stations nationwide. Collect
  China Railway 12306/MTR published information, cross-check with Trip.com/Klook where useful. Include HK–Guangzhou,
  currently absent from the seed, and record uncovered routes explicitly. Do not call a curated sample all China rail.
- [ ] Taiwan: THSR full main-line station/stop coverage, both directions, weekday and service-date exceptions;
  use official published timetables or TDX when credentials exist.
- [ ] Japan: JR Central/West/East/Kyushu/Hokkaido Shinkansen schedules, starting Tokyo–Kyoto–Osaka–Hakata;
  expand to Tohoku/Hokkaido, Hokuriku/Joetsu and Kyushu. Distinguish base schedules from additional trains.
- [ ] Korea: Korail KTX/KTX-Sancheon and SR SRT; start Seoul–Busan/Mokpo and cover major branches, both directions.
- [ ] Malaysia/Singapore: refresh KTMB ETS/intercity/Shuttle Tebrau; preserve actual upstream validity dates.
- [ ] Thailand: SRT intercity/night trains with dated schedules and accommodation classes when published.
- [ ] Vietnam: extend DSVN beyond endpoint-only trains to useful intermediate stops and service calendars.
- [ ] Ferries: all Ticket B corridors plus Bintan, Korea–Japan and China–Korea passenger services from Ticket C;
  collect dated/seasonal directional schedules, terminal eligibility and check-in cutoffs.
- [ ] Coaches/buses: all seven Ticket C corridor groups, including HK–Shenzhen/Guangzhou, SG–JB–KL,
  Thailand–Laos/Cambodia and Malaysia–Thailand; keep crossing/station-specific information.
- [ ] Flights: retain real cached provider listings for demo legs and long-haul examples; clearly separate Duffel
  sandbox inventory from real captured offers. Never turn an expired fare into bookable inventory.

Reuse the corridor lists in [trains and boats](trains-and-boats.md) and
[cross-border and stays](cross-border-and-stays.md), and the existing findings tables and rejected sources.
Coverage means named routes/services actually captured, not merely a provider logo or a station in the catalog.

## Script and cache requirements

- [ ] Implement repeatable provider-specific collection scripts; use browser capture when a public page needs
  rendering. Record source URL, retrieval timestamp, original evidence/hash and parser version. Respect access
  controls and rate limits; record blocked sources and use alternatives instead of bypassing login/CAPTCHA.
- [ ] Normalize operator, service number, mode, exact station/terminal IDs, direction, local departure/arrival,
  IANA timezones, overnight day offsets, service dates/weekdays/exceptions, class, and any explicitly published
  fare/currency/tax basis. Missing fares stay unknown; do not generate them from distance or journey time.
- [ ] Distinguish a dated cached quote from a recurring timetable. Store original queried dates/party/class and
  quote expiry where supplied; never silently shift a captured dated quote to a new date.
- [ ] Stage and validate updates atomically, preserve the last valid cache on failure, deduplicate listings, and
  produce a coverage/age report including failures and rejected sources. Schedule refresh where appropriate.
- [ ] Record terms/robots findings and source restrictions. No signup using personal identity, paid access,
  contract acceptance or provider outreach without specific approval, as required by the original briefs.

## Demo booking and acceptance

- [ ] Offline cached results appear through the existing provider registry with source attribution and Estimated
  freshness. Missing credentials/network keep the demo usable; runtime provider deadlines remain eight seconds.
- [ ] Add a visibly simulated reservation flow for cached transit: choose service/class/riders, review and receive
  a demo confirmation. No real charge, ticket issuance, supplier reservation or claim of current seat availability.
  Keep real Duffel/Stripe booking paths separate; simulated records must be distinguishable in storage and UI.
- [ ] Test both directions, weekday exceptions, overnight and timezone crossings, expired snapshots and fallback;
  fixtures stay offline. Run pnpm test and pnpm lint and verify the flow in the browser.
- [ ] Hand back the actual coverage matrix, cache dates, refresh commands and remaining gaps. Demonstrate the
  HK–Shanghai rail + Seoul–Shanghai flight + Shanghai–Tokyo flight route and representative rail/bus/ferry bookings.
