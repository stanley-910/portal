# Taiwan TDX (Transport Data eXchange) — API ground truth
Checked: 2026-10-02 · Modes: trains (THSR, TRA), buses (InterCity, City) · Seat: Ahmet

## Verdict
- **Official** (MOTC gov platform), real Swagger/OAS 3.0.4, OAuth2. Best-documented API of this batch. [S1][S2]
- **"Free" only barely, and it's metered.** Since 2024-01-01 TDX is paid by points. Free "基礎" tier = **3 points/month** + **5 req/min/key**. 1 point = 1,500 calls or 150 MB → ~4,500 calls/month total. Paid tiers start TWD 200/mo. [S3][S4][S1]
- **Guest mode useless for us:** no key → 20 calls/day **per IP**, "browser only", basic services only. Vercel shared egress IP will burn it instantly. [S1][O1]
- **Signup gated by Taiwan phone SMS.** No Taiwan number → "Manual Verification": email tdx@motc.gov.tw identity statement + app description; human review, time `unverified`. Foreigners possible, slow. [S5]
- Live seats: THSR only (`AvailableSeatStatus`, status O/L/X, not counts). TRA = timetable + fares + live delay, **no seat availability**. Buses = schedules + real-time ETA, **no OD search**.
- Biggest blocker: Taiwan-phone signup + 5 req/min. Fallback: seed static THSR/TRA station + timetable JSON fetched once with key (or within guest 20/day) and cache hard.

## Access
| Item | Value |
|---|---|
| Signup | https://tdx.transportdata.tw/register → API key at 會員中心→資料服務→API金鑰 [S1] |
| You get | Client Id + Client Secret (OAuth2 client_credentials) [S1][S2] |
| Approval | Email + SMS verify (each phone binds max 3 accounts). Non-TW phone: manual review via tdx@motc.gov.tw / +886 2 2349 2803 [S5] |
| Foreigners | Allowed via manual verification; turnaround `unverified` |
| Cost | 基礎 TWD 0, 3 pts/mo, 5 次/分/金鑰. 銅 TWD 200–800, 5/s. 銀 1,000–4,750, 10/s. 金 5,000–9,500, 30/s. 白金 10,000–20,000, 50/s [S4] |
| Discounts | Students/academic non-commercial 50% off; one account, one year [S3] |
| ToS | Data classes 免審核 / 需審核; all "有償提供" per fee rules [S5]. Attribution wording `unverified` |

Env vars:
```
TDX_CLIENT_ID=
TDX_CLIENT_SECRET=
```

## Auth + base URL
- Token: `POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`, form body `grant_type=client_credentials&client_id=…&client_secret=…` [S2][S6]
- Token → `access_token` (JWT), `expires_in` 86400 s default, `token_type` Bearer [S6]
- Call: header `Authorization: Bearer $TOKEN`. Recommend `Accept-Encoding: br,gzip` [S6]
- Base: `https://tdx.transportdata.tw/api/basic` (server in OAS) [S1]. TLS ≥1.2 only [S6]

## Endpoints we use
All GET. All take OData `$select $filter $orderby $top $skip`, `$format` (**required**, `JSON`|`XML`), `health=true`; v3 + seat endpoints also `$count`. Dates `yyyy-MM-dd`. [S1][S7][S8]

