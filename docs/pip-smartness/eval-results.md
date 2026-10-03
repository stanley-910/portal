# Pip eval results

Run 2026-10-03T23:03:19.160Z, model deepseek-flash, trip date 2026-10-17. Regenerate with `pnpm eval:pip`.

### Hong Kong → Shanghai too expensive
- 8.9 s total, first words at 8.0 s, 2 model steps, reasoning tokens per step 518 / 165
- tools: optimize_route
  - optimize_route {"leg":1,"currency":"USD"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, USD 130 (cached fare). 3h10 from first departure to arrival, total USD 130, same price. | R1 via Macau International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 07:55, about 125 min to Macau International Airport, about USD 11 (estimated from distance, not a timetable or fare); then 9C 9C8876: Macau International Airport 11:30 → Shanghai Pudong International Airport 14:15, USD 79 (cached fare). 6h20 from first departure to arrival, total USD 90, saves USD 40. | R2 via Shenzhen Bao'an International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 17:14, about 126 min to Shenzhen Bao'an International Airport, about USD 11 (estimated from distance, not a timetable or fare); then 9C 9C8950: Shenzhen Bao'an International Airport 20:50 → Shanghai Hongqiao International Airport 23:20, USD 85 (cached fare). 6h06 from first departure to arrival, total USD 96, saves USD 34. | R3 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:49 (runs every few minutes) → Shenzhen North 11:34, HKD 58 (estimated); then G100: Shenzhen North 11:59 → Shanghai Hongqiao 19:25, CNY 878.5 (timetable fare). 9h36 from first departure to arrival, total about USD 129, saves USD 1.
- unsourced money: none

> Your best bet is flying out of Macau: a ground hop across the border (about 125 min, roughly USD 11, estimated since nobody publishes a timetable for that bit), then 9C8876 at 11:30 landing at Pudong 14:15 — about USD 90 all in, USD 40 under the direct USD 130. The runner-up leaves from Shenzhen Bao'an instead, USD 96 total but you don't land at Hongqiao until 23:20, so only worth it if a late arrival suits.
> Say the word and I'll slot Macau in as a stop on your globe. If your friend's Guangzhou flight lands at a set time, tell me and I'll line your arrival up with theirs — a classic Earth layover, solved.

### Budget in yuan
- 10.0 s total, first words at 9.2 s, 2 model steps, reasoning tokens per step 146 / 590
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Hong Kong","to":"Shanghai","date":"2026-10-17","max_fare":950,"currency":"CNY"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, CNY 870 (cached fare). 3h10 from first departure to arrival, total CNY 870, same price. | R1 via Macau International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 07:55, about 125 min to Macau International Airport, about CNY 80 (estimated from distance, not a timetable or fare); then 9C 9C8876: Macau International Airport 11:30 → Shanghai Pudong International Airport 14:15, CNY 530 (cached fare). 6h20 from first departure to arrival, total CNY 610, saves CNY 260. | R2 via Shenzhen Bao'an International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 17:14, about 126 min to Shenzhen Bao'an International Airport, about CNY 80 (estimated from distance, not a timetable or fare); then 9C 9C8950: Shenzhen Bao'an International Airport 20:50 → Shanghai Hongqiao International Airport 23:20, CNY 572 (cached fare). 6h06 from first departure to arrival, total CNY 652, saves CNY 218. | R3 via Shenzhen Bao'an International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 11:24, about 126 min to Shenzhen Bao'an International Airport, about CNY 80 (estimated from distance, not a timetable or fare); then ZH ZH9521: Shenzhen Bao'an International Airport 15:00 → Shanghai Pudong International Airport 17:20, CNY 806 (cached fare). 5h56 from first departure to arrival, total CNY 886, costs CNY 16 more.
- unsourced money: none

> Good news, Sam — the direct Shanghai Airlines FM812 already fits at ¥870 (HK 13:55 → Pudong 17:05), but the money-saver is to hop over to Macau first: leave Hong Kong by 07:55 for the roughly two-hour border run to Macau airport (about ¥80, an estimate, not a timetable), then 9C8876 at 11:30 lands Pudong at 14:15 — about ¥610 all in, a ¥260 saving and an earlier arrival.
> If that pre-dawn start offends you, the Shenzhen Bao'an version runs about ¥652 but lands at Hongqiao at 23:20. Both are on your globe if you want the via added as a stop.

### Arrive with a friend
- 10.8 s total, first words at 1.9 s, 2 model steps, reasoning tokens per step 239 / 176
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Hong Kong","to":"Shanghai","date":"2026-10-17","currency":"USD","arrive_near":"2026-10-17T22:40"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, USD 130 (cached fare). 3h10 from first departure to arrival, total USD 130, same price, arrives 335 min before the target. | R1 via Shenzhen Bao'an International Airport on 2026-10-17: Ground transfer and border from Hong Kong: leave by 17:14, about 126 min to Shenzhen Bao'an International Airport, about USD 11 (estimated from distance, not a timetable or fare); then 9C 9C8950: Shenzhen Bao'an International Airport 20:50 → Shanghai Hongqiao International Airport 23:20, USD 85 (cached fare). 6h06 from first departure to arrival, total USD 96, saves USD 34, arrives 40 min after the target. | R2 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 12:17 (runs every few minutes) → Shenzhen North 14:02, HKD 58 (estimated); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h25 from first departure to arrival, total about USD 129, saves USD 1, arrives 2 min after the target. | R3 via Shenzhen North on 2026-10-17: G5632: Hong Kong West Kowloon 12:13 → Shenzhen North 12:31, HKD 82 (timetable fare); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h29 from first departure to arrival, total about USD 132, costs USD 2 more, arrives 2 min after the target.
- unsourced money: none

> I'll plot the leg and hunt down the cheap ways in.
> Cheapest I can find: hop to Shenzhen Bao'an and fly out — leave Hong Kong by 17:14 (about 126 min of ground transfer and border, roughly USD 11, an estimate from distance), then 9C8950 at 20:50 lands Shanghai Hongqiao 23:20 for USD 85. That's USD 96 all in, USD 34 cheaper than the direct flight, though it gets you in 40 minutes after your friend.
> If hitting 22:42 exactly matters more than the money, the MTR to Shenzhen North plus the G386 train lands right on time at about USD 129 — barely cheaper than flying direct, which is USD 130 but drops you at Pudong at 17:05, hours early. Want me to put the Shenzhen stop on your globe so you can book that one?

### Simple date change
- 2.4 s total, first words at 2.1 s, 2 model steps, reasoning tokens per step 83 / 0
- tools: plan_trip
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-19"]}
- unsourced money: none

> Done, Sam — Hong Kong to Shanghai now leaves Mon 19 Oct, and the card's hunting fares for that day. Want me to see what's out there?

### Where to meet
- 5.5 s total, first words at 5.1 s, 2 model steps, reasoning tokens per step 33 / 60
- tools: find_meetup
  - find_meetup {"groups":[{"from":"Seoul","people":1},{"from":"Hong Kong","people":1}],"date":"2026-10-17","minimize":"price","fairest":false}
- unsourced money: none

> Shanghai's your spot — about USD 182 in all: your flight from Seoul is 1.8h (USD 103 each, estimated) and your friend's 9C flight from Hong Kong is 2.8h (USD 79 each). The runner-up is Muan at about USD 194, but that starts with a 3.3h bus, so Shanghai wins on both counts. Even by galactic standards, that's a tidy rendezvous.

### Out of scope
- 1.2 s total, first words at 0.8 s, 1 model steps, reasoning tokens per step 22
- tools: none
- unsourced money: none

> That's outside my lane, Sam — I plan how to get between places, not what to see once you're there. Tell me where you're starting from and when, and I'll get you to Shanghai.
