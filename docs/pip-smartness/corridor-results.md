# Corridor results

Run 2026-10-03T23:02:39.865Z, trip date 2026-10-17. Regenerate with `pnpm eval:pip evals/corridors.eval.ts`.

## Route optimizer

### Hong Kong → Shanghai
- 5.0 s, 14 searches; gateways: Shenzhen North, Macau International Airport, Shenzhen Bao'an International Airport, Guangzhou South, Futian
- 3 alternatives, 2 cheaper than direct, 0 without a total
- baseline: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, CNY 870 (cached fare). 3h10 from first departure to arrival, total CNY 870, same price.
- R1 via Macau International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 07:55, about 125 min to Macau International Airport, about CNY 80 (estimated from distance, not a timetable or fare); then 9C 9C8876: Macau International Airport 11:30 → Shanghai Pudong International Airport 14:15, CNY 530 (cached fare). 6h20 from first departure to arrival, total CNY 610, saves CNY 260.
- R2 via Shenzhen Bao'an International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 17:14, about 126 min to Shenzhen Bao'an International Airport, about CNY 80 (estimated from distance, not a timetable or fare); then 9C 9C8950: Shenzhen Bao'an International Airport 20:50 → Shanghai Hongqiao International Airport 23:20, CNY 572 (cached fare). 6h06 from first departure to arrival, total CNY 652, saves CNY 218.
- R3 via Shenzhen Bao'an International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 11:24, about 126 min to Shenzhen Bao'an International Airport, about CNY 80 (estimated from distance, not a timetable or fare); then ZH ZH9521: Shenzhen Bao'an International Airport 15:00 → Shanghai Pudong International Airport 17:20, CNY 806 (cached fare). 5h56 from first departure to arrival, total CNY 886, costs CNY 16 more.

### Seoul → Busan
- 3.3 s, 16 searches; gateways: PyeongtaekJije, Dongtan, 평택, 서정리, 오산
- 3 alternatives, 0 cheaper than direct, 0 without a total
- baseline: R0 direct on 2026-10-17: Mugunghwa 1151: Seoul 06:37 → Busan 12:53, KRW 28600 (timetable fare). 6h16 from first departure to arrival, total KRW 28600, same price.
- R1 direct on 2026-10-17: Mugunghwa 1161: Seoul 14:49 → Busan 20:09, KRW 28600 (timetable fare). 5h20 from first departure to arrival, total KRW 28600, same price.
- R2 direct on 2026-10-17: Mugunghwa 1159: Seoul 14:02 → Busan 19:50, KRW 28600 (timetable fare). 5h48 from first departure to arrival, total KRW 28600, same price.
- R3 direct on 2026-10-17: Mugunghwa 1153: Seoul 07:15 → Busan 13:04, KRW 28600 (timetable fare). 5h49 from first departure to arrival, total KRW 28600, same price.

### Singapore → Kuala Lumpur
- 3.0 s, 14 searches; gateways: KULAI, KEMPAS BARU, JB SENTRAL, Hang Nadim International Airport, Senai International Airport
- 3 alternatives, 0 cheaper than direct, 1 without a total
- baseline: R0 direct on 2026-10-17: AK AK720: Singapore Changi Airport 21:20 → Kuala Lumpur International Airport 22:25, SGD 82 (cached fare). 1h05 from first departure to arrival, total SGD 82, same price.
- R1 direct on 2026-10-17: OD OD817: Singapore Changi Airport 19:55 → Sultan Abdul Aziz Shah International Airport 13:00, SGD 108 (cached fare). 1h05 from first departure to arrival, total SGD 108, costs SGD 26 more.
- R2 direct on 2026-10-17: FY FY3133: Seletar Airport 19:00 → Sultan Abdul Aziz Shah International Airport 12:20, SGD 153 (cached fare). 1h20 from first departure to arrival, total SGD 153, costs SGD 71 more.
- R3 via KEMPAS BARU on 2026-10-17: Ground transfer and border from Singapore: leave by 08:31, about 124 min to KEMPAS BARU, about SGD 15 (estimated from distance, not a timetable or fare); then KTMB 9574: KEMPAS BARU 10:55 → BANGI 14:21, fare unknown (timetable fare). 5h50 from first departure to arrival, total total unknown (a fare is missing).

