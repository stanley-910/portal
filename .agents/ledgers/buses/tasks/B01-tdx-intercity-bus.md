# B01 — TDX intercity bus via stop-pair index
REPO: (this repo) · Depends: T01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/taiwan-tdx.md`, then this.
**Model: opus** — cross-route join under 5 req/min.

## Goal
Owner's ask:

> "TDX Bus API … Free for Buses"

TDX bus has no A→B query. Snapshot intercity routes + stops into an index, answer OD at request
time from it, then fetch only the matching routes' schedules (cached).

## Non-negotiables
- Snapshot script respects 5 req/min (sleep between calls); run once, commit `bus-index.json`.
- Request time: ≤ 2 schedule calls per query; rest `UNSUPPORTED_ROUTE` or cached.
- Use T01 client; never a second token cache.

## Steps
- [ ] `scripts/snapshot-tdx-bus.mts`: `/v2/Bus/Route/InterCity` → `StopOfRoute` per route → index `{routeName, direction, stops[{uid,name,lat,lng,seq}]}`.
- [ ] `bus.ts`: find routes where from-stop seq < to-stop seq (within 2 km of query points); `Schedule/InterCity/{RouteName}` → offers.
- [ ] Tests: index join picks right direction; no route → `covers` false; schedule fixture → ISO `+08:00`.

## Definition of done
- Taipei → Taichung returns 國道客運 offers.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- tdx`

## Notes

