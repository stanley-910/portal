# T07 — SRT (Thai rail) seed timetable + booking link-out
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `DECISIONS.md` ADR-T06, core ADR-C05 + ADR-C08, `.agents/docs/api/gtfs.md` § Gotchas (namtang SRT), then this.
**Model: sonnet** — static data + URLs, same shape as T03/T04/T06.

## Goal
Owner's ask:

> "yes add it as task" (2026-10-03) — for the backlog item "SRT intercity timetable … seed from railway.co.th like T04/T06".

Thai intercity trains in search results. Today Bangkok → Chiang Mai returns buses only, because
namtang's SRT trips carry placeholder times (T05 Notes, ADR-T06).

## Before / After

| | Today | After this task |
|---|---|---|
| Bangkok → Chiang Mai, `modes=train` | no offers | `srt` offers, one per seeded train on `q.date`, `kind: "timetable"` |
| Bangkok → Hat Yai / Surat Thani / Nong Khai / Ubon | no train offers | `srt` offers |
| Taipei → Zuoying | `tdx` only | unchanged; `srt` `covers` false |

**Unchanged on purpose:** `gtfs` provider and build (namtang rail stays dropped); every other provider.

## Non-negotiables
- No request-time network calls. Seed is committed JSON, zod-validated at module load.
- Every train cites `source` (railway.co.th / SRT D-Ticket timetable page or PDF) + top-level `checked` date. Fetch fails → say so in Notes; never invent times.
- Times per ADR-C05: `"HH:MM"` local, `tz: "Asia/Bangkok"`, emitted as ISO `+07:00`. Overnight trains roll arrival to the next day.
- Trains not running daily carry `days` (0 = Sun … 6 = Sat).
- `ProviderId` change is exactly ADR-C08: add `"srt"` to `types.ts`, one import + one entry in `registry.ts`. Nothing else in core.
- Unseeded pair → `covers` false, never an error.

## Context (anchors)
- Shape references: `providers/tdx/` (per-station stop times, `days`, midnight roll), `providers/korea-tago/` (city match: nearest station ≤ 15 km, all stations of that city match).
- Bangkok has two terminals: Krung Thep Aphiwat (Bang Sue, most long-distance trains since 2023) and Hua Lamphong. Seed both as city "Bangkok".
- Demo lines (default): Northern (Bangkok–Chiang Mai, incl. special express sleepers 9/10, 13/14), Southern (Bangkok–Surat Thani–Hat Yai, plus Padang Besar if listed), Northeastern (Bangkok–Nong Khai, Bangkok–Ubon Ratchathani). Stops: at least the major ones (Ayutthaya, Lopburi, Phitsanulok, Lampang, Hua Hin, Chumphon, Surat Thani, Hat Yai, Khon Kaen, Udon Thani, Nakhon Ratchasima).
- `registry.test.ts` `LANDED` list: add `srt`.
- Link-out: SRT D-Ticket `https://dticket.railway.co.th/` (`unverified` — confirm it loads; generic link if no route params).

## Files touched
- `src/lib/transport/types.ts`, `src/lib/transport/registry.ts`, `src/lib/transport/registry.test.ts` — one-line edits (ADR-C08)
- `src/lib/transport/providers/srt/index.ts`, `schema.ts`, `links.ts`, `seed.json`, `index.test.ts` — create
- `scripts/snapshot-srt.mts` + `package.json` script — only if a fetchable source exists

## Steps
- [ ] `seed.json`: stations (name En/Th, lat/lng, `source`) + trains both directions on the demo lines with per-station times.
- [ ] `schema.ts` zod; `index.ts` search: city match, trains stopping at both in order, running on `q.date` weekday → `Offer` (`mode: "train"`, `carrier: "SRT"` + class in name if useful, `number`, ISO `+07:00`, `kind: "timetable"`, price only if sourced).
- [ ] Wire `"srt"` into `types.ts` + `registry.ts`.
- [ ] Tests: Bangkok → Chiang Mai overnight train arrives next day; reverse; intermediate pair (Ayutthaya → Phitsanulok) uses own stop times; `days` filter; Taipei pair → `covers` false; seed parses; no `fetch` at request time.

## Definition of done
- Bangkok → Chiang Mai tomorrow returns SRT timetable offers with a working link-out; `errors[]` has no `srt` entry.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- srt`

Live (C02 route): `pnpm dev`, then
`curl "localhost:3000/api/transport/search?fromName=Bangkok&fromLat=13.8040&fromLng=100.5402&toName=Chiang%20Mai&toLat=18.7883&toLng=98.9853&date=<tomorrow>&modes=train"`
→ `srt` offers present, `errors[]` without `srt`.

## Notes