### Taipei → Kaohsiung
- 2.0 s, 8 searches; gateways: Hsinchu, Hualien Chiashan Airport, Taichung International Airport / Ching Chuang Kang Air Base
- 3 alternatives, 0 cheaper than direct, 3 without a total
- baseline: none priced
- R1 direct on 2026-10-17: Taiwan High Speed Rail 295: Taoyuan 22:35 → Tainan 23:48, fare unknown (timetable fare). 1h13 from first departure to arrival, total total unknown (a fare is missing).
- R2 direct on 2026-10-17: Taiwan High Speed Rail 205: Banqiao 07:59 → Tainan 09:18, fare unknown (timetable fare). 1h19 from first departure to arrival, total total unknown (a fare is missing).
- R3 direct on 2026-10-17: Taiwan High Speed Rail 207: Banqiao 08:39 → Tainan 09:58, fare unknown (timetable fare). 1h19 from first departure to arrival, total total unknown (a fare is missing).

### Bangkok → Chiang Mai
- 2.8 s, 10 searches; gateways: Ayutthaya, Tha Rua, Ban Phachi Junction
- 3 alternatives, 0 cheaper than direct, 3 without a total
- baseline: R0 direct on 2026-10-17: SL SL522: Don Mueang International Airport 20:15 → Chiang Mai International Airport 21:25, THB 1237 (cached fare). 1h10 from first departure to arrival, total THB 1237, same price.
- R1 direct on 2026-10-17: The Transport Company Limited 18: Small Bus Terminal (Chatuchak) (Mo Chit 2) 20:20 → Chiang Mai Bus Terminal 2 (Arcade) 04:58 next day, fare unknown (timetable fare). 8h38 from first departure to arrival, total total unknown (a fare is missing).
- R2 direct on 2026-10-17: Busarakam Tour 13: Small Bus Terminal (Chatuchak) (Mo Chit 2) 00:01 → Chiang Mai Bus Terminal 2 (Arcade) 08:43, fare unknown (timetable fare). 8h42 from first departure to arrival, total total unknown (a fare is missing).
- R3 direct on 2026-10-17: The Transport Company Limited 13: Small Bus Terminal (Chatuchak) (Mo Chit 2) 18:10 → Chiang Mai Bus Terminal 2 (Arcade) 02:54 next day, fare unknown (timetable fare). 8h44 from first departure to arrival, total total unknown (a fare is missing).

### Hong Kong → Tokyo
- 1.8 s, 12 searches; gateways: Shenzhen North, Macau International Airport, Shenzhen Bao'an International Airport, Zhuhai Jinwan Airport, Guangzhou Baiyun International Airport
- 1 alternatives, 0 cheaper than direct, 0 without a total
- baseline: R0 direct on 2026-10-17: UO UO628: Hong Kong International Airport 20:00 → Tokyo Haneda International Airport 01:20 next day, HKD 1471 (cached fare). 4h20 from first departure to arrival, total HKD 1471, same price.
- R1 via Guangzhou Baiyun International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 15:57, about 243 min to Guangzhou Baiyun International Airport, about HKD 164 (estimated from distance, not a timetable or fare); then HO HO1852: Guangzhou Baiyun International Airport 21:30 → Tokyo Haneda International Airport 03:40 next day, HKD 2094 (cached fare). 10h43 from first departure to arrival, total HKD 2258, costs HKD 787 more.

## Pip

### Hong Kong → Shanghai
- 7.5 s total, first words at 6.7 s, 2 model steps, reasoning tokens per step 263 / 135
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Hong Kong","to":"Shanghai","date":"2026-10-17","currency":"USD"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, USD 130 (cached fare). 3h10 from first departure to arrival, total USD 130, same price. | R1 via Macau International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 07:55, about 125 min to Macau International Airport, about USD 11 (estimated from distance, not a timetable or fare); then 9C 9C8876: Macau International Airport 11:30 → Shanghai Pudong International Airport 14:15, USD 79 (cached fare). 6h20 from first departure to arrival, total USD 90, saves USD 40. | R2 via Shenzhen Bao'an International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 17:14, about 126 min to Shenzhen Bao'an International Airport, about USD 11 (estimated from distance, not a timetable or fare); then 9C 9C8950: Shenzhen Bao'an International Airport 20:50 → Shanghai Hongqiao International Airport 23:20, USD 85 (cached fare). 6h06 from first departure to arrival, total USD 96, saves USD 34. | R3 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:49 (runs every few minutes) → Shenzhen North 11:34, HKD 58 (estimated); then G100: Shenzhen North 11:59 → Shanghai Hongqiao 19:25, CNY 878.5 (timetable fare). 9h36 from first departure to arrival, total about USD 129, saves USD 1.
- unsourced money: none

