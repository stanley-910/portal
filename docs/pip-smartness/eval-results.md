# Pip eval results

Run 2026-10-03T22:32:25.043Z, model deepseek-flash, trip date 2026-10-17. Regenerate with `pnpm eval:pip`.

### Hong Kong → Shanghai too expensive
- 10.8 s total, first words at 10.0 s, 2 model steps, reasoning tokens per step 168 / 194
- tools: optimize_route
  - optimize_route {"leg":1,"currency":"USD"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, USD 130 (cached fare). 3h10 from first departure to arrival, total USD 130, same price. | R1 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:49 (runs every few minutes) → Shenzhen North 11:34, HKD 58 (estimated); then G100: Shenzhen North 11:59 → Shanghai Hongqiao 19:25, CNY 878.5 (timetable fare). 9h36 from first departure to arrival, total about USD 129, saves 1. | R2 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:47 (runs every few minutes) → Shenzhen North 11:32, HKD 58 (estimated); then G902: Shenzhen North 11:57 → Shanghai Hongqiao 19:43, CNY 878.5 (timetable fare). 9h56 from first departure to arrival, total about USD 129, saves 1. | R3 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 12:17 (runs every few minutes) → Shenzhen North 14:02, HKD 58 (estimated); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h25 from first departure to arrival, total about USD 129, saves 1.
- unsourced money: none

> Good news, sort of: that direct flight is already about as cheap as it gets. The optimizer's best alternative is the MTR to Shenzhen North then the G100 train to Shanghai Hongqiao, leaving Admiralty by 09:49 and arriving 19:25 — about USD 129 all in, which saves roughly a dollar for nine and a half hours instead of three.
> So I'd say keep the flight on the 17th and spend the saving elsewhere. Want me to look at your friend's Guangzhou to Shanghai leg too, so you both land in the same city around the same time?

### Budget in yuan
- 8.8 s total, first words at 8.4 s, 2 model steps, reasoning tokens per step 208 / 85
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Hong Kong","to":"Shanghai","date":"2026-10-17","max_fare":950,"currency":"CNY"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, CNY 870 (cached fare). 3h10 from first departure to arrival, total CNY 870, same price. | R1 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:49 (runs every few minutes) → Shenzhen North 11:34, HKD 58 (estimated); then G100: Shenzhen North 11:59 → Shanghai Hongqiao 19:25, CNY 878.5 (timetable fare). 9h36 from first departure to arrival, total about CNY 932, costs 62 more. | R2 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:47 (runs every few minutes) → Shenzhen North 11:32, HKD 58 (estimated); then G902: Shenzhen North 11:57 → Shanghai Hongqiao 19:43, CNY 878.5 (timetable fare). 9h56 from first departure to arrival, total about CNY 932, costs 62 more. | R3 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 12:17 (runs every few minutes) → Shenzhen North 14:02, HKD 58 (estimated); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h25 from first departure to arrival, total about CNY 932, costs 62 more.
- unsourced money: none

> Good news, Sam: the direct flight already fits your budget — FM812 out of Hong Kong International at 13:55, into Pudong 17:05, ¥870. The Shenzhen North rail routes come to about ¥932 and take most of the day, so nothing beats going direct for under ¥950. Do you want the return leg home on the globe too?

### Arrive with a friend
- 11.2 s total, first words at 10.5 s, 2 model steps, reasoning tokens per step 404 / 96
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Hong Kong","Shanghai Hongqiao"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Hong Kong","to":"Shanghai Hongqiao","date":"2026-10-17","currency":"USD","arrive_near":"2026-10-17T22:40"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, USD 130 (cached fare). 3h10 from first departure to arrival, total USD 130, same price, arrives 335 min before the target. | R1 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 12:17 (runs every few minutes) → Shenzhen North 14:02, HKD 58 (estimated); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h25 from first departure to arrival, total about USD 129, saves 1, arrives 2 min after the target. | R2 via Shenzhen North on 2026-10-17: G5632: Hong Kong West Kowloon 12:13 → Shenzhen North 12:31, HKD 82 (timetable fare); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h29 from first departure to arrival, total about USD 132, costs 2 more, arrives 2 min after the target. | R3 direct on 2026-10-17: G386: Hong Kong West Kowloon 13:58 → Shanghai Hongqiao 22:42, CNY 973 (timetable fare). 8h44 from first departure to arrival, total about USD 134, costs 4 more, arrives 2 min after the target.
- unsourced money: none

> Best bet is R1: MTR East Rail out of Admiralty by 12:17, reaching Shenzhen North at 14:02, then G386 on to Shanghai Hongqiao at 22:42 — that's your friend's platform, 2 minutes after they pull in. Total's about USD 129, a dollar under the direct flight.
> Worth knowing: the direct train G386 leaves Hong Kong West Kowloon at 13:58 and lands at the same 22:42, about USD 134 — five dollars more and four hours less of your day gone, if you'd rather not hop the border. Want me to put the Shenzhen version on your globe?

### Simple date change
- 1.9 s total, first words at 1.7 s, 2 model steps, reasoning tokens per step 43 / 0
- tools: plan_trip
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-19"]}
- unsourced money: none

> Done, Sam: Hong Kong → Shanghai now sits on Mon 19 Oct, and the card is hunting fares for that day. Want me to compare times or prices for it?

### Where to meet
- 8.9 s total, first words at 8.5 s, 2 model steps, reasoning tokens per step 34 / 97
- tools: find_meetup
  - find_meetup {"groups":[{"from":"Seoul","people":1},{"from":"Hong Kong","people":1}],"date":"2026-10-17","minimize":"price","fairest":false}
- unsourced money: none

> Muan (MWX) comes out cheapest: a 3.3-hour bus from Seoul at KRW 22,700 each, and a 3-hour flight from Hong Kong at USD 96 each — about USD 112 in all.
> If you'd rather both of you fly, Shanghai is the runner-up: USD 59 from Seoul and USD 74 from Hong Kong, about USD 133 total.

### Out of scope
- 0.9 s total, first words at 0.5 s, 1 model steps, reasoning tokens per step 10
- tools: none
- unsourced money: none

> That's not my department, Sam. I plan how you get between places, not what you see when you arrive. Say the word if you want legs on your globe and I'll get to work.
