# Bundled transport hub data

Snapshot/research date: **2026-10-02**. Runtime consumers must read these local
JSON files only. These are geographic lookup data and **estimated connection
seeds**, not a timetable, bookable inventory, or a guarantee of current service.

## Coverage

| File | Coverage |
| --- | --- |
| `airports.json` | 4,008 scheduled-service, IATA-coded airports worldwide; 233 country/territory codes |
| `surface-hubs.json` | 57 representative surface hubs: 34 train stations and 23 passenger ferry terminals/piers; 23 country/territory codes |
| `connections.json` | 36 directed estimates (18 corridor pairs): 18 train edges and 18 ferry edges |

The combined inventory has **4,065 unique hub IDs**. Airport coverage is broad;
surface coverage is deliberately incomplete. This is **not every Asian station
or dock**, nor a complete route graph. Surface train examples span East,
Southeast, South, Central and West Asia/the Caucasus. Ferry coverage is concentrated
in Hong Kong/Macau, Thailand, Indonesia, Singapore, Japan and Korea; South/West
Asian ferries are not yet represented. Many truthful hub records have no bundled
edge. An absent edge means **unknown**, not that no service exists. Conversely,
the existence of two hubs does not imply that they have a direct connection.

## Airports: upstream, filter, and reproducibility

