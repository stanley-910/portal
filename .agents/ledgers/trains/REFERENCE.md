# Trains — REFERENCE

Codebase: core `REFERENCE.md`. Provider truth in `.agents/docs/api/`.

| Provider id | Folder | Env | Doc |
|---|---|---|---|
| `tdx` | `src/lib/transport/providers/tdx/` (shared w/ buses) | `TDX_CLIENT_ID`, `TDX_CLIENT_SECRET` | `taiwan-tdx.md` |
| `korea-tago` | `src/lib/transport/providers/korea-tago/` (shared w/ buses) | `DATA_GO_KR_SERVICE_KEY` (**Decoding** key) | `korea-data-go-kr.md` |
| `china-rail` | `src/lib/transport/providers/china-rail/` | `TRIPCOM_AFFILIATE_ID`, `TWELVEGO_AFFILIATE_ID` | `china-12306.md` |
| `gtfs` | `src/lib/transport/providers/gtfs/` (buses B03 owns) | — | `gtfs.md` |

TDX quick facts:
- Token `POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token` form `grant_type=client_credentials` → `access_token`, `expires_in` 86400. Token endpoint 20 req/min/IP.
- Base `https://tdx.transportdata.tw/api/basic`. `$format=JSON` **required**.
- THSR v2 = bare array; TRA v3 = wrapper (`TrainTimetables`, `ODFares`, `Stations`).
- Times `HH:mm` or `HH:mm:ss`, Asia/Taipei (+08:00). THSR IDs e.g. `1000` Taipei, `1070` Zuoying.

Korea quick facts:
- Base `https://apis.data.go.kr/1613000/TrainInfo`, op `GetStrtpntAlocFndTrainInfo` (`depPlaceId`, `arrPlaceId`, `depPlandTime` YYYYMMDD, `_type=json`).
- Times `YYYYMMDDHHMMSS`, Asia/Seoul. Error code 30 = key not registered / double-encoded key.
- Single item may come back as object not array — normalise.
