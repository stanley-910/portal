# Spec: entry requirements data (POR-20)

Status: implemented (MVP tasks 1–6). Research and source comparison: `docs/entry/research.md`. Decisions: `docs/entry/decisions.md`.

## As built

Where the implementation differs from the draft below, this section wins.

- **Code:** schema, build and lookup in `src/lib/entry/`; CLI in `scripts/entry-requirements.mts`; providers in
  `scripts/entry/providers/`; UI in `src/components/entry/`; API at `GET /api/entry`.
- **`entry_permit` kind** added. HK, Macao and mainland travel use permits, not visas: HKSAR → mainland needs the
  Home Return Permit, mainland → HK needs an EEP with endorsement. The dataset gets both wrong ("visa free" and
  "visa required"), so both are curated.
- **`context: "entry" | "transit"`** on every rule, so a pair can have both (USA → CHN is `visa_required` for entry
  and `transit_exempt` for transit). Curated entries take `passports: [...]` so the 57-nationality transit list is
  one entry, expanded to the configured passports at build time.
- **Provider snapshots are committed** at `data/entry/providers/<id>.json`. A plain `pnpm entry` reads them
  offline, so `--check` is deterministic. `--providers=govuk,travel-buddy` refreshes them. Raw Travel Buddy
  responses stay in the gitignored `data/entry/.cache/`.
- **Provider links are additive** (deduped by URL and agency name). That is how a British member gets the GOV.UK
  link even on a curated rule. Provider `kind` is still only ever reported as a disagreement.
- **Destination links aren't copied into each rule.** Lookup composes them at runtime (`compose.ts`), and the
  build validates the composed result (every non-unknown rule has a source link).
- **Transit is resolved per leg.** `resolveLeg` returns the transit rule when the member's onward country is a third
  country and the arrival hub is an eligible port. Otherwise it returns the entry rule plus `transitOption` as a hint.
- **No border, no rule.** Domestic legs and a member arriving in their own passport country return `rule: null`,
  shown as "Home".
- **Territory coverage resolved:** the CSV has HKG, MAC and TWN as passports and destinations.
- **Fits the transport search** (`.agents/ledgers/core`, code on `dev/ahmet`). Entry is not a `TransportProvider`
  (per-passport, static, keyless), so it stays out of the `fanOut` registry. The planner joins `Offer`s with
  `entry.getLegEntry` per rider. Lookup accepts ISO-2 or ISO-3 (`iso.ts`), so `Place.country` (ISO-2) and
  `Place.iata` pass straight through. `/api/entry` uses the ADR-C06 flat params (`passport`, `fromIata`, `toIata`,
  `toCountry`, `onwardCountry`) and the `{ code: "BAD_QUERY", fields }` error.
- The UI shows on the globe screen after landing, with a mock four-member party (`DEMO_PARTY`) until real members
  exist, and in `/design`.

## Goal

For each leg of a trip and each party member's passport, show whether the member
can enter the destination, for how long, under what conditions, with a **Source**
link and a **How to apply** link. The data must be good enough to demo and honest
about how much to trust it.

## Non-goals

- Airline-grade compliance. Timatic is paid and airline-only. Every rule carries
  "check official sources".
- Health, customs, safety or insurance rules.
- A live API call on the demo path. Every rule is read from a static file.
- Residence permits and multi-visa holders (US visa holders entering Mexico, etc.).
  Out for the MVP.

## Design

Three layers merged at build time into one static JSON file. A runtime lookup
function reads that file. No network access at runtime.

```
passport-index CSV ─┐
                    ├─► scripts/entry-requirements.mts ─► src/data/entry-requirements.json
curated/*.json ─────┤        (merge, validate, report)           │
destination links ──┤                                            ▼
providers (opt.) ───┘                              src/lib/entry/lookup.ts ─► UI, planner, agent
```

### Layer 1: baseline matrix (dataset)

