# T03 — Korea TAGO client + KTX adapter
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/korea-data-go-kr.md`, then this.
**Model: sonnet** — mapper; key trap documented.

## Goal
Owner's ask:

> "South Korea KTX (data.go.kr) … Free for Trains"

Timetable + adult fare for Korail trains (KTX and others). B02 reuses the client for buses.

## Non-negotiables
- Store/use the **Decoding** key; pass via `URLSearchParams` once (no double encoding → error 30).
- Pascal ops only (`TrainInfo/GetStrtpntAlocFndTrainInfo`); legacy `TrainInfoService/get…` forbidden.
- `_type=json`. `items.item` may be object, array, or `""` when empty — normalise.
- Error envelope `OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode` 30 → `AUTH_FAILED`; 22 (quota) → `RATE_LIMITED`.

## Context (anchors)
- Station ids (`nodeid`) via `GetCtyCodeList` + `GetCtyAcctoTrainSttnList` — snapshot script, committed. Lat/lng not in response → add coords for major stations by hand (Seoul, Yongsan, Busan, Daejeon, Dongdaegu, Gwangju-Songjeong, Gangneung…), `source` cited.
- Times `YYYYMMDDHHMMSS` Asia/Seoul → ISO `+09:00`.

## Steps
- [ ] `client.ts` `tagoGet(service, op, params)`.
- [ ] `scripts/snapshot-tago-stations.mts` → `train-stations.json`.
- [ ] `train.ts` map → `Offer` (`carrier = traingradename`, `number = trainno`, price `adultcharge` KRW).
- [ ] Tests: array/object/empty item shapes; time parse; code 30 → `AUTH_FAILED`; key not double-encoded in built URL.

## Definition of done
- Seoul → Busan tomorrow returns KTX offers with KRW fares.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- korea-tago`

## Notes

