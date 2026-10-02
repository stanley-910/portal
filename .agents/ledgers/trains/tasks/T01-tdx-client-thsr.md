# T01 — TDX OAuth client + THSR adapter
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/taiwan-tdx.md`, then this.
**Model: opus** — token + quota discipline shared with buses B01.

## Goal
Owner's ask:

> "Taiwan High Speed Rail (TDX API) … Free for Trains"

TDX is metered (5 req/min, ~4,500 calls/month). Build one quota-aware client and the THSR
adapter. T02 adds TRA, B01 adds buses on the same client.

## Non-negotiables
- Token cached in module scope; refresh before expiry; one in-flight token request (dedupe).
- Client-side limiter ≤ 5 req/min; over → `RATE_LIMITED` immediately, no queue that stalls fan-out.
- `$format=JSON` on every call. Stations from committed snapshot, never fetched per request.
- No keys → `NOT_CONFIGURED`. 401 → drop token, retry once.

## Context (anchors)
- Doc § Endpoints: `/v2/Rail/THSR/Station`, `/v2/Rail/THSR/DailyTimetable/OD/{O}/to/{D}/{date}`, `/v2/Rail/THSR/ODFare/{O}/to/{D}` (CabinClass 1 standard).
- Observed response in doc § Endpoints → use as fixture.
- `src/lib/transport/http.ts` (C01).

## Steps
- [ ] `client.ts`: `getToken()`, `tdxGet(path, params)` with limiter + `revalidate`.
- [ ] `scripts/snapshot-tdx.mts` → `thsr-stations.json` (StationID, names Zh/En, lat/lng); `thsr-fares.json` optional (12 stations² = 132 calls, spread over >30 min or skip and fetch per OD cached).
- [ ] `thsr.ts`: nearest station to `q.from`/`q.to` within 20 km; timetable OD by `q.date`; map → `Offer` (`mode:"train"`, `carrier:"THSR"`, `number=TrainNo`, `+08:00` times, `kind:"timetable"` or price from ODFare standard adult).
- [ ] `index.ts` dispatches THSR (TRA in T02).
- [ ] Tests: fixture → offers with correct ISO times; HH:mm and HH:mm:ss both parse; token reused across calls; 6th call within a minute → `RATE_LIMITED`; no env → `NOT_CONFIGURED`.

## Definition of done
- Taipei → Kaohsiung (Zuoying) tomorrow returns THSR offers.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- tdx`

Live (after C02, with key): curl search Taipei 25.0478,121.5170 → Zuoying 22.6873,120.3076; expect `tdx` offers.

## Notes