> Good news, Sam. Leave Hong Kong by 07:55 for Macau airport (about 125 min with the border, roughly USD 11, estimated from distance), then 9C8876 at 11:30, landing Shanghai Pudong 14:15, total about USD 90 — that's USD 40 off the direct USD 130 flight. If you'd rather not cross to Macau, there's a Shenzhen Bao'an version for USD 96 that gets in at 23:20; say the word and I'll put the via stop on your globe.

### Seoul → Busan
- 7.0 s total, first words at 6.3 s, 2 model steps, reasoning tokens per step 175 / 150
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Seoul","Busan"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Seoul","to":"Busan","date":"2026-10-17","currency":"USD"}
  - optimizer said: R0 direct on 2026-10-17: Mugunghwa 1151: Seoul 06:37 → Busan 12:53, KRW 28600 (timetable fare). 6h16 from first departure to arrival, total about USD 21, same price. | R1 direct on 2026-10-17: Express Standard: Seoul Express Bus Terminal (Gyeongbu) 17:20 → Busan Central Bus Terminal (Nopo) 21:20, KRW 29100 (timetable fare). 4h00 from first departure to arrival, total about USD 21, same price. | R2 direct on 2026-10-17: Express Standard: Seoul Express Bus Terminal (Gyeongbu) 18:20 → Busan Central Bus Terminal (Nopo) 22:20, KRW 29100 (timetable fare). 4h00 from first departure to arrival, total about USD 21, same price. | R3 direct on 2026-10-17: Express Standard: Seoul Express Bus Terminal (Gyeongbu) 20:40 → Busan Central Bus Terminal (Nopo) 00:40 next day, KRW 29100 (timetable fare). 4h00 from first departure to arrival, total about USD 21, same price.
- unsourced money: none

> Seoul to Busan is on your globe now. Nothing beats the direct options on price: the Mugunghwa 1151 leaves Seoul at 06:37 and reaches Busan at 12:53 for KRW 28,600, about USD 21 — the cheapest thing going.
> The trade-off is the express bus: Seoul Express Bus Terminal at 17:20 (also 18:20 and 20:40) to Busan Central, KRW 29,100, only 500 won more but four hours flat instead of six and a bit. Want me to line up a return from Busan too?

### Singapore → Kuala Lumpur
- 7.8 s total, first words at 7.2 s, 2 model steps, reasoning tokens per step 189 / 167
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Singapore","Kuala Lumpur"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Singapore","to":"Kuala Lumpur","date":"2026-10-17","currency":"USD"}
  - optimizer said: R0 direct on 2026-10-17: AK AK720: Singapore Changi Airport 21:20 → Kuala Lumpur International Airport 22:25, USD 64 (cached fare). 1h05 from first departure to arrival, total USD 64, same price. | R1 direct on 2026-10-17: OD OD817: Singapore Changi Airport 19:55 → Sultan Abdul Aziz Shah International Airport 13:00, USD 85 (cached fare). 1h05 from first departure to arrival, total USD 85, costs USD 21 more. | R2 direct on 2026-10-17: FY FY3133: Seletar Airport 19:00 → Sultan Abdul Aziz Shah International Airport 12:20, USD 119 (cached fare). 1h20 from first departure to arrival, total USD 119, costs USD 55 more. | R3 via KEMPAS BARU on 2026-10-17: Ground transfer and border from Singapore: leave by 08:31, about 124 min to KEMPAS BARU, about USD 11 (estimated from distance, not a timetable or fare); then KTMB 9574: KEMPAS BARU 10:55 → BANGI 14:21, fare unknown (timetable fare). 5h50 from first departure to arrival, total total unknown (a fare is missing).
- unsourced money: none

> Good news — the optimizer didn't find anything cheaper than the direct flight. AirAsia AK720 leaves Changi at 21:20 and lands at KLIA 22:25 for USD 64 a person, and everything else it tried came out dearer or had an unknown fare (the Kempas Baru train route's fare isn't published, so it can't beat anything).
> So your best bet is just that evening flight. A classic Earth layover, except this one's only an hour and five minutes.