- Source: the tidy ISO-3 CSV from [visualpharm/visa-free-dataset](https://github.com/visualpharm/visa-free-dataset),
  committed as a snapshot at `data/entry/passport-index.csv` with the snapshot date
  and commit SHA in `data/entry/passport-index.meta.json`.
- Mapping from CSV values:

  | CSV value | `kind` | `allowedDays` |
  |---|---|---|
  | integer 7–360 | `visa_free` | the integer |
  | `visa free` | `visa_free` | unset |
  | `visa on arrival` | `visa_on_arrival` | unset |
  | `eta` | `eta` | unset |
  | `e-visa` | `e_visa` | unset |
  | `visa required` | `visa_required` | unset |
  | `no admission` | `no_admission` | unset |
  | `-1` | skipped (same country) | |

- Every dataset-derived rule gets `origin: "dataset"`, `freshness: "estimated"`.
- Scope: only the passports and destinations in `entry.config.json` (see below),
  not all 199² pairs, so the JSON stays small and reviewable.

### Layer 2: curated overrides

Hand-written, hand-verified entries in `data/entry/curated/*.json`. They win over
every other layer. They exist for what no dataset covers:

- China 240-hour visa-free transit (nationality list, eligible port, onward ticket,
  permitted region), including HK West Kowloon as a port.
- HK ↔ Shenzhen and other land or rail border crossings.
- Territory passports (HKSAR, Macau, Taiwan) if the CSV doesn't cover them.
- Any dataset entry we find to be wrong while testing.

Each curated entry must have `sourceUrl` (official, not a news or visa-blog page)
and `verifiedAt` (ISO date). The build fails without both.

### Layer 3: destination links

`data/entry/destinations.json`, one record per destination country:

```ts
{
  destination: "JPN",
  name: "Japan",
  immigrationUrl: "https://www.moj.go.jp/isa/...",   // official
  eVisaUrl: "https://www.evisa.mofa.go.jp/",         // if the country has one
  etaUrl?: string,
  embassyDirectoryUrl?: string
}
```

These feed `applyUrl` when a rule's `kind` is `e_visa`, `eta` or `visa_required`,
unless the rule (curated or provider) already has a more specific one. Hand-curated,
roughly 15 countries for the demo region.

### Providers (optional enrichment, build time only)

A provider enriches or cross-checks rules. It never runs at request time.

```ts
interface EntryProvider {
  id: string;
  /** Which pairs this provider can speak to. Skip the rest without a request. */
  supports(passport: string, destination: string): boolean;
  fetch(passport: string, destination: string): Promise<ProviderResult | null>;
}

type ProviderResult = {
  kind?: EntryKind;                 // only Travel Buddy fills this
  allowedDays?: number;
  conditions?: string[];
  links: { label: string; url: string; role: "source" | "apply" | "embassy" | "info" }[];
  sourceUpdatedAt?: string;         // the provider's own date for the content
  raw: unknown;                     // written to the report, never shipped to the client
};
```

Initial providers:

**Travel Buddy** (`providers/travel-buddy.mts`)
- Supports every pair. Needs `TRAVEL_BUDDY_API_KEY`; skipped with a warning if absent.
- Free tier is 120–200 requests a month, so the demo pair set must stay under about
  100 requests. The script keeps a response cache at `data/entry/.cache/travel-buddy/`
  (gitignored), keyed by pair, and does not refetch within 30 days. It refuses to
  run if the planned request count exceeds `--max-requests` (default 100).
- Uses `POST /v2/visa/check`. Maps primary rule to `kind`, `duration` to
  `allowedDays`, `destination.passport_validity` to a condition, and its official
  links to `links`.
- Role in the merge: **cross-check and link fill**, not source of truth (see
  precedence). A disagreement with the dataset is reported, not applied.

**GOV.UK** (`providers/govuk.mts`)
- Supports only `passport === "GBR"`.
- `GET https://www.gov.uk/api/content/foreign-travel-advice/<slug>`, no auth.
  Slug comes from `destinations.json` (`govukSlug`), not computed from the name.
- Does **not** produce a `kind`. FCDO writes prose, and parsing it is brittle. It
  contributes links only: the page
  `https://www.gov.uk/foreign-travel-advice/<slug>/entry-requirements` with role
  `source`, and `sourceUpdatedAt` from `public_updated_at`.
- Prose is not copied into the app. Link out. If we ever quote it, content is under
  the Open Government Licence v3 and needs attribution.
- Keys on **passport**, not flight origin. A British passport holder flying from
  Hong Kong still gets the FCDO link, and a non-British traveller departing London
  doesn't.

More providers (other governments' APIs, CanIEnter) can be added by implementing the
interface. No other change is needed.

## Merge precedence

For each `(passport, destination)`, highest wins per field:

1. curated override
2. dataset (`kind`, `allowedDays`)
3. provider links and conditions fill fields that are still empty

Provider `kind` never overrides the dataset. If they disagree, the pair goes into
the build report under **Disagreements** for a human to resolve, usually by adding
a curated entry. This keeps the shipped data deterministic and reviewable.

## Schema

`src/lib/entry/schema.ts`, zod 4, shared with the `Leg` schema from POR-5.

```ts
export const EntryKind = z.enum([
  "visa_free", "visa_on_arrival", "eta", "e_visa", "visa_required",
  "transit_exempt", "no_admission", "unknown",
]);

export const EntryLink = z.object({
  label: z.string(),
  url: z.url(),
  role: z.enum(["source", "apply", "embassy", "info"]),
});

export const EntryRule = z.object({
  passport: z.string().length(3),        // ISO-3, or HKG / MAC / TWN
  destination: z.string().length(3),
  kind: EntryKind,
  allowedDays: z.number().int().positive().optional(),
  conditions: z.array(z.string()).default([]),   // "Onward ticket", "6 months passport validity"
  links: z.array(EntryLink).default([]),
  origin: z.enum(["curated", "dataset", "provider"]),
  freshness: z.enum(["live", "cached", "estimated"]),
  verifiedAt: z.iso.date().optional(),           // curated only
  sourceUpdatedAt: z.iso.date().optional(),      // provider's own date, e.g. GOV.UK
  datasetSnapshot: z.iso.date().optional(),      // dataset-origin only
});
```

Rules:
- `kind: "unknown"` is the fallback when a pair isn't in the file. It renders as
  "No data. Check official sources" and never blocks a route.
- `freshness`: curated → `cached`; dataset → `estimated`; the demo never produces
  `live`.
- `verifiedAt` is present if and only if `origin === "curated"`. Enforced by a
  `.refine`.
- A rule must have at least one `source` link unless `kind` is `unknown`.

## Runtime API

`src/lib/entry/lookup.ts`:

```ts
getEntryRule(passport: string, destination: string, opts?: { transit?: boolean }): EntryRule;
getLegEntry(leg: Leg, members: Member[]): { member: Member; rule: EntryRule }[];
isBlocking(rule: EntryRule): boolean;   // visa_required | no_admission
```

- `transit: true` means the member is passing through, not stopping. It first looks
  for a `transit_exempt` curated rule on that pair, then falls back to the normal
  rule.
- `getLegEntry` uses the leg's destination country. Country comes from the hub, so
  `Airport` needs a `country` (ISO-3) field. POR-6 already replaces the mock hubs
  with the static dataset, so add it there. Until then, add a temporary
  `AIRPORT_COUNTRY` map beside `airports.ts`.
- Each member needs a `passport` field (ISO-3). The member model is part of the
  Supabase and Liveblocks tickets, so for now it is a plain field with a guest
  default.
- The JSON is imported server-side or lazily on the client, not in the globe bundle.

## UI

Follow `DESIGN.md` and use tokens only.

- Per leg, one chip per member showing the `kind` in plain words ("Visa free, 30
  days", "e-visa needed", "Visa required"). Chips for members that differ from the
  rest of the party are visually distinct, because POR-20's acceptance criterion is
  that different members see different warnings on the same route.
- Expanded view: allowed days, conditions, **Source** link, **How to apply** link
  (when `kind` needs one), and the date line.
- Date line: `Verified 2026-10-02` for curated, `Estimated from dataset, 2026-06-14`
  for dataset, always followed by "Check official sources".
- `estimated` rules show the existing "estimated" badge. `unknown` shows a neutral
  state, not an error.
- Optional filter: hide route options that need a visa a member doesn't have
  (`isBlocking`). Off by default, because a hidden route is worse than a flagged one.
- Links open in a new tab with `rel="noopener noreferrer"`.
- Copy follows the terse-label rule. Detail lives in the expanded view.

## Build script

`scripts/entry-requirements.mts`, run with `node` like `scripts/tokens.mts`.

```
node scripts/entry-requirements.mts                      # merge, validate, write JSON
node scripts/entry-requirements.mts --check              # fail if the JSON is stale
node scripts/entry-requirements.mts --providers=tb,govuk --max-requests=100
```

- `package.json`: add `"entry": "node scripts/entry-requirements.mts"`, and run
  `--check` in `build` like the tokens check.
- Providers are off by default. A plain run needs no keys and no network, so CI and
  fresh clones work.
- Writes `src/data/entry-requirements.json` (committed) and
  `data/entry/report.md` (committed) listing: counts per origin, curated entries
  older than 90 days, provider disagreements, pairs with no source link, and URLs
  that failed a HEAD check when `--check-links` is passed.
- Validates everything with the zod schema. Any invalid entry fails the build.

`entry.config.json`:

```json
{
  "passports": ["HKG", "CHN", "KOR", "USA", "GBR"],
  "destinations": ["HKG", "CHN", "KOR", "JPN", "TWN", "SGP", "THA"]
}
```

## Files

```
data/entry/
  passport-index.csv           snapshot
  passport-index.meta.json     { snapshotDate, sourceRepo, commit }
  curated/*.json               hand-verified overrides
  destinations.json            per-country official links
  report.md                    generated
  .cache/                      gitignored provider responses
scripts/entry-requirements.mts
scripts/entry/providers/{travel-buddy,govuk}.mts
src/lib/entry/{schema,lookup}.ts
src/data/entry-requirements.json   generated, committed
src/components/entry/              chips and detail panel
```

## Acceptance criteria

1. In the demo route (HK → Shanghai by rail, Seoul → Shanghai by air, Shanghai →
   Tokyo), at least one member sees a different entry result from the others on the
   same leg.
2. The China transit case is a curated rule with an official source and a
   `verifiedAt` date, and it is displayed as transit-eligible.
3. Every displayed rule shows its origin and date, and a `source` link unless
   `unknown`.
4. `e_visa`, `eta` and `visa_required` rules show a **How to apply** link.
5. A British-passport member on any leg gets the GOV.UK entry-requirements link.
6. The app works with no network and no API keys: deleting `.cache/` and unsetting
   `TRAVEL_BUDDY_API_KEY` changes nothing at runtime.
7. `node scripts/entry-requirements.mts --check` passes in CI, and fails if the
   JSON doesn't match its inputs.
8. A pair not in the file renders "No data" and does not break route search.

## Tests

- Schema: `verifiedAt` iff curated; source link required unless `unknown`; ISO-3
  length.
- CSV mapping: each value in the table above, including integer days and the `-1`
  skip.
- Merge precedence: curated beats dataset; provider `kind` never overrides the
  dataset; provider links fill gaps; disagreements are reported.
- GOV.UK provider: skips non-GBR passports; builds the link from `govukSlug`;
  handles a 404.
- Lookup: unknown pair, transit with and without a transit rule, `isBlocking`.
- No test hits the network. Providers are tested against recorded fixtures.

There is no test runner in `package.json` yet. Adding one (Vitest) is part of this
work unless another ticket lands it first.

## Risks

| Risk | Mitigation |
|---|---|
| Dataset is wrong for a demo pair | Curate every demo pair by hand and mark `verifiedAt`. The report lists dataset-only pairs on the demo route |
| Rules change after the snapshot | Date on every rule, "Check official sources", report flags curated entries older than 90 days. Re-run the script before the demo |
| Passport Index licence is unclear | Attribute in the README and UI footer. Ask before any commercial use |
| Travel Buddy free tier is small and its terms are unread | Offline only, cached, request budget enforced, read the API terms before first use |
| HKSAR, Macau and Taiwan are missing from the CSV | First task: check the columns. If absent, curate them |
| Official links rot | `--check-links` HEAD check in the report, run before the demo |
| Passport vs origin confusion | Providers and rules key on passport only |

## Tasks

1. Verify HKG, MAC and TWN coverage in the CSV, then pick the snapshot and commit it
   with its meta file.
2. Schema and lookup (`src/lib/entry/`), with tests.
3. Build script: CSV import, config, merge, report, `--check`.
4. Curate the demo corridors and `destinations.json`. This is the long pole, since
   each entry needs an official source.
5. UI: leg chips and detail panel.
6. Travel Buddy provider, then GOV.UK provider.
7. Wire `getLegEntry` into route options (depends on POR-5 and POR-24) and add the
   optional hide filter.

Tasks 1–4 are enough for the MVP. 5 makes it visible, 6 and 7 are the upgrade.
