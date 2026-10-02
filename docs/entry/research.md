# Entry requirements data sources

Research for POR-20 (entry rules per member passport), expanded to cover each leg
with source and how-to-apply links. Researched 2026-10-02.

## Bottom line

No free source is authoritative. IATA Timatic is the authority airlines use, and it
is paid and airline-only. Everything below is a secondary source and has to be
presented as "check official sources", with a date and a link.

For the MVP, use three layers and ship them as a static JSON file generated at
build time, so the demo never depends on a live API:

1. **Baseline matrix.** Passport × destination → requirement and allowed days,
   from an open CSV.
2. **Curated overrides.** Hand-verified entries for the demo corridors, each with
   an official source URL, an apply URL and a `verifiedAt` date. This layer
   carries the demo.
3. **Destination links.** Per country (not per pair): immigration or e-visa
   portal and embassy page.

## Sources compared

| Source | What it gives | Cost | Reliability | Verdict |
|---|---|---|---|---|
| [ilyankou/passport-index-dataset](https://github.com/ilyankou/passport-index-dataset) and forks ([visualpharm](https://github.com/visualpharm/visa-free-dataset), [imorte](https://github.com/imorte/passport-index-data)) | CSV, 199 countries. Values are visa free (with days), visa on arrival, eTA, e-visa, visa required, no admission | Free, MIT repo licence | Secondary. Original archived Jan 2025. The visualpharm fork is patched from embassy sites, but its own log shows a 153-nationality recode, so baseline errors exist. No per-pair source links | **Use as baseline seed** |
| [Travel Buddy API](https://travel-buddy.ai/api/) | JSON, 200 passports × 211 destinations, updated daily, official portal links, stay duration, passport validity | Free tier (120/month on the pricing section, 200 in the FAQ), then $4.99/month for 3,000 | Claims monitoring of official sources. Says it is not a Timatic replacement. No per-rule last-updated field. Commercial-use terms not read | **Optional cross-check and link fill**, run offline into the JSON |
| [CanIEnter visa-check](https://glama.ai/mcp/connectors/com.canienter/visa-check/tools/check_entry_requirements) | Requirement, stay, apply portal, passport validity, transit parameter, cited sources with verified dates | Rate-limited free tier, x402-paid HTTP | Its own docs say the verdict comes from an aggregated secondary matrix and is never claimed as officially verified | Worth a look for the agent tool (POR-39). Not the data store |
| [GOV.UK Content API](https://content-api.publishing.service.gov.uk/getting-started.html) | Official UK entry-requirements prose per country. I confirmed `https://www.gov.uk/api/content/foreign-travel-advice/<country>` returns JSON with no auth | Free, no auth | Authoritative, but **only for British passport holders** | Use for UK-passport link and prose. Not a general source |
| Sherpa | Airline and OTA grade requirements, eVisa sales | Sales-led, roughly $1.5k+/month, revenue share | High | Out of scope for a hackathon |
| IATA Timatic | The authority | Paid, airline contracts | Authoritative | Not available |
| Official government sites (NIA, HK Immigration, Japan MOFA, Korea K-ETA, etc.) | The truth | Free, no API | Authoritative, but unstructured | **Manual curation for the demo corridors** |

## Gaps no dataset covers

These are the cases the demo actually depends on, so they must be curated by hand:

- **China 240-hour visa-free transit.** Rules need the nationality list, the
  eligible port, a confirmed onward ticket to a third country, and the permitted
  region. Sources disagree on the count (55 vs 57 countries) and the port list
  (65 ports after Nov 2025). West Kowloon Station was added as a port on
  2025-11-05. Check the NIA list directly.
- **HK ↔ Shenzhen crossings.** HKSAR passport holders and mainland entry use
  different documents. Don't trust a passport matrix for this.
- **Territory passports** (HKSAR, Macau, Taiwan). Not confirmed in the CSVs; check
  the column headers before relying on them.

## Proposed data shape

Fits the existing `freshness: live | cached | estimated` rule from POR-5.

```ts
type EntryRule = {
  passport: string;            // ISO-3, plus HKG/MAC/TWN as needed
  destination: string;
  kind: "visa_free" | "visa_on_arrival" | "eta" | "e_visa" | "visa_required"
      | "transit_exempt" | "no_admission";
  allowedDays?: number;
  conditions?: string[];       // "onward ticket", "6-month passport validity"
  sourceUrl: string;           // official page where possible
  applyUrl?: string;
  verifiedAt?: string;         // set only on hand-curated entries
  origin: "curated" | "dataset" | "api";
  freshness: "live" | "cached" | "estimated";
};
```

- Curated entry → `cached`, shows `verifiedAt`.
- Dataset-only entry → `estimated`, shows the "estimated" badge and a
  "check official sources" link.
- A live API call → `live`. Don't use it on the demo path.

## MVP plan

1. Download one dataset snapshot. Filter to the demo passports (HK, CN, KR, US,
   UK) × demo destinations (HK, CN, KR, JP, plus whatever the globe lands on).
2. Hand-curate roughly 10–15 corridor entries with official URLs and
   `verifiedAt`. Include China 240-hour transit and HK West Kowloon.
3. Write per-destination link records (immigration portal, e-visa, embassy).
4. Add a build script that merges the layers into
   `src/data/entry-requirements.json`, with curated entries overriding dataset
   ones. Optionally cross-check against Travel Buddy and flag disagreements.
5. UI: a per-leg chip per member, expandable to show the rule, days, conditions,
   Source and How to apply links. Follow `DESIGN.md`.

## Open questions

- **Licence.** The CSV repos are MIT, but the underlying Passport Index data has
  no open licence that I could find. Fine for a hackathon with attribution; ask
  before anything commercial.
- **Travel Buddy terms.** I didn't read the Terms of Use for API, so commercial
  use and caching rights are unconfirmed.
- ~~**Territory coverage.**~~ Resolved 2026-10-02: the tidy CSV has HKG, MAC and
  TWN as both passports and destinations. Their values for HK ↔ mainland are
  wrong, though, so those pairs are curated.
