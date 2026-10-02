# T03 — Korea KTX seed adapter
REPO: (this repo) · Depends: C01 · Status: todo
Read first: STATE.md, REFERENCE.md, `.agents/docs/api/korea-data-go-kr.md`, ADR-T05, then this.
**Model: sonnet** — hand-curated data + mapper.

## Goal
Owner's ask:

> "South Korea KTX (data.go.kr) … Free for Trains"

> "what other apis do i need and those i need to sign lets mock datas for those" (2026-10-02)

No data.go.kr key (ADR-T05). Typical timetable + adult fare for Korail trains (KTX and others)
on demo pairs, from a hand-curated seed. B02 adds buses in the same `korea-tago` folder.

## Non-negotiables
- Zero request-time network calls. No TAGO client, no `DATA_GO_KR_SERVICE_KEY` read in MVP.
- Seed rows per core ADR-C05: `departures` `HH:MM`, `tz: "Asia/Seoul"`, `durationMin`, train grade + number, adult fare KRW, `source` (public Korail timetable/fare page URL + date read). No times known → row not seeded.
- `kind: "timetable"`; `price` = seeded adult fare, currency KRW.
- Works with empty `.env` — never `NOT_CONFIGURED`.

## Context (anchors)
- Demo pairs, both directions: Seoul–Busan, Seoul–Daejeon, Seoul–Dongdaegu, Seoul–Gwangju-Songjeong, Seoul–Gangneung, Yongsan–Mokpo.
- Station coords hand-entered with `source` (Seoul, Yongsan, Busan, Daejeon, Dongdaegu, Gwangju-Songjeong, Gangneung, Mokpo).
- Times → ISO `+09:00`.
- Trap: `providers/korea-tago/index.ts` and `seed.ts` are also edited by buses B02 (depends on T03) — never in parallel.

## Steps
- [ ] `korea-tago/train-stations.json` (name En/Ko, lat/lng, `source`).
- [ ] `korea-tago/train-seed.json` per pair (`departures`, `tz`, `durationMin`, `carrier`, `number`, `fareKrw`, `source`).
- [ ] `seed.ts` typed loader; `train.ts`: nearest station within 15 km, seeded pair only → one `Offer` per departure on `q.date` (`mode:"train"`, `carrier` = grade e.g. "KTX").
- [ ] `index.ts`: `covers` = both ends snap to a seeded pair; dispatch train (bus in B02).
- [ ] Tests: Seoul→Busan offers with `+09:00` and KRW price; reverse direction; unseeded pair → `covers` false; `fetch` mocked to throw → search still succeeds; every seed row has `source`.

## Files touched
- `src/lib/transport/providers/korea-tago/index.ts` (replaces C01 stub)
- `src/lib/transport/providers/korea-tago/seed.ts`, `train.ts` (new)
- `src/lib/transport/providers/korea-tago/train-stations.json`, `train-seed.json` (new)
- `src/lib/transport/providers/korea-tago/korea-tago.test.ts` (new)

## Definition of done
- Seoul → Busan, any date, returns KTX timetable offers with KRW fares.

## Verification
`pnpm lint && pnpm exec tsc --noEmit && pnpm test -- korea-tago`

Seed (after C02, empty `.env`): curl `/api/transport/search` Seoul 37.5547,126.9707 → Busan 35.1151,129.0422 (query shape per C02); expect `korea-tago` offers, `kind:"timetable"`, KRW price.

## Notes