### Taipei → Kaohsiung
- 11.8 s total, first words at 11.2 s, 3 model steps, reasoning tokens per step 328 / 138 / 379
- tools: plan_trip → optimize_route → search_routes
  - plan_trip {"stops":["Taipei","Kaohsiung"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Taipei","to":"Kaohsiung","date":"2026-10-17","currency":"USD"}
  - search_routes {"from":"Taipei","to":"Kaohsiung","date":"2026-10-17"}
  - optimizer said: R1 direct on 2026-10-17: Taiwan High Speed Rail 295: Taoyuan 22:35 → Tainan 23:48, fare unknown (timetable fare). 1h13 from first departure to arrival, total total unknown (a fare is missing). | R2 direct on 2026-10-17: Taiwan High Speed Rail 205: Banqiao 07:59 → Tainan 09:18, fare unknown (timetable fare). 1h19 from first departure to arrival, total total unknown (a fare is missing). | R3 direct on 2026-10-17: Taiwan High Speed Rail 207: Banqiao 08:39 → Tainan 09:58, fare unknown (timetable fare). 1h19 from first departure to arrival, total total unknown (a fare is missing).
- unsourced money: none

> I put Taipei → Kaohsiung on your globe for the 17th, and checked leaving from nearby stations too — nothing came back cheaper than the direct options.
> The only price I can quote is a flight at USD 63 (that one's estimated, 1h03), and the high-speed rail times are running but showing no fares yet — a classic Earth puzzle, even by galactic standards. Want me to dig for rail fares specifically?

### Bangkok → Chiang Mai
- 12.2 s total, first words at 11.4 s, 3 model steps, reasoning tokens per step 324 / 407 / 251
- tools: plan_trip → optimize_route → search_routes
  - plan_trip {"stops":["Bangkok","Chiang Mai"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Bangkok","to":"Chiang Mai","date":"2026-10-17","currency":"USD"}
  - search_routes {"from":"Bangkok","to":"Chiang Mai","date":"2026-10-17"}
  - optimizer said: R0 direct on 2026-10-17: SL SL522: Don Mueang International Airport 20:15 → Chiang Mai International Airport 21:25, USD 37 (cached fare). 1h10 from first departure to arrival, total USD 37, same price. | R1 direct on 2026-10-17: The Transport Company Limited 18: Small Bus Terminal (Chatuchak) (Mo Chit 2) 20:20 → Chiang Mai Bus Terminal 2 (Arcade) 04:58 next day, fare unknown (timetable fare). 8h38 from first departure to arrival, total total unknown (a fare is missing). | R2 direct on 2026-10-17: Busarakam Tour 13: Small Bus Terminal (Chatuchak) (Mo Chit 2) 00:01 → Chiang Mai Bus Terminal 2 (Arcade) 08:43, fare unknown (timetable fare). 8h42 from first departure to arrival, total total unknown (a fare is missing). | R3 direct on 2026-10-17: The Transport Company Limited 13: Small Bus Terminal (Chatuchak) (Mo Chit 2) 18:10 → Chiang Mai Bus Terminal 2 (Arcade) 02:54 next day, fare unknown (timetable fare). 8h44 from first departure to arrival, total total unknown (a fare is missing).
- unsourced money: none

> I tried the cheaper angles and none beat the direct option — so yes, beating a Suvarnabhumi fare is easy: the cheapest I can see is USD 37 on SL522 out of Don Mueang, 20:15 to 21:25, a whisker over an hour gate to gate. The other flights sit at USD 77–85 (estimated), and the train runs 9.5 hours with no price listed.
> The overnight buses from Mo Chit are the real budget play, but the fares aren't published in what I can see, so I can't honestly call them cheaper yet. Want me to dig into those?

### Hong Kong → Tokyo
- 8.1 s total, first words at 7.3 s, 2 model steps, reasoning tokens per step 364 / 92
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Hong Kong","Tokyo"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Hong Kong","to":"Tokyo","date":"2026-10-17","currency":"USD"}
  - optimizer said: R0 direct on 2026-10-17: UO UO628: Hong Kong International Airport 20:00 → Tokyo Haneda International Airport 01:20 next day, USD 187 (cached fare). 4h20 from first departure to arrival, total USD 187, same price. | R1 via Guangzhou Baiyun International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 15:57, about 243 min to Guangzhou Baiyun International Airport, about USD 21 (estimated from distance, not a timetable or fare); then HO HO1852: Guangzhou Baiyun International Airport 21:30 → Tokyo Haneda International Airport 03:40 next day, USD 267 (cached fare). 10h43 from first departure to arrival, total USD 288, costs USD 101 more.
- unsourced money: none

> Short answer: no. The optimizer checked Shenzhen Bao'an, Shenzhen North and Macau, and the direct Hong Kong flight still wins — HK Express UO628 out of HKG at 20:00 on the 17th, landing Haneda 01:20, USD 187, versus USD 288 for the best detour it could chain (via Guangzhou, and that one also uses a distance-estimated ground transfer). The only thing that beats a direct hop is another direct hop, and a classic Earth layover in Guangzhou isn't it. Your leg's on the globe now, so have a look at the fares it's pulling.
