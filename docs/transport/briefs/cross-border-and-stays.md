# Brief: cross-border travel, overseas flights and stays

Three independent research-then-build tickets. Give each agent the shared context from
[`trains-and-boats.md`](trains-and-boats.md#shared-context) (the reliability ranking, provider rules and the findings
table it asks for), plus its own ticket below. Work in a worktree under
`~/worktrees/hku-hackathon/<YYYY-MM-DD>_<ticket>/`.

**The goal:** reliable, ideally live and bookable data for trips that cross a border or an ocean, and for where people
sleep when they get there. Booking itself is specced in `docs/booking/README.md`; prefer sources that could feed it.

What already exists, so nobody redoes it:

- Flights: Duffel (live, bookable) and Travelpayouts (cached fares plus estimates) in `src/lib/transport/providers/`.
- Ground and sea: typed-in timetables for a few corridors (`12go`, `busonlineticket`, `china-rail`, `gtfs`). The
  trains-and-boats brief covers making the domestic ones live.
- Stays: Duffel Stays is coded, but Duffel hasn't enabled it on our account yet ("contact sales"). Until then every
  hotel is an estimate from `src/lib/hotels/search.ts`.
- Entry rules: a bundled dataset in `src/data/entry-requirements.json`, built by `scripts/entry-requirements.mts`.

## Ticket C: crossing borders by land and sea

Crossings travellers in Asia actually make, in priority order. Find who runs each, who sells it, and whether any of them
has an API or a feed.

| # | Crossing | Today |
| --- | --- | --- |
| 1 | Hong Kong ↔ Shenzhen and Guangzhou by cross-border coach and rail | High-speed rail seed only; no coaches |
| 2 | Singapore ↔ Johor Bahru ↔ Kuala Lumpur by coach and the KTMB shuttle | BusOnlineTicket seed; KTMB feed ends 2026-10-17 |
| 3 | Bangkok ↔ Vientiane, Phnom Penh, Siem Reap; Vietnam ↔ Cambodia by coach | 12Go seed, 13 routes |
| 4 | Kunming ↔ Vientiane railway (China–Laos) | Nothing |
| 5 | Busan ↔ Fukuoka and Osaka ferries; China ↔ Korea ferries | Nothing |
| 6 | Singapore ↔ Batam and Bintan ferries | Hubs only, no provider |
| 7 | Malaysia ↔ Thailand by rail and coach (Padang Besar, Hat Yai) | GTFS feed (KTMB, Thai OTP) |

Also report, per crossing, anything at the border that changes the trip: a border that closes at night, a change of
vehicle, a visa-on-arrival point. A field on the offer is enough; don't build a border model.

Candidates to evaluate (unverified): operators' own sites, 12Go's agent API, Bookaway, BusOnlineTicket, Easybook,
Trip.com, Ferryhopper, Direct Ferries, and any government open-data feeds for the crossings.

## Ticket D: overseas and long-haul flights

Searching from Europe or North America returns nothing, and so does HK → London. Flight providers cover the world; the
limit is our bundled airport list, filtered to Asia's geography (`src/lib/transport/hubs/airports.json`,
`scripts/snapshot-hubs.py`, `src/lib/transport/hubs/DATA.md`).

1. Extend the airport snapshot to the world, or at least to the large airports of Europe, North America and Oceania,
   with the same provenance rules. Keep hover and landing fast: check the bundle size and the 80 ms hover scan.
2. Check that Duffel and Travelpayouts return sensible long-haul results for HK → London, Tokyo → San Francisco,
   Singapore → Sydney, including connections.
3. Check the arrival times and timezones on overnight flights, and that the ticket shows the arrival date when it's
   the next day.
4. Report which long-haul airlines Duffel can't sell, so we know where Travelpayouts is the only source.

Out of scope: ground transport outside Asia. Say in the findings which sources would cover Europe and North America
rail if we ever wanted it, without building it.

## Ticket E: stays

Find the most reliable source of live hotel rates for the demo cities first (Hong Kong, Shanghai, Seoul, Tokyo), then
the rest of Asia, ideally one that can also book.

- Plug into the existing seam: `searchDuffelStays` in `src/lib/hotels/duffel.ts` shows the shape. A new source returns
  stays the hotel tab ranks (`rankStays`), with `freshness: "live"` only for rates quoted for those dates, and falls
  back to the estimates when it has no key, fails or finds nothing.
- Hostels matter: Duffel doesn't list them, and the hotel tab has a hostel filter.
- Report for each source: rate freshness, whether it can book, commission or fees, access requirements, and the
  terms on caching and showing rates.

Candidates to evaluate (unverified): Duffel Stays once enabled (ask Duffel what it needs), LiteAPI, Expedia Rapid,
Booking.com and Agoda affiliate programmes, Trip.com, Hotelbeds, and Hostelworld for hostels.

## Done means

The same as the trains-and-boats brief: results from the new source in the app with the right freshness, the old
behaviour when the key is unset or the source is down, `pnpm test` and `pnpm lint` passing, and the findings table,
including rejected sources, in the PR description. Stop and ask before signing a contract, paying for access, or using
a personal identity to sign up.
