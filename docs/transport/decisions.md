# Transport decisions

Moved from `.agents/ledgers/core/DECISIONS.md` on 2026-10-03, with the ADR IDs kept so existing references still resolve. To reverse a decision, set it to `superseded` and link the one that replaces it (see `docs/README.md`).

Prefixes: `ADR-C` transport core, `ADR-F` flights, `ADR-S` ferries, `ADR-T` trains, `ADR-B` buses.

## ADR-C01 — 2026-10-02 — Provider calls only in route handlers, Node runtime

**Status:** built

**Context:** Keys (Travelpayouts token, TDX client secret, data.go.kr serviceKey) must not ship
to browser. Options: (A) route handlers (B) direct browser fetch (C) separate backend.
**Decision:** (A). `src/app/api/transport/**/route.ts`, `export const runtime = "nodejs"`.
Provider modules import `server-only`.
**Why not (B):** leaks keys; most providers send no CORS headers. **(C):** extra deploy for nothing.
**Consequences:** Vercel function limits apply (see `docs/multiplayer/free-tiers.md`).

## ADR-C02 — 2026-10-02 — Stub-first registry; one contract file

**Status:** built

**Context:** Two seats, seven adapters, parallel. Shared registry/types = merge conflicts.
**Decision:** C01 writes `types.ts` + `registry.ts` listing **every** `ProviderId` with a stub
`providers/<id>/index.ts` that throws `ProviderFailure("NOT_CONFIGURED")`. Adapter tasks replace
only their stub's body. Contract changes: new `C` task only (EXECUTE.md Part 2 § Contract).
**Consequences:** registry never edited by feature tasks; stub tests prove wiring before APIs.

## ADR-C03 — 2026-10-02 — vitest, fixture-driven, no network in unit tests

**Status:** built

**Context:** No test runner in repo. Provider responses are the risk; rate limits (data.go.kr
dev quota, TDX tier) make live tests expensive.
**Decision:** vitest. Each adapter keeps `__fixtures__/*.json|xml` (real or doc-copied, secrets
stripped) and a mapper test. Live calls only in task Verification smoke steps.
**Consequences:** fixture drift possible; doc `observed` lines record when fixtures were taken.

## ADR-C04 — 2026-10-02 — Missing key = NOT_CONFIGURED, never a boot failure

**Status:** built

**Context:** Keys arrive at different times (approvals). Strict env schema would break dev for
the seat whose key is pending.
**Decision:** `env.server.ts` zod schema, every provider var optional. `covers()` may be true,
`search()` throws `NOT_CONFIGURED` when var absent. Fan-out reports it in `errors[]`.
**Consequences:** demo must check `errors[]` is empty of `NOT_CONFIGURED` (`.agents/SETUP.md` checklist, kept locally). Exception since 2026-10-03: travelpayouts returns an estimate instead (flights ADR-F03).

## ADR-C05 — 2026-10-02 — Seeded (link-out) routes carry typical departure times

**Status:** built

**Context:** 12Go, BusOnlineTicket, China rail give no API data (ADR-S01, ADR-B03, ADR-T02). `Segment.depart/arrive` required.
**Decision:** every seed row has `departures: string[]` ("HH:MM", local) + `tz` (IANA) from a cited operator/public source. Adapter emits one `Offer` per departure on `q.date`, `kind: "timetable"`, arrive = depart + `durationMin`. No times known → row not seeded.
**Why not optional times:** contract churn across 7 adapters; UI sorts by depart.
**Consequences:** seed curation costs more; times are "typical", UI says so via `kind`.

## ADR-C06 — 2026-10-02 — Search query string: flat `from*` / `to*` params

**Status:** built

**Context:** `GET /api/transport/search` must carry two `Place`s. Options: (A) flat params per field (B) `from=lat,lng,name[,iata]` packed (C) JSON in a param.
**Decision:** (A). `fromName, fromLat, fromLng, fromIata?, fromCountry?` and same for `to*`; `date` (YYYY-MM-DD, real calendar date), `modes?` (comma list), `passengers?` (1–9, default 1), `currency?` (ISO 4217, default USD). Blank = absent. Parser: `src/lib/transport/query.ts`. Since 2026-10-03 the route also accepts `from`/`to` as JSON `Place`s, because the globe UI sends them that way; `expandJsonPlaces` turns them into these flat params.
**Why not (B):** names contain commas. **(C):** unreadable curls, double encoding.
**Consequences:** `providerIds` not passable by URL; adapters resolve stations from lat/lng/iata. 400 body `{ code: "BAD_QUERY", fields: string[] }`.

## ADR-C07 — 2026-10-02 — Fan-out: race each provider against its signal, no retries yet

**Status:** built

**Context:** Provider may ignore `signal`; retries could blow the 8 s budget.
**Decision:** `fanOut` races `search()` against `AbortSignal.any([timeout(PROVIDER_TIMEOUT_MS), request.signal])` → `TIMEOUT`. No retries; `retryable` returned to client. Route `maxDuration = 15`.
**Consequences:** retries, if added, live in `search.ts` only.

## ADR-C08 — 2026-10-03 — Additive `ProviderId` `"srt"` (Thai rail seed)

**Status:** built

**Context:** Trains T05 found namtang SRT trips unusable (placeholder times, trains ADR-T06). Owner wants Thai intercity trains as a seed (2026-10-03). No existing id fits: `gtfs` is a build-time feed pipeline (buses-owned), `china-rail`/`tdx`/`korea-tago` are country-scoped.
**Decision:** add `"srt"` to `ProviderId` in `types.ts`, a `providers/srt/` folder, and one line in `registry.ts`. Additive only; no other contract change. Done inside trains T07 (exception to ADR-C02's "never this list" for this one id).
**Why not inject rows into `gtfs` output:** mixes hand seed into a regenerated artifact; cross-ledger file ownership.
**Consequences:** `ProviderId` union has 8 members. Clients switching on `provider` must accept `"srt"`.

## ADR-C09 — 2026-10-03 — `Offer.transfers` and `kind: "estimated"`

**Status:** built

**Context:** Travelpayouts cached fares include connecting flights but list one segment, so every flight read as direct and the ranking's layover penalty never applied (flights ADR-F04). Thin flight routes returned nothing, and AGENTS.md requires a mock fallback for every provider (flights ADR-F03).
**Decision:** two additive fields on the contract in `types.ts`:
- `transfers?: number`: connections the provider counts but doesn't list. `transfersOf(offer)` is the larger of it and `segments.length - 1`; ranking and every UI use that.
- `kind` gains `"estimated"`: modelled, not quoted. It has no real departure time, so UIs show "estimated" in place of the time.
**Consequences:** clients switching on `kind` must accept `"estimated"`. The trip plan's `StoredOffer` (multiplayer M13) mirrors both.

