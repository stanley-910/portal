# Brief: live train and boat providers

Two independent tickets, one for trains and one for boats. Give each agent the shared context plus its own ticket.
Work in a worktree under `~/worktrees/hku-hackathon/<YYYY-MM-DD>_<trains|boats>/`. Read `AGENTS.md`,
`docs/transport/README.md` and `src/lib/transport/types.ts` before writing code.

## Shared context

**The goal:** train and boat results that are live and reliable, from sources that can later take bookings in the app.
Today no train or boat result is live. Every one comes from a timetable typed into the repo
(`src/lib/transport/providers/*/seed.json`) and links out to someone else's booking site.

**Rank sources by reliability, best first:**

1. Official operator API
2. Partner or agent API that can book, such as a reseller's B2B API
3. Published open feed (GTFS or similar) downloaded by a script and refreshed on a schedule
4. Scraping at build time into a bundled seed, with a refresh script
5. Scraping at request time, only behind a seed fallback and only where the site's terms allow it

Scraping is allowed when nothing better exists. Check the site's terms and robots.txt, cache aggressively, and record
what you found in the provider's attribution.

**Rules that apply to every provider:**

- One provider per `src/lib/transport/providers/<id>/index.ts`, added to `registry.ts` and the `ProviderId` union.
  Adding one never means editing the others.
- `covers()` is cheap and makes no network call. `search()` throws `ProviderFailure` codes; it never returns invented
  times or fares.
- Be honest about freshness with `kind`: `live` only for a quote fetched at request time. Cached, timetable and
  modelled data keep their own kinds, which the UI shows as "Estimated".
- The demo must never depend on a flaky API. A live provider keeps a bundled seed fallback for the demo corridors.
- Provider calls run only on the server, and keys live in `src/lib/env.server.ts`. Every key is optional; a missing
  one means `NOT_CONFIGURED` and the app still works.
- Each provider has an 8-second deadline. Pass the abort signal through.
- Tests use recorded fixtures, never the network. Add a smoke script for a real call if the source needs a key.
- Don't use Amadeus Self-Service (shut down 2026-07-17) or Rome2rio (no new API partners).
- If a station or terminal is missing from `src/lib/transport/hubs/surface-hubs.json` or `connections.json`, add it
  with its source in `src/lib/transport/hubs/DATA.md`.

**What to hand back, before any code:**

A findings table, one row per candidate source:

| Source | Corridors covered | Live fares? | Live seats? | Can book via API? | Access (key, contract, identity checks) | Terms on scraping | Reliability notes |
| --- | --- | --- | --- | --- | --- | --- | --- |

Then pick one source per corridor, say why, and implement it. Update `docs/transport/README.md` (coverage, credentials
table) in the same change. Stop and ask before signing any contract, paying for access, or using a personal identity
for a signup.

## Ticket A: trains

Corridors in priority order. The first is in the demo.

| # | Corridor | Today | Gap |
| --- | --- | --- | --- |
| 1 | Hong Kong West Kowloon ↔ Shenzhen, Guangzhou, Shanghai, Beijing (high-speed rail) | `china-rail` seed, 70 trains, Trip.com link | Not live; demo leg 1 |
| 2 | Kuala Lumpur, Penang, Ipoh, Johor Bahru, Singapore shuttle (KTMB) | GTFS downloaded once, `gtfs` provider | **The feed ends 2026-10-17.** Script the refresh first; it's the quickest fix |
| 3 | Tokyo, Kyoto, Osaka, Hakata (Shinkansen) | Nothing; the links exist in `connections.json` | No provider at all |
| 4 | Seoul ↔ Busan and other KTX lines | `korea-tago` seed | Not live; data.go.kr needs Korean identity checks |
| 5 | Taiwan high-speed rail | `tdx` seed | Not live; a TDX key needs manual review outside Taiwan |
| 6 | Bangkok ↔ Chiang Mai and other SRT lines | `srt` seed | Not live |
| 7 | Hanoi ↔ Saigon | Nothing; the link exists in `connections.json` | No provider at all |

Candidates to evaluate (unverified, check each yourself): official operator sites and APIs (China Railway 12306,
MTR for the Hong Kong section, JR group sites, Korail, THSR, SRT, Vietnam Railways), resellers with partner APIs
(Trip.com, 12Go, Klook), and Japanese route-search APIs.

## Ticket B: boats

| # | Corridor | Today | Gap |
| --- | --- | --- | --- |
| 1 | Hong Kong ↔ Macau (Outer Harbour, Taipa, SkyPier) | `12go` seed, 10 departures | Not live |
| 2 | Singapore ↔ Batam (HarbourFront, Tanah Merah) | Terminals are hubs; no provider | No results at all |
| 3 | Thai islands: Donsak ↔ Samui and Phangan, Phuket ↔ Phi Phi, Lanta ↔ Lipe | `12go` seed | Not live |
| 4 | Bali: Sanur ↔ Nusa Penida, Padang Bai ↔ Gili Trawangan | `12go` seed | Not live |
| 5 | Korea ↔ Japan (Busan ↔ Fukuoka) | Terminals are hubs; no provider | No results at all |

Candidates to evaluate (unverified, check each yourself): operators' own booking sites (the Hong Kong–Macau and
Singapore–Batam operators), 12Go's agent API (`TWELVEGO_AFFILIATE_ID` is empty today), and other ferry resellers
with partner APIs.

## Done means

- The corridor returns results from the new source in `/api/transport/search`, with the right `kind` and a cited source.
- With the key unset or the source down, the corridor still returns its seed results.
- `pnpm test` and `pnpm lint` pass.
- The findings table is in the PR description, including the sources you rejected and why.