| Path | Purpose | Key params | Key response fields |
|---|---|---|---|
| `/v2/Rail/THSR/Station` | THSR stations | — | `StationUID StationID StationCode StationName{Zh_tw,En,Ja,Ko} StationPosition{PositionLon,PositionLat} LocationCity` (array root) |
| `/v2/Rail/THSR/DailyTimetable/OD/{OriginStationID}/to/{DestinationStationID}/{TrainDate}` | THSR trains A→B on date | path IDs e.g. `1000`(Taipei) `1070`(Zuoying) | `[].DailyTrainInfo{TrainNo,Direction,StartingStationID,EndingStationID,Note,Overnight} OriginStopTime{StationID,ArrivalTime,DepartureTime} DestinationStopTime{…}` |
| `/v2/Rail/THSR/DailyTimetable/TrainDates` | which dates are published | — | dates list |
| `/v2/Rail/THSR/ODFare/{OriginStationID}/to/{DestinationStationID}` | THSR fare | — | `[].Fares[]{TicketType,FareClass,CabinClass,Price}` (TWD; CabinClass 1 標準 2 商務 3 自由) |
| `/v2/Rail/THSR/AvailableSeatStatus/Train/OD/{OriginStationID}/to/{DestinationStationID}/TrainDate/{TrainDate}` | live seat status per train | `/TrainNo/{TrainNo}` variant exists | `{TrainDate, AvailableSeats[]{TrainNo,OriginStationCode,DestinationStationCode,StandardSeatStatus,BusinessSeatStatus}, SrcUpdateTime}` |
| `/v2/Rail/THSR/AvailableSeatStatusList/{StationID}` | station board seats | — | `AvailableSeats[].StopStations[]{StandardSeatStatus,BusinessSeatStatus}` `O`有/`L`有限/`X`無 |
| `/v3/Rail/TRA/Station` | TRA stations | — | wrapper `{UpdateTime,…,Stations[]{StationUID,StationID,ReservationCode,StationName{Zh_tw,En},StationPosition,StationClass}}` |
| `/v3/Rail/TRA/DailyTrainTimetable/OD/{OriginStationID}/to/{DestinationStationID}/{TrainDate}` | TRA trains A→B (only queried stops); `/OD/Inclusive/…` = all stops | — | `{TrainDate, TrainTimetables[]{TrainInfo{TrainNo,TrainTypeCode,TrainTypeName,TripLine,SuspendedFlag,…}, StopTimes[]{StationID,ArrivalTime,DepartureTime}}}` |
| `/v3/Rail/TRA/ODFare/{OriginStationID}/to/{DestinationStationID}` | TRA fare | — | `ODFares[]{TrainType, Fares[]{TicketType,FareClass,CabinClass,Price}, TravelDistance}` |
| `/v3/Rail/TRA/StationLiveBoard/Station/{StationID}` | TRA live delays | — | `StationLiveBoards[]{TrainNo,ScheduleDepartureTime,DelayTime,RunningStatus(0準點1誤點2取消),Platform}` |
| `/v2/Bus/Route/InterCity/{RouteName}` | 公路/國道客運 route | RouteName zh e.g. `9001` | `RouteUID RouteName SubRoutes[]{Direction,FirstBusTime} BusRouteType(12 公路,13 國道) DepartureStopNameZh DestinationStopNameZh TicketPriceDescriptionZh` |
| `/v2/Bus/StopOfRoute/InterCity/{RouteName}` | stops on route | — | `Stops[]{StopUID,StopName,StopSequence,StopPosition,StopBoarding}` |
| `/v2/Bus/Schedule/InterCity/{RouteName}` | timetable | — | `Timetables[]{TripID,ServiceDay,StopTimes}` / `Frequencys[]{StartTime,EndTime,MinHeadwayMins}` |
| `/v2/Bus/DailyTimeTable/InterCity/{RouteName}` | daily timetable | — | (schema not dumped) `unverified` |
| `/v2/Bus/RouteFare/InterCity/{RouteName}` | fare | — | `unverified` field list |
| `/v2/Bus/Route/City/{City}/{RouteName}` + `StopOfRoute`, `Schedule` same pattern | city bus | `City` enum `Taipei NewTaipei Taoyuan Taichung Tainan Kaohsiung Keelung Hsinchu HsinchuCounty … LienchiangCounty` | as above |
| `/v2/Bus/EstimatedTimeOfArrival/City/{City}/{RouteName}` (also `/InterCity/{RouteName}`) | real-time ETA | — | `StopUID StopName Direction EstimateTime(s, null if no bus) StopStatus(0正常1未發車2交管3末班已過4今日未營運) PlateNumb IsLastBus` |

Example (docs shape; secrets as env):
```bash
TOKEN=$(curl -s -X POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "grant_type=client_credentials&client_id=$TDX_CLIENT_ID&client_secret=$TDX_CLIENT_SECRET" | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept-Encoding: br,gzip' --compressed \
  "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/OD/1000/to/1070/2026-10-03?\$format=JSON&\$top=1"
```
Response (observed 2026-10-02, guest mode, trimmed):
```json
[{"TrainDate":"2026-10-03",
  "DailyTrainInfo":{"TrainNo":"0803","Direction":0,"StartingStationID":"0990",
    "StartingStationName":{"Zh_tw":"南港","En":"Nangang"},"EndingStationID":"1070","Note":{},"Overnight":false},
  "OriginStopTime":{"StopSequence":2,"StationID":"1000","ArrivalTime":"06:23","DepartureTime":"06:26"},
  "DestinationStopTime":{"StopSequence":12,"StationID":"1070","ArrivalTime":"08:40","DepartureTime":"08:40"},
  "UpdateTime":"2026-09-04T05:34:38+08:00","VersionID":1}]
```
Seat status (observed): `{"TrainDate":"2026-10-03","AvailableSeats":[{"TrainNo":"0109","OriginStationCode":"TPE","DestinationStationCode":"ZUY","StandardSeatStatus":"X","BusinessSeatStatus":"X"}]}`

## Limits
| Scope | Limit | Source |
|---|---|---|
| Guest (no key) | 20 calls/day per IP, browser only, basic services | [S1]; headers `x-ratelimit-limit-day: 20`, `ratelimit-limit: 20` [O1] |
| Free member 基礎 | 5 req/min/key, 3 pts/month | [S4] |
| Points | 1 pt = 1,500 calls **or** 150 MB (how combined `unverified`) | [S1] |
| Overage | 5% buffer pts, then service stops for month | [S3] |
| Token endpoint | 20 req/min per IP | [S6] |
| Pagination | `$top`/`$skip`; Swagger default `$top=30` (whether server enforces default `unverified`) | [S1] |
- Cache: token 24 h (refresh every 4–6 h suggested [S6]); stations/fares days; timetables per date; seat status ~minutes.

