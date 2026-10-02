# Flights — REFERENCE

Codebase: core `REFERENCE.md`. Provider truth: `.agents/docs/api/travelpayouts.md`.

| Thing | Value |
|---|---|
| Provider id | `travelpayouts` |
| Folder | `src/lib/transport/providers/travelpayouts/` |
| Env | `TRAVELPAYOUTS_TOKEN` (server only), `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS`, `TRAVELPAYOUTS_MARKET` (optional, default `us`) |
| Base | `https://api.travelpayouts.com` |
| Auth | header `X-Access-Token` (never query `token=` — leaks into logs) |
| Rate | `v3/prices_for_dates` 600/min; 429 → `RATE_LIMITED` |
| Errors | 401 `text/plain` `Unauthorized`; logical `{success:false,error}`; old dates → empty `data` |
| Static data | `/data/en/airports.json`, `/data/en/cities.json` (no token) |
| Existing | `src/components/trip-globe/airports.ts` mock hubs (IATA airport codes) |
