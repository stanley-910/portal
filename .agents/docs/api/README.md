# API ground truth — index

Checked 2026-10-02. One file per provider. Doc beats memory; patch doc when reality differs
(mark `observed <date>`). Shape: Verdict · Access · Auth · Endpoints · Limits · Coverage · Errors · Gotchas · Sources.

| Doc | Provider id | Modes | Seat | Reality vs "free" assumption | Ledger tasks |
|---|---|---|---|---|---|
| `travelpayouts.md` | `travelpayouts` | flight | Cata | **Free, no approval.** Cached fares only (≤48h); real-time Search API gated ≥50k MAU | F01–F03 |
| `12go.md` | `12go` | ferry, bus | Cata (ferry) · Ahmet (bus) | **No public API.** Partner-only. Affiliate deep links only | S01, S02, B04 |
| `taiwan-tdx.md` | `tdx` | train, bus | Ahmet | Official, metered: free tier 5 req/min, ~4,500 calls/month. **Signup needs Taiwan phone** (else manual email review) → seeded, ADR-T04/B07 | T06, B01 |
| `korea-data-go-kr.md` | `korea-tago` | train, bus | Ahmet | Official, free, 10k/day. **Signup = Korean nationals + 본인인증 only** → seeded, ADR-T05/B07 | T03, B02 |
| `china-12306.md` | `china-rail` | train | Ahmet | **No official API.** Scraping legally risky → own seed + link-out | T04 |
| `rome2rio.md` | — (dropped) | multi | — | **Dead.** Not accepting applications, docs 404 | ADR-T03 |
| `gtfs.md` | `gtfs` | bus, train, (ferry) | Ahmet | Free, keyless (namtang TH, KTMB MY). Thin intercity coach coverage | B03, T05 |
| `busonlineticket.md` | `busonlineticket` | bus | Ahmet | **No public API.** Affiliate (manual approval) + deep links → untagged, no signup | B05 |

Env vars (all optional, ADR-C04): `TRAVELPAYOUTS_TOKEN` `TRAVELPAYOUTS_MARKER` `TRAVELPAYOUTS_TRS`
`TRAVELPAYOUTS_MARKET` `TWELVEGO_AFFILIATE_ID` `TDX_CLIENT_ID` `TDX_CLIENT_SECRET`
`DATA_GO_KR_SERVICE_KEY` `TRIPCOM_AFFILIATE_ID` `BOT_REFERER_ID` `LTA_DATAMALL_ACCOUNT_KEY`
`MOBILITYDB_REFRESH_TOKEN`. Not used: `GOOGLE_MAPS_API_KEY` (backlog), `ROME2RIO_API_KEY` (never).
