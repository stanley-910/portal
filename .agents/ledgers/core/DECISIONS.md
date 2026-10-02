# Core — Decisions (append-only ADR log)

Never edit past entries. Supersede with new dated entry. Prefixes: `ADR-C` core, `ADR-F`
flights, `ADR-S` ferries, `ADR-T` trains, `ADR-B` buses.

---

## ADR-C01 — 2026-10-02 — Provider calls only in route handlers, Node runtime

**Context:** Keys (Travelpayouts token, TDX client secret, data.go.kr serviceKey) must not ship
to browser. Options: (A) route handlers (B) direct browser fetch (C) separate backend.
**Decision:** (A). `src/app/api/transport/**/route.ts`, `export const runtime = "nodejs"`.
Provider modules import `server-only`.
**Why not (B):** leaks keys; most providers send no CORS headers. **(C):** extra deploy for nothing.
**Consequences:** Vercel function limits apply (see `docs/research/free-tiers.md`).

## ADR-C02 — 2026-10-02 — Stub-first registry; one contract file

**Context:** Two seats, seven adapters, parallel. Shared registry/types = merge conflicts.
**Decision:** C01 writes `types.ts` + `registry.ts` listing **every** `ProviderId` with a stub
`providers/<id>/index.ts` that throws `ProviderFailure("NOT_CONFIGURED")`. Adapter tasks replace
only their stub's body. Contract changes: new `C` task only (EXECUTE.md Part 2 § Contract).
**Consequences:** registry never edited by feature tasks; stub tests prove wiring before APIs.

## ADR-C03 — 2026-10-02 — vitest, fixture-driven, no network in unit tests

**Context:** No test runner in repo. Provider responses are the risk; rate limits (data.go.kr
dev quota, TDX tier) make live tests expensive.
**Decision:** vitest. Each adapter keeps `__fixtures__/*.json|xml` (real or doc-copied, secrets
stripped) and a mapper test. Live calls only in task Verification smoke steps.
**Consequences:** fixture drift possible; doc `observed` lines record when fixtures were taken.

## ADR-C04 — 2026-10-02 — Missing key = NOT_CONFIGURED, never a boot failure

**Context:** Keys arrive at different times (approvals). Strict env schema would break dev for
the seat whose key is pending.
**Decision:** `env.server.ts` zod schema, every provider var optional. `covers()` may be true,
`search()` throws `NOT_CONFIGURED` when var absent. Fan-out reports it in `errors[]`.
**Consequences:** demo must check `errors[]` is empty of `NOT_CONFIGURED` (SETUP.md checklist).

## ADR-C05 — 2026-10-02 — Seeded (link-out) routes carry typical departure times

**Context:** 12Go, BusOnlineTicket, China rail give no API data (ADR-S01, ADR-B03, ADR-T02). `Segment.depart/arrive` required.
**Decision:** every seed row has `departures: string[]` ("HH:MM", local) + `tz` (IANA) from a cited operator/public source. Adapter emits one `Offer` per departure on `q.date`, `kind: "timetable"`, arrive = depart + `durationMin`. No times known → row not seeded.
**Why not optional times:** contract churn across 7 adapters; UI sorts by depart.
**Consequences:** seed curation costs more; times are "typical", UI says so via `kind`.
