# T06 — THSR seed timetable + booking link-out
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `DECISIONS.md` ADR-T04, core ADR-C05, then this.
**Model: sonnet** — static data + URLs, same shape as T04.

## Goal
Owner's ask:

> "Seed Taiwan, the way the China provider (`china-rail`) already works." — chosen 2026-10-02 as
> "go with 2", after skipping TDX signup ("this is unneccesasry what happens if we skip this api").

TDX is out (ADR-T04). Taiwan stays in the demo through a curated THSR timetable on the existing
`tdx` provider id, with a link out to THSR booking. TRA and Taiwan buses are dropped, not replaced.

## Before / After

| | Today | After this task |
|---|---|---|
| Search Taipei → Zuoying (Kaohsiung), `modes=train` | `tdx` stub: `errors[]` has `NOT_CONFIGURED` | `tdx` returns THSR `Offer`s, one per seeded departure on `q.date`, `kind: "timetable"` |
| Offer link | — | THSR booking page (or 12Go if S01 done) |
| Taipei → Hualien (TRA-only) | `NOT_CONFIGURED` | `covers` false, no error |

**Unchanged on purpose:** `ProviderId` and the provider contract (`tdx` id kept); env schema
(`TDX_*` stay optional, unused); no network call to TDX at request time.

## Non-negotiables
- No request-time network calls. Seed is committed JSON.
- Every seed train cites `source` (thsrc.com.tw timetable page or PDF, with date checked).
- Times per ADR-C05: `"HH:MM"` local, `tz: "Asia/Taipei"`, emitted as ISO `+08:00`. No price (`kind: "timetable"`).
- Trains that do not run daily carry `days` (0 = Sun … 6 = Sat); omit = daily. Only emit offers for trains running on `q.date`'s weekday.
- `ProviderFailure` codes only from the contract; unseeded OD → `covers` false, not an error.

## Context (anchors)
- `src/lib/transport/providers/tdx/index.ts` — today `stubProvider("tdx", ["train", "bus"])`. Modes become `["train"]` only.
- `src/lib/transport/providers/stub.ts` — stub shape; replace usage, do not edit.
- `src/lib/transport/providers/china-rail/` — T04 builds the same seed pattern. **Trap:** T04 is `in_progress` in the `portal-trains` worktree (adds `china-rail/schema.ts`). Mirror its approach; do not import from or edit `china-rail/` — keeps T04 and T06 parallel-safe.
- THSR line: 12 stations, Nangang → Zuoying (Nangang, Taipei, Banqiao, Taoyuan, Hsinchu, Miaoli, Taichung, Changhua, Yunlin, Chiayi, Tainan, Zuoying). TDX StationIDs for reference: `1000` Taipei, `1070` Zuoying (REFERENCE.md).
- Seed source option: TDX guest mode (no key, 20 calls/day/IP) `GET /v2/Rail/THSR/GeneralTimetable?$format=JSON` from a local one-off script. Unverified whether guest allows non-browser calls — if it 401s/blocks, hand-curate from thsrc.com.tw. Never wire guest calls into the provider.
- Link-out: THSR booking `https://irs.thsrc.com.tw/IMINT/?locale=en` (`unverified` — confirm it loads; it does not take OD params, so link is generic). If ferries S01 is `done`, prefer 12Go Taiwan train search via its `links.ts` (not a dependency).

## Files touched
- `src/lib/transport/providers/tdx/index.ts` — edit
- `src/lib/transport/providers/tdx/seed.json` — create (stations with lat/lng + trains with per-station times, `days?`, `source`)
- `src/lib/transport/providers/tdx/schema.ts` — create (zod/types for seed, parsed once at module load)
- `src/lib/transport/providers/tdx/links.ts` — create
- `src/lib/transport/providers/tdx/index.test.ts` — create
- `scripts/snapshot-thsr.mts` — create (only if guest TDX fetch works)

## Steps
- [ ] `seed.json`: 12 stations (StationID, names Zh/En, lat/lng, cited); trains both directions — at least every departure 06:00–22:00 between Taipei and Zuoying on a weekday timetable, with stop times at every station they serve.
- [ ] `schema.ts`: validate seed at load (bad seed = test failure, not runtime crash).
- [ ] `index.ts`: nearest station to `q.from`/`q.to` within 20 km; pick trains stopping at both in the right order and running on `q.date`'s weekday; map → `Offer` (`mode: "train"`, `carrier: "THSR"`, `number` = train no, depart/arrive ISO `+08:00`, `kind: "timetable"`, link from `links.ts`).
- [ ] Tests: Taipei → Zuoying returns southbound trains only, sorted; Zuoying → Taipei returns northbound; intermediate pair (Taichung → Tainan) uses each train's own stop times; train with `days` excluded on other weekdays; Taipei → Hualien → `covers` false; seed parses.

## Definition of done
- Taipei → Zuoying tomorrow returns THSR timetable offers with a working link-out.
- `errors[]` has no `tdx` entry for Taiwan train queries.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- tdx`

Live (C02 route): `pnpm dev`, then
`curl "localhost:3000/api/transport/search?fromName=Taipei&fromLat=25.0478&fromLng=121.5170&toName=Zuoying&toLat=22.6873&toLng=120.3076&date=<tomorrow>&modes=train"`
→ `tdx` offers present, `errors[]` without `tdx`.

## Notes

