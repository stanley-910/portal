# Korea data.go.kr (TAGO train + express/intercity bus) — API ground truth
Checked: 2026-10-02 · Modes: trains (KTX/Korail), buses (고속 express, 시외 intercity) · Seat: Ahmet

## Verdict
- **Official + free** (국토교통부 TAGO via 공공데이터포털). 비용 무료, 이용허락범위 제한 없음, auto-approval dev + prod. [S1][S2][S3]
- **Biggest blocker = signup.** Signup page offers only 일반회원 "만 14세 이상 **내국인**", 어린이(내국인), 기업회원(국세청 사업자) + mandatory **본인인증** step. No foreigner category observed. Need a Korean teammate/friend with Korean phone or i-PIN to create account. [S4]
- Data = **timetable + adult fare only**. No live seats, no booking. Train op returns `adultcharge`; bus returns `charge`.
- **Endpoints moved (2026-03).** Old `TrainInfoService/getStrtpntAlocFndTrainInfo` (lower camel) is legacy; current Swagger = `TrainInfo/GetStrtpntAlocFndTrainInfo` (Pascal). Old 국토교통부_열차정보 returns code 12. [S1][S7]
- 시외버스 (SuburbsBusInfo) **same-day dispatch only** per provider note. [S3]
- Fallback if no Korean account: static seed of station/terminal IDs + hand-off links (Korail/Kobus sites); no legal live source found.

## Access
| Item | Value |
|---|---|
| Signup | https://www.data.go.kr/uim/login/signupView.do (also Naver/Kakao simple login at https://auth.data.go.kr/) [S4] |
| Apply | Each API page → 활용신청 → 개인 서비스키 (or 프로젝트 서비스키) [S1] |
| You get | 일반 인증키 in **two forms**: Encoding + Decoding (same key) [S5] |
| Approval | 심의유형 개발단계: 자동승인 / 운영단계: 자동승인 [S1][S2][S3]. Delay before key works after approval: `unverified` (commonly ~1 h) |
| Foreigners | Not offered on signup page (내국인 only + 본인인증) [S4]. Foreigner w/ ARC + Korean phone may pass 본인인증 → `unverified` |
| Traffic | 개발계정 10,000 / 운영계정: increase on 활용사례 등록 [S1][S2][S3] |
| ToS | 이용허락범위 제한 없음 (no license restriction) [S1] |

Env vars:
```
DATA_GO_KR_SERVICE_KEY=   # store the DECODING key (raw base64, has + / =)
```

## Auth + base URL
- Query param `serviceKey` on every call. No header auth. [S1]
- Bases (Swagger `host`, schemes https/http) [S1][S2][S3]:
  - Train: `https://apis.data.go.kr/1613000/TrainInfo`
  - Express bus: `https://apis.data.go.kr/1613000/ExpBusInfo`
  - Intercity bus: `https://apis.data.go.kr/1613000/SuburbsBusInfo`
- Common optional params: `pageNo`, `numOfRows`, `_type` (`xml`|`json`; default XML). [S1]

## Endpoints we use
All GET. Response envelope `response.header{resultCode,resultMsg}` + `response.body{items.item[],numOfRows,pageNo,totalCount}` [S1].

| Operation | Purpose | Key params | Key response fields (`items.item`) |
|---|---|---|---|
| `TrainInfo/GetCtyCodeList` | city/province codes | — | `citycode cityname` |
| `TrainInfo/GetCtyAcctoTrainSttnList` | stations per city | `cityCode`* | `nodeid nodename` |
| `TrainInfo/GetVhcleKndList` | train kinds (KTX etc.) | — | `vehiclekndid vehiclekndnm` |
| `TrainInfo/GetStrtpntAlocFndTrainInfo` | trains A→B on date | `depPlaceId`* `arrPlaceId`* (=`nodeid`), `depPlandTime` YYYYMMDD (null→today), `trainGradeCode` (=`vehiclekndid`) | `trainno traingradename depplandtime arrplandtime` (YYYYMMDDHHMISS) `depplacename arrplacename adultcharge` (KRW) |
| `ExpBusInfo/GetCtyCodeList` | city codes | — | `cityCode cityName` |
| `ExpBusInfo/GetExpBusTrminlList` | express terminals | `terminalNm` | `terminalId terminalNm` |
| `ExpBusInfo/GetExpBusGradList` | bus grades | — | `gradeId gradeNm` |
| `ExpBusInfo/GetStrtpntAlocFndExpbusInfo` | express buses A→B | `depTerminalId`* `arrTerminalId`* `depPlandTime` YYYYMMDD (omit→today) `busGradeId` | `routeId gradeNm depPlandTime arrPlandTime` (YYYYMMDDHHMI) `depPlaceNm arrPlaceNm charge` |
| `SuburbsBusInfo/GetCtyCodeList` | city codes | — | `cityCode cityName` |
| `SuburbsBusInfo/GetSuberbsBusTrminlList` | intercity terminals | `terminalNm` `cityCode` | `terminalId terminalNm cityName` |
| `SuburbsBusInfo/GetSuberbsBusGradList` | grades | — | `gradeId gradeNm` |
| `SuburbsBusInfo/GetStrtpntAlocFndSuberbsBusInfo` | intercity buses A→B (today only) | `depTerminalId`* `arrTerminalId`* `depPlandTime` | `routeId gradeNm depPlandTime arrPlandTime depPlaceNm arrPlaceNm charge` |
`*` = required in Swagger.