Source: [OurAirports downloads and terms](https://ourairports.com/data/),
[upstream repository](https://github.com/davidmegginson/ourairports-data).

- Pinned upstream commit: `ac08c301fd36bc1b9ea2bf4acfd4fef691360b5c`
  (airports.csv update, 2026-10-02T01:53:13Z).
- Exact input: <https://raw.githubusercontent.com/davidmegginson/ourairports-data/ac08c301fd36bc1b9ea2bf4acfd4fef691360b5c/airports.csv>
- Input SHA-256: `197c68d0520b01c35f03c7fa15bf3467bf8ed788b3ed5a128e86eccebf4465ef`.
- Geography: worldwide. The former Asia/transcontinental-country filter was removed on
  2026-10-03; the upstream pin and checksum are unchanged. Country and continent
  assignments are upstream metadata, not a geopolitical judgement.
- Operational/type filter: `scheduled_service == "yes"`, a nonempty IATA code,
  and `type` in `small_airport`, `medium_airport`, `large_airport`.
- Mapping: name, latitude, longitude, municipality (`city`), ISO country code,
  and IATA are taken directly from the CSV. `id = airport:<IATA>`;
  `code = iata = <IATA>`. Coordinates retain upstream numeric precision.
- `importance` is a heuristic from the upstream type: small = 1, medium = 2,
  large = 3. It is **not** measured passenger volume or connectivity.
- 67 upstream municipalities are empty; `city` remains `""` rather than fabricating a municipality.
- No airport timezone or flight graph is invented. OurAirports does not supply
  these in airports.csv. A scheduled-service flag can be stale; it does not prove
  a bookable flight exists on a particular date.

### Refresh and validate

From the repository root, using Python 3.9+ and the standard library:

```sh
python3 scripts/snapshot-hubs.py          # fetch pinned CSV; validate; write airports.json
python3 scripts/snapshot-hubs.py --check  # fully offline schema/reference validation
```

The refresh sorts by stable airport ID and writes deterministic UTF-8 JSON. It
verifies the input checksum and refuses unexpected IATA codes or duplicates.
It only overwrites `airports.json`; surface hubs and connection estimates are
reviewed by hand. Re-running against the same pin produces byte-identical output.
To update the snapshot date, deliberately update `COMMIT` and `CSV_SHA256` in the
script, inspect the upstream changes and generated diff, then update this document
and counts. Do not switch the URL to `main` or silently fall back to another source.
The offline check also verifies coordinates, IDs, country codes, timezones,
connection endpoint existence/mode, and duplicate edges. It does not verify service.

## Surface provenance and interpretation

Each surface record links to the specific **Wikidata entity** or **OpenStreetMap
node/way/relation** used for its location. Wikidata `P625` coordinates and OSM
feature coordinates/centres were inspected during this research. English names,
city labels, importance and timezone are curated; `code` is an **application-local
stable identifier**, not an official railway, port or booking-provider code.
`providerIds` are intentionally absent. No provider mapping should be inferred
merely from similar names.

Coordinates identify a station building, terminal complex or mapped pier, not a
boarding gate, public entrance, accessible walking path or precise embarkation
point. Values are normally rounded to four decimal places; some upstream values
are coarser and remain so. A large terminal may span hundreds of metres. Surface
records are a manually frozen snapshot; their source URLs can subsequently change.
Review the named feature before changing coordinates, and preserve stable IDs.

### Existing 12Go ferry seeds: important distinctions

The old provider seed contains approximate city/island positions. This inventory
does **not** relabel those positions as exact terminals:

- Hong Kong is **Sheung Wan's Hong Kong–Macau Ferry Terminal**, not Central's
  approximate city point. Macau Outer Harbour and Taipa are separate terminals.
- Don Sak is specifically **Raja Ferry Donsak Pier**; Koh Samui has separate
  **Lipa Noi** and **Nathon** piers. Do not map all operators to one pier.
- Koh Phangan is represented by **Thong Sala**; Phi Phi by **Ton Sai**;
  Koh Lanta by **Saladan**. Railay is specifically **Railay East Pier**, not
  the West Railay beach landing used by some services.
- Sanur uses the mapped **Sanur Port** building, not the former approximate
  beach/city seed. Nusa Penida uses the mapped **Toya Pakeh Pier**. This is not
  an assertion that every Sanur operator lands there or that it is interchangeable
  with every terminal marketed as Banjar Nyuh.
- Padang Bai and Gili Trawangan records identify mapped public ferry facilities;
  individual fast-boat operators may use different piers. No Padang Bai–Gili or
  Sanur–Penida edge is included until operator-specific boarding points are checked.
- **Koh Lipe is omitted**: the existing island seed does not identify a sufficiently
  verified fixed terminal. Seasonal beach landings must not be invented as docks.
- Surat Thani Airport is an airport, not a ferry pier. An airport-to-island product
  may include a road transfer, so there is no fake ferry terminal at the airport.
- SkyPier is an airport transfer facility with eligibility restrictions, **not a
  normal public city ferry terminal**. It has no connection seed here; do not
  infer public access from its presence in the location inventory.

## Connection estimates

Every `durationMin` is **estimated** and must be shown as such in the application.
These are curated plausible corridor examples, with intentionally symmetrical
rough durations for each direction, not scraped dated departures. They exclude
access travel, check-in, border clearance, waiting, transfer buffers and disruptions.
They contain no fares, operating days, departure times, or seat availability.

- Hong Kong West Kowloon–Shanghai Hongqiao (480 min), Shenzhen North (20 min),
  Guangzhou South (60 min): [MTR destinations](https://www.highspeed.mtr.com.hk/en/ticket/destination.html)
  explicitly lists these destinations. Durations vary substantially by stopping
  pattern, particularly daytime versus sleeper services; 480 is a demo estimate.
- Tokyo/Kyoto/Shin-Osaka/Hakata: [JR Central timetable entry point](https://global.jr-central.co.jp/en/info/timetable/).
  The selected durations are rough high-speed travel estimates, not a particular train.
- Seoul–Busan (160 min) and Hanoi–Saigon (1,980 min) are known rail corridors;
  [Korail](https://www.letskorail.com/) and [Vietnam Railways](https://dsvn.vn/)
  are operator references, **not evidence of a checked dated schedule**.
- Hong Kong–Macau Outer Harbour: [TurboJET](https://www.turbojet.com.hk/en/routing-sailing-schedule/hong-kong-macau/sailing-schedule-fares.aspx).
  Hong Kong–Taipa: [Cotai Water Jet](https://www.cotaiwaterjet.com/).
- Raja Don Sak–Lipa Noi and Don Sak–Thong Sala: [Raja Ferry](https://www.rajaferryport.com/)
  lists the specific terminal routes; 90/150 minutes are retained as estimates.
- Rassada–Ton Sai: [PhuketFerry terminal/route page](https://www.phuketferry.com/rassada-pier.html)
  corroborates these terminal endpoints and roughly two-hour conventional ferries.
  This is a reseller reference, not an independently verified current sailing.
  The Andaman Wave Master operator site returned a verification challenge during
  research; no successful live operator schedule check is claimed.
- HarbourFront/Tanah Merah–Batam Centre: [BatamFast](https://www.batamfast.com/)
  lists these sectors. Crossing duration is an estimate; Singapore and Batam use
  different timezones, so local clock subtraction is not an elapsed duration.

No route is guaranteed. No airport-to-airport edges are fabricated. No train-to-
ferry interchange or border-access eligibility is implied by geographic proximity.
Consumers must not turn absent graph data into fictional direct connections.

## Licences and attribution

- **OurAirports:** data is released to the **Public Domain**, with no guarantee of
  accuracy or fitness; see [the download terms](https://ourairports.com/data/).
  Attribution is appreciated, not required by that source. Keep the commit URL
  and provenance when redistributing the airport snapshot.
- **Wikidata:** structured entity data is **CC0**; see
  [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) and
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- **OpenStreetMap:** **© OpenStreetMap contributors**, available under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See [OSM copyright/attribution](https://www.openstreetmap.org/copyright).
  The OSM-derived surface database is distributed under ODbL 1.0; retain this
  notice and per-record source URLs. Public use requires appropriate visible
  attribution and a licence link; a hidden JSON `source` field alone is not a
  replacement for user-facing attribution. This data-only change does not add UI
  attribution. The integration owner must do so. Do not describe the mixed
  surface dataset as wholly public domain or relicense OSM-derived data as CC0.
- Connection numbers are hand-curated estimates. Linked operator/reseller sites
  retain rights to their content; no copyrighted timetable or page text is
  redistributed here, and no endorsement is implied.


## Ferry additions reviewed 2026-10-03

- Bandar Bentan Telani (`ferry:BINTAN-BBT`): exact coordinates 1.1605006, 104.3201677 from
  [OpenStreetMap node 5250721798, version 4](https://www.openstreetmap.org/node/5250721798), checked through
  `https://api.openstreetmap.org/api/0.6/node/5250721798.json`. ODbL, OpenStreetMap contributors.
  This is the northern Bintan Resorts terminal, not Tanjung Pinang. The timezone is Asia/Jakarta (UTC+7).
- Tanah Merah ↔ BBT connection: [Bintan Resort Ferries](https://www.brf.com.sg/) publishes the directional
  timetable and approximate 70-minute crossing. These graph edges do not confirm seats.
- Hakata ↔ Busan: [Camellia's currently linked English brochure](https://www.camellia-line.co.jp/wp-content/themes/2017theme_0111/camellialine/pdf/en_pamphlet.pdf),
  visually checked, gives Hakata 12:30→Busan 18:30 (360 minutes), Busan 22:30→Hakata 07:30 next day (540 minutes).
  The latter is **disembarkation start**, not ship docking. Irregular cancellations are not encoded.
- No SkyPier connection was added. [HKIA](https://www.hongkongairport.com/en/transport/mainland-connection/ferry-transfer.page)
  marks Taipa's airport ferry temporarily unavailable; SkyPier is exclusively for airside transfers, unavailable to
  trips starting in Hong Kong. The old 12Go SkyPier–Taipa seed was removed. Existing Sheung Wan–Taipa graph edges
  remain separate; a geographic terminal record does not promise an operating sailing.
