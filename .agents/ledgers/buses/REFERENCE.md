# Buses — REFERENCE

Codebase: core `REFERENCE.md`. Provider truth in `.agents/docs/api/`.

| Provider id | Folder | Env | Doc |
|---|---|---|---|
| `gtfs` | `src/lib/transport/providers/gtfs/` | `LTA_DATAMALL_ACCOUNT_KEY` (optional, SG train only), `MOBILITYDB_REFRESH_TOKEN` (build-time, optional) | `gtfs.md` |
| `tdx` | `providers/tdx/` (T01 client) | `TDX_CLIENT_ID`, `TDX_CLIENT_SECRET` | `taiwan-tdx.md` |
| `korea-tago` | `providers/korea-tago/` (T03 client) | `DATA_GO_KR_SERVICE_KEY` | `korea-data-go-kr.md` |
| `12go` | `providers/12go/` (S02 adapter) | `TWELVEGO_AFFILIATE_ID`, `TRAVELPAYOUTS_MARKER` | `12go.md` |
| `busonlineticket` | `providers/busonlineticket/` | `BOT_REFERER_ID` (optional) | `busonlineticket.md` |

Feeds (no key):
- KTMB `https://api.data.gov.my/gtfs-static/ktmb` (46 KB, calendar to 20261015)
- Namtang `https://namtang-api.otp.go.th/download/namtang-gtfs.zip` (42 MB; buses บขส./Nakhonchai Air, SRT, ferries)
- data.gov.my 4 req/min → fetch sequentially, cache in `.cache/gtfs/`.

GTFS traps: times > 24:00; compute in `agency_timezone` (`Asia/Bangkok`, `Asia/Kuala_Lumpur`), not Vercel UTC; stop ≠ city (radius map ~15 km + overrides); `route_type` 3 bus, 2 rail, 4 ferry.

TDX bus: `/v2/Bus/Route/InterCity`, `/v2/Bus/StopOfRoute/InterCity/{RouteName}`, `/v2/Bus/Schedule/InterCity/{RouteName}`; RouteName Traditional Chinese → URL-encode; no OD query.

Korea bus: `ExpBusInfo/GetStrtpntAlocFndExpbusInfo` (`depTerminalId`, `arrTerminalId`, `depPlandTime`), `SuburbsBusInfo/GetStrtpntAlocFndSuberbsBusInfo` (today only; "Suberbs" spelling real). Terminal lists: `GetExpBusTrminlList`, `GetSuberbsBusTrminlList`. Each service = separate data.go.kr application + quota.

BOT deep link: `https://www.busonlineticket.com/booking/{from}-to-{to}-bus-tickets?refererid=…`, slugs lowercase, spaces→`-`; unknown pair 404. GET cannot prefill date.