Example (docs shape):
```bash
curl -s -G "https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo" \
  --data-urlencode "serviceKey=$DATA_GO_KR_SERVICE_KEY" \
  -d _type=json -d numOfRows=50 -d pageNo=1 \
  -d depPlaceId=$DEP_NODEID -d arrPlaceId=$ARR_NODEID -d depPlandTime=20261003
```
Response (docs shape from Swagger; values illustrative, not observed — no key):
```json
{"response":{"header":{"resultCode":"00","resultMsg":"…"},
 "body":{"items":{"item":[{"trainno":"…","traingradename":"KTX","depplandtime":"20261003060000",
   "arrplandtime":"…","depplacename":"서울","arrplacename":"부산","adultcharge":"…"}]},
  "numOfRows":50,"pageNo":1,"totalCount":0}}}
```
Bad key (observed 2026-10-02, HTTP 403):
```json
{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR","returnAuthMsg":"등록되지 않은 서비스키","returnReasonCode":"30"}}}
```

## Limits
- Dev: **10,000 calls** per API per day (error 22 = "일일 호출 허용량" exceeded → daily). Each API (train / exp bus / suburbs bus) is a separate application with own quota. [S1][S6]
- Per-second limit exists (error 23); numeric value `unverified`. [S6]
- Pagination: `pageNo` + `numOfRows`; read `totalCount`. Default page size `unverified` (typically 10) → always set `numOfRows`.
- Cache: city/station/terminal/grade lists = static, seed once. Timetables per (pair, date).

## Coverage
- Train: Korail network incl. KTX, by city/station node IDs; scheduled timetable + adult fare. No seat availability, no SRT confirmation (`unverified` whether SRT trains included).
- Express bus (고속): nationwide terminals, scheduled departures + fare, any date provided (range `unverified`).
- Intercity bus (시외): **today only** ("현재 당일 배차정보만 제공") [S3].
- No booking, no live seats on any of these.

## Errors
Gateway codes (`returnReasonCode` / errMsg) [S6]:
| Code | errMsg | Meaning |
|---|---|---|
| 01 | APPLICATION_ERROR | GW internal error, retry |
| 04 | HTTP_ERROR | bad method/URL |
| 05 | SERVICETIMEOUT_ERROR | upstream timeout |
| 10 | INVALID_REQUEST_PARAMETER_ERROR | bad param |
| 12 | NO_OPENAPI_SERVICE_ERROR | service missing/deprecated (old path!) |
| 20 | SERVICE_KEY_IS_NULL / PERMISSION_DENIED / SERVICE_ACCESS_DENIED_ERROR | no key / not applied |
| 22 | LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR | daily quota |
| 23 | LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR | per-second |
| 29 | BLACKLIST_IP_ACCESS_ERROR | IP blocked |
| 30 | SERVICE_KEY_IS_NOT_REGISTERED_ERROR | wrong/double-encoded key |
| 31 | DEADLINE_HAS_EXPIRED_ERROR | key expired |
- Gateway errors come as `OpenAPI_ServiceResponse.cmmMsgHeader` (not `response.header`) with HTTP 403 [O1]. Check both shapes.

## Gotchas
- **Encoding vs Decoding key:** portal shows both. Our fetch/URLSearchParams encodes again → use **Decoding** key; Encoding key becomes `%252B` → error 30. Decoding key never contains `%`. [S5]
- Op names are **PascalCase** (`Get…`) on current paths; old lower-camel `TrainInfoService/get…` = legacy. [S1][S7]
- Typo is real: service `SuburbsBusInfo` but ops `GetSuberbsBusTrminlList`, `GetStrtpntAlocFndSuberbsBusInfo`. [S3]
- Field casing differs per API: train = all-lowercase (`depplandtime`, `nodeid`, `citycode`); bus = camel (`depPlandTime`, `terminalId`, `cityCode`).
- Time formats differ: train `YYYYMMDDHHMISS` (14), bus `YYYYMMDDHHMI` (12). JSON may give numbers not strings → `unverified`, coerce.
- data.go.kr XML→JSON classic trap: single result may come as object not array, empty → `items: ""` (`unverified` for these APIs) — normalize.
- Default `_type` is XML; always pass `_type=json`.
- Names are Korean only (`depplacename` 서울). Need own romanization map.
- Station IDs come from `GetCtyAcctoTrainSttnList` per `cityCode` — loop all cities once and store.

## Sources
| URL | What it confirms | Verified |
|---|---|---|
| [S1] https://www.data.go.kr/data/15098552/openapi.do | TAGO 열차정보: embedded Swagger (host `apis.data.go.kr/1613000/TrainInfo`, 4 ops, params, fields), free, auto-approval, dev 10,000, 수정일 2026-03-06 | yes |
| [S2] https://www.data.go.kr/data/15098522/openapi.do | TAGO 고속버스정보: `ExpBusInfo` ops/params/fields, free, auto, 10,000 | yes |
| [S3] https://www.data.go.kr/data/15098541/openapi.do | TAGO 시외버스정보: `SuburbsBusInfo` ops (Suberbs typo), today-only note | yes |
| [S4] https://www.data.go.kr/uim/login/signupView.do | member types 내국인 only + 본인인증 step | yes (page text) |
| [S5] https://www.kick-off.co.kr/8077 · https://github.com/S-DUNG/Ongil-Server/pull/5 | Encoding/Decoding key, double-encoding → code 30 | unverified (secondary) |
| [S6] error-code table on [S1] page | codes 01–31 meanings, 22 = daily | yes |
| [S7] https://github.com/dhmailing/RailFlow/pull/5 | old path → code 12, rename to PascalCase | unverified (secondary; consistent with [S1]) |
| [O1] curl 2026-10-02 `TrainInfo/GetVhcleKndList?serviceKey=INVALID&_type=json` | HTTP 403 + `OpenAPI_ServiceResponse` shape, path alive | observed |