## Coverage
- THSR: all 12 stations; daily timetable (dates via `TrainDates`), fares, **live seat status O/L/X**, free-seating cars.
- TRA: v3 stations, lines, daily/general timetables, OD fares, live board/delays. No seats.
- Bus: 22 city/county `City` values + InterCity (公路/國道客運). Routes, stops, schedules, fares, real-time ETA/positions. No OD trip planner (MaaS 旅運規劃 module exists, separate, `unverified`).
- No booking via API.

## Errors
| Case | Shape |
|---|---|
| Bad/expired token | HTTP 401, body `invalid token` (plain text) [O1] |
| Rate limit | HTTP 429 likely (Kong gateway, `via: kong/2.8.3` observed) — body `unverified` |
| Service health | `?health=true` returns status (shape `unverified`) [S1] |

## Gotchas
- `$format=JSON` is **required**; forget it → error/XML.
- `$` in query must be escaped in shell (`\$format`) and URL-encoded `%24` is fine.
- v2 THSR returns **bare array**; v3 TRA returns **wrapper object** (`Stations`, `TrainTimetables`, `ODFares`). Different parsers.
- Docs say `ArrivalTime` `HH:mm:ss`; observed THSR returns `HH:mm`. Parse both.
- TRA v3 `/OD/` lists only queried stops; use `/OD/Inclusive/` for full stop list.
- Seat status is a flag, not a seat count; frozen at last normal state during disruptions [S7].
- Bus `RouteName` is Traditional Chinese route name in path → URL-encode. Same name can have many `SubRoutes`/directions.
- Bus has no "A to B" query: must join StopOfRoute across routes ourselves.
- Times are Asia/Taipei (+08:00); `TrainDate` is local date.
- Free 5 req/min means: never fan out per-request; precompute + cache in committed fixtures or an in-memory/edge cache (no database, multiplayer M5).
- Guest quota is per IP — local dev works w/o key until 20/day, prod on Vercel won't.
- Guest from curl: `/v2/Rail/THSR/GeneralTimetable`, `/DailyTimetable/TrainDate/{d}`, `/DailyTimetable/OD/…` → `401 Valid API Key Required` with no UA; `/v2/Rail/THSR/Station` → 200 with browser `User-Agent` + `Referer: https://tdx.transportdata.tw/` (observed 2026-10-02, T06). GeneralTimetable with headers untried.
- THSR seed (ADR-T04) times come from thsrc.com.tw, not TDX: `POST https://www.thsrc.com.tw/TimeTable/Search` form `SearchType=S Lang=EN StartStation=TaiPei EndStation=ZuoYing OutWardSearchDate=YYYY/MM/DD OutWardSearchTime=00:00 …` → `data.DepartureTable.TrainItem[]{TrainNumber,RunDate,StationInfo[]{StationName,DepartureTime,Show}}`; full stop list per train; also lists previous night's cross-midnight trains (filter `RunDate`). Bad param → HTTP 405 HTML "操作異常" (observed 2026-10-02). Script `scripts/snapshot-thsr.mts`.

## Sources
| URL | What it confirms | Verified |
|---|---|---|
| [S1] https://tdx.transportdata.tw/webapi/File/Swagger/V3/268fc230-2e04-471b-a728-a726167c1cfc | Rail v2 OAS: paths, params, schemas, base URL, guest 20/day/IP, 1,500 calls or 150MB per point | yes |
| [S2] same OAS `components.securitySchemes` | OAuth2 clientCredentials tokenUrl | yes |
| [S3] https://www.motc.gov.tw/ch/app/data/doc?id=14&module=news&detailNo=1107913081326931968&serno=44e2cc94-8a1b-4fc0-b70e-f07551a05e2a&type=s&preview=&aplistdn= | 收費要點 (eff. 2024-01-01): tiers, 一般會員 3 pts free, 5% buffer, discounts | yes |
| [S4] https://tdx.transportdata.tw/webapi/pricing/ (backs /pricing page) | per-tier price, points, 5/min free, 5/10/30/50 per s paid | yes (observed JSON) |
| [S5] https://tdx.transportdata.tw/js/register.0366d62b.js (register page bundle) | SMS phone verify, 3 accounts/phone, manual verification for non-TW phone via tdx@motc.gov.tw | yes (page source) |
| [S6] https://github.com/tdxmotc/SampleCode | token POST, expires_in 86400, Bearer, 20/min token, gzip, TLS1.2 | yes (official MOTC repo) |
| [S7] https://tdx.transportdata.tw/webapi/File/Swagger/V3/5fa88b0c-120b-43f1-b188-c379ddb2593d | Rail v3 TRA paths + schemas | yes |
| [S8] https://tdx.transportdata.tw/webapi/File/Swagger/V3/2998e851-81d0-40f5-b26d-77e2f5ac4118 | Bus v2 paths, City enum, ETA schema | yes |
| [O1] curl 2026-10-02 `/v2/Rail/THSR/Station`, `DailyTimetable/OD/1000/to/1070/2026-10-03`, `AvailableSeatStatus/...` | guest headers, response shape, 401 body | observed |
