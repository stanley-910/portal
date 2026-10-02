# Trains — PLAN (Architecture)

Written once. Amend via `DECISIONS.md` ADR-T. Orientation: `REFERENCE.md` → core `REFERENCE.md`.
Ground truth: `.agents/docs/api/{taiwan-tdx,korea-data-go-kr,china-12306,rome2rio,gtfs}.md`.

## Goal

Train queries in Taiwan (THSR, TRA), Korea (KTX/Korail) and China return real timetables, with
fares where the source gives them and THSR seat flags, as `Offer`s honest about freshness.

## Invariant

> Never exceed a provider quota at request time, and never scrape a source that forbids it.

TDX free = 5 req/min/key, ~4,500 calls/month: station lists + fares snapshotted, timetables
cached per date. 12306 is never called at request time (ADR-T02).

## Topology

```
fanOut ─▶ providers/tdx/         client.ts (OAuth token cache 24h, shared w/ buses B01)
          │                      thsr.ts  DailyTimetable/OD + ODFare (+ seat flags)
          │                      tra.ts   v3 DailyTrainTimetable/OD + ODFare
          │                      stations.json (snapshot script)
          ├▶ providers/korea-tago/ client.ts (serviceKey, _type=json, shared w/ buses B02)
          │                      train.ts TrainInfo/GetStrtpntAlocFndTrainInfo
          │                      stations.json (GetCtyAcctoTrainSttnList snapshot)
          ├▶ providers/china-rail/ seed timetable JSON + Trip.com / 12Go link-out
          └▶ providers/gtfs/      (buses B03) KTMB + SRT rail pairs — T05 adds rail filter
```

## Decision table

| # | Decision | Chosen | Reason |
|---|---|---|---|
| D1 | Taiwan | THSR seed + link-out, no TDX key (ADR-T04; was TDX key, ADR-T01) | signup needs Taiwan phone or manual review; owner declined |
| D2 | Korea | data.go.kr TAGO `TrainInfo` (Pascal ops) | official, free, 10k/day dev |
| D3 | China | own seed + affiliate link-out | 12306 has no API; scraping legally risky (ADR-T02) |
| D4 | Rome2Rio | dropped | not accepting applications; docs 404 (ADR-T03) |
| D5 | SE Asia rail | GTFS (KTMB, SRT) via buses `gtfs` pipeline | no-key feeds exist |

## Phasing

T06 THSR seed (replaces T01/T02, ADR-T04) → T03 Korea KTX → T04 China seed → T05 GTFS rail.

## Out of scope

Booking, live seat counts (THSR flags only), Japan rail, 12306 live data.
