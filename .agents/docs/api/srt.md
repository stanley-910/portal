# SRT (State Railway of Thailand) — API ground truth
Checked: 2026-10-03 · Modes: train · Seat: Ahmet · Provider id `srt` (core ADR-C08, trains ADR-T06)

## Verdict
- **No public API.** Timetable = public web pages on `ttsview.railway.co.th`; booking = SRT D-Ticket (POST form, login). [S1][S3] observed 2026-10-03
- Ship as committed seed (`providers/srt/seed.json`), refreshed by `pnpm srt:snapshot`. No request-time calls.
- Fares not in the classic timetable page → seed has none (`price` absent).

## Access
| Item | Value |
|---|---|
| Signup | none for timetable pages. D-Ticket booking needs an SRT account (user's own) |
| Auth | none for [S1][S2]. Per-train pages + modern matrix API: **Cloudflare Turnstile + JWT** — not used, not bypassed |
| Cost | free |
| ToS / licence | `unverified` — no data licence found on ttsview; we store times only, cite the page per train |

## Endpoints
| URL | Gives | Notes |
|---|---|---|
| `https://ttsview.railway.co.th/SRT_Schedule2022.php?ln=en&line=<n>&trip=<1\|2>` [S1] | HTML table: rows = stations (`Dep.`, last `Arr.`), header row = train numbers, then one time row per station | line 1 Northern, 2 Northeastern, 3 Eastern, 4 Southern, 5 Wongwian Yai–Mahachai, 6 Ban Laem–Mae Klong, 7 Southern (Thon Buri). trip 1 = outbound from Bangkok, 2 = inbound. ~0.3–0.7 MB each. Browsers get meta-refresh → `timetable_modern.php`; curl gets the table (observed 2026-10-03) |
| `https://ttsview.railway.co.th/timetable_modern/timetable_data.js` [S2] | JS consts: `trainDetails` (type: special/express/rapid/ordinary/local/suburban/feeder_dm/tourist), `trainRunningDays` (en: `Everyday`, `Workdays Only`, `Mon - Fri`, `Sat - Sun`, `Cancelled`, `GO:<date>`) | same host, no auth |
| `timetable_modern/api_get_timetable_matrix.php`, `searchresult_2023.php?trainno=` | JSON matrix / per-train page | Turnstile-gated (observed 2026-10-03) |
| `https://dticket.railway.co.th/DTicketPublicWeb/home/Home` [S3] | D-Ticket booking home | root → `./DTicketPublicWeb` → `/home/Home`, HTTP 200. Search = `POST booking/booking` (`provinceStart`, `provinceEnd`, `date-start`) → **no deep link** |

## Limits
- None published. Snapshot fetches 7 files, cached in `.cache/srt/<date>/`.

## Coverage (seed 2026-10-03)
- 124 trains, 36 stations: Northern (to Chiang Mai), Northeastern (Nong Khai, Ubon), Southern (Hat Yai, Padang Besar, Su-ngai Kolok, Trang, Nakhon Si Thammarat). Eastern + Mahachai/Mae Klong + Thon Buri lines not seeded.
- Station coords: namtang GTFS `stops.txt` (feed_version 20261001); Padang Besar, Trang, Nakhon Si Thammarat from Wikipedia (not in namtang).

## Errors
| Case | Behaviour |
|---|---|
| `www.railway.co.th` from this machine | TLS reset / timeout (observed 2026-10-03) — use `ttsview.` |
| `dticket.railway.co.th` on local resolver | NXDOMAIN; resolves on 8.8.8.8 → 103.125.92.40 / 61.91.250.200 (observed 2026-10-03). Users' browsers fine |

## Gotchas
- Times are departures; **terminus row = arrival** (TTS remark). One time per station, no arr/dep pair.
- Row order ≠ running order on spurs: Nakhon Si Thammarat / Khao Chum Thong Jn, Surat Thani / Khiri Ratthanikhom, Taling Chan / Bang Bamru. Snapshot swaps the adjacent pair when times say so (observed 2026-10-03).
- Source typos: train 23 lists Surin 00:48 between Buri Ram 03:12 and Sikhoraphum 04:17 → stop dropped, never patched. Trains 355/356 (Suphan Buri) tangled → 355 skipped.
- Some columns repeat verbatim (52 ×2, 318 ×5) → dedupe.
- `Workdays Only` = Mon–Fri **excluding public holidays**; seed models Mon–Fri only.
- 173/174 `GO:15/05/2026` (en) vs `เริ่ม 15 พย.69` (th, = 15 Nov 2026) disagree → not seeded. 340/342/448/464/741–744 have no `trainDetails` type → not seeded.
- Bangkok: long-distance trains use Krung Thep Aphiwat (Bang Sue); commuters/ordinary use Hua Lamphong. Both = city `bangkok`.
- Trains 37 + 45 leave Bangkok together (16:10) and split at Hat Yai — two offers, by design.
- namtang SRT trips unusable (placeholder times) → see `gtfs.md` § Gotchas; `gtfs` keeps them dropped.

## Sources
| ID | URL | Confirms | Verified |
|---|---|---|---|
| S1 | https://ttsview.railway.co.th/SRT_Schedule2022.php?ln=en&line=1&trip=1 | table layout, times | yes (observed 2026-10-03) |
| S2 | https://ttsview.railway.co.th/timetable_modern/timetable_data.js | types, running days, remarks | yes (observed 2026-10-03) |
| S3 | https://dticket.railway.co.th/DTicketPublicWeb/home/Home | booking page, POST search form | yes (observed 2026-10-03) |
| S4 | https://namtang-api.otp.go.th/download/namtang-gtfs.zip | station coords, Thai names | yes (feed 20261001) |
