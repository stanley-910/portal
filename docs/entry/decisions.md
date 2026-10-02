# Entry requirements decisions

What each party member's passport needs at each leg's destination (POR-20). The spec is in [spec.md](spec.md) and the source comparison is in [research.md](research.md).

## E1. A static snapshot, not a live API

**Status:** built, 2026-10-02

**Decision:** `pnpm entry` builds `src/data/entry-requirements.json` from files in `data/entry/`. The app and `/api/entry` read only that file. `pnpm build` fails if it is stale.

**Why:**
- The demo must never depend on a flaky API.
- No free source is authoritative. IATA Timatic is paid and airline-only, so the data has to be dated and labelled "check official sources" anyway.

## E2. Passport Index CSV as the baseline, hand-checked overrides on top

**Status:** built, 2026-10-02

**Decision:** the baseline is the tidy ISO-3 CSV from [visualpharm/visa-free-dataset](https://github.com/visualpharm/visa-free-dataset), pinned to a commit. Curated entries in `data/entry/curated/` override it. Each one needs an official source URL and a `verifiedAt` date, or the build fails.

**Why:** the CSV is free and broad, but wrong on the demo corridor. It says HKSAR → mainland is "visa free" (it needs a Home Return Permit), mainland → HK is "visa required" (it needs an exit-entry permit), and US → mainland is "e-visa" (it needs a visa, or the 240-hour transit).

**Affects:** dataset-only rules show the "estimated" badge. `data/entry/report.md` lists them.

## E3. Providers run at build time and never change a rule

**Status:** built, 2026-10-02

**Decision:** GOV.UK (British passports only) and Travel Buddy run with `pnpm entry --providers=…` and write committed snapshots to `data/entry/providers/`. They add links and dates. If a provider's verdict differs from ours, it goes in the build report for a person to resolve with a curated entry.

**Why:** the shipped data stays deterministic and reviewable, and Travel Buddy's free tier (120–200 requests a month) is never spent at runtime.

## E4. Rules key on passport, not departure country

**Status:** built, 2026-10-02

**Decision:** a British passport holder flying from Hong Kong still gets the GOV.UK link. A non-British traveller leaving London doesn't.

## E5. Entry is separate from the transport search

**Status:** built, 2026-10-02

**Decision:** entry is not a `TransportProvider` and stays out of the `fanOut` registry (core ADR-C02). The planner joins transport `Offer`s with `entry.getLegEntry` per rider. Lookup accepts ISO-2 or ISO-3, so `Place.country` passes straight through. `/api/entry` uses the transport search's flat query params (core ADR-C06) and its `BAD_QUERY` error.

**Why:** entry depends on each rider's passport, is static and needs no keys. Transport search is a keyed fan-out with timeouts.

## E6. Permits and transit are first-class

**Status:** built, 2026-10-02

**Decision:** the rule kinds include `entry_permit` and `transit_exempt`. Each rule has a `context` of `entry` or `transit`. `resolveLeg` uses the transit rule when the rider's onward country is a third country and the arrival hub is an eligible port. Otherwise it offers transit as a hint.

**Why:** HK, Macao and mainland travel uses permits, not visas, and China's 240-hour transit decides whether a US member can do the demo route without a visa.

## E7. The entry panel only shows for a real party

**Status:** decided, 2026-10-03

**Decision:** the globe screen no longer shows `EntryPanel` with the hard-coded `DEMO_PARTY`. It comes back once a trip has members with a nationality, from a listed citizenship or an account with a linked nationality. Until then it only appears in the `/design` gallery.

**Why:** with made-up travellers, the panel showed rows of "Estimated" and "No data" for most destinations, which said nothing about the people actually travelling.
