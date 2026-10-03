# Pip eval results

Run 2026-10-03T22:22:57.748Z, model deepseek-flash, trip date 2026-10-17. Regenerate with `pnpm eval:pip`.

### Hong Kong → Shanghai too expensive
- 11.1 s total, first words at 10.6 s, 2 model steps, reasoning tokens per step 101 / 204
- tools: optimize_route
  - optimize_route {"leg":1,"currency":"USD"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, USD 130 (cached fare). 3h10 from first departure to arrival, total USD 130, same price. | R1 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:49 (runs every few minutes) → Shenzhen North 11:34, HKD 58 (estimated); then G100: Shenzhen North 11:59 → Shanghai Hongqiao 19:25, CNY 878.5 (timetable fare). 9h36 from first departure to arrival, total about USD 129, saves 1. | R2 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:47 (runs every few minutes) → Shenzhen North 11:32, HKD 58 (estimated); then G902: Shenzhen North 11:57 → Shanghai Hongqiao 19:43, CNY 878.5 (timetable fare). 9h56 from first departure to arrival, total about USD 129, saves 1. | R3 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 12:17 (runs every few minutes) → Shenzhen North 14:02, HKD 58 (estimated); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h25 from first departure to arrival, total about USD 129, saves 1.
- unsourced money: none

> I checked nearby stations and chaining, Sam — nothing beats your direct flight. The Shenzhen North route comes to about USD 129, a dollar cheaper, but it's 9h36 door-to-door with an early MTR start.
> So the USD 130 flight on 17 Oct is your best price; if your friend's Guangzhou leg needs the same treatment, say the word.

### Budget in yuan
- 10.4 s total, first words at 10.0 s, 2 model steps, reasoning tokens per step 96 / 63
- tools: plan_trip → optimize_route
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-17"]}
  - optimize_route {"from":"Hong Kong","to":"Shanghai","date":"2026-10-17","max_fare":950,"currency":"CNY"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, CNY 870 (cached fare). 3h10 from first departure to arrival, total CNY 870, same price. | R1 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:49 (runs every few minutes) → Shenzhen North 11:34, HKD 58 (estimated); then G100: Shenzhen North 11:59 → Shanghai Hongqiao 19:25, CNY 878.5 (timetable fare). 9h36 from first departure to arrival, total about CNY 932, costs 62 more. | R2 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 09:47 (runs every few minutes) → Shenzhen North 11:32, HKD 58 (estimated); then G902: Shenzhen North 11:57 → Shanghai Hongqiao 19:43, CNY 878.5 (timetable fare). 9h56 from first departure to arrival, total about CNY 932, costs 62 more. | R3 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 12:17 (runs every few minutes) → Shenzhen North 14:02, HKD 58 (estimated); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h25 from first departure to arrival, total about CNY 932, costs 62 more.
- unsourced money: none

> Your leg's on the globe. Good news, Sam: the direct flight already comes in under budget — FM812, Hong Kong 13:55 to Shanghai Pudong 17:05, CNY 870. The Shenzhen North train trick via the MTR costs about CNY 932 and takes most of the day, so there's nothing to gain there.

### Arrive with a friend
- 8.9 s total, first words at 8.3 s, 2 model steps, reasoning tokens per step 105 / 151
- tools: optimize_route
  - optimize_route {"from":"Hong Kong","to":"Shanghai","date":"2026-10-17","currency":"USD","arrive_near":"2026-10-17T22:40"}
  - optimizer said: R0 direct on 2026-10-17: FM FM812: Hong Kong International Airport 13:55 → Shanghai Pudong International Airport 17:05, USD 130 (cached fare). 3h10 from first departure to arrival, total USD 130, same price, arrives 335 min before the target. | R1 via Shenzhen North on 2026-10-17: MTR East Rail: leave Admiralty (MTR) by 12:17 (runs every few minutes) → Shenzhen North 14:02, HKD 58 (estimated); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 10h25 from first departure to arrival, total about USD 129, saves 1, arrives 2 min after the target. | R2 via Futian on 2026-10-17: G5820: Hong Kong West Kowloon 07:07 → Futian 07:21, CNY 68 (timetable fare); then G386: Futian 14:14 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 15h35 from first departure to arrival, total about USD 131, costs 1 more, arrives 2 min after the target. | R3 via Shenzhen North on 2026-10-17: G5624: Hong Kong West Kowloon 07:01 → Shenzhen North 07:19, HKD 82 (timetable fare); then G386: Shenzhen North 14:27 → Shanghai Hongqiao 22:42, CNY 878.5 (timetable fare). 15h41 from first departure to arrival, total about USD 132, costs 2 more, arrives 2 min after the target.
- unsourced money: none

> Best bet is to cross the border first: MTR East Rail from Admiralty by 12:17 to Shenzhen North, then G386 at 14:27 arriving Shanghai Hongqiao 22:42 — two minutes after your friend, for about USD 129 all in. That's right on the money versus the direct flight at USD 130, which lands at Pudong at 17:05, hours early and the wrong airport for Hongqiao arrivals.
> Want me to put the Shenzhen North version on your globe?

### Simple date change
- 1.6 s total, first words at 1.3 s, 2 model steps, reasoning tokens per step 62 / 0
- tools: plan_trip
  - plan_trip {"stops":["Hong Kong","Shanghai"],"dates":["2026-10-19"]}
- unsourced money: none

> Done, Sam — Hong Kong to Shanghai now leaves Monday 19 Oct, and the card's hunting fares for that date.

### Where to meet
- 8.2 s total, first words at 0.5 s, 2 model steps, reasoning tokens per step 0 / 22
- tools: find_meetup
  - find_meetup {"groups":[{"from":"Seoul","people":1},{"from":"Hong Kong","people":1}],"date":"2026-10-17","minimize":"price","fairest":false}
- unsourced money: none

> I'll find a good middle ground for you both.
> Shanghai's your spot: a 1.8h flight from Seoul at about USD 103 each, and 2.8h from Hong Kong at USD 79 each — roughly USD 182 total, the cheapest of the ten cities I scored.
> Both figures are estimates, but they're the pick of the bunch. The card has a button that drops your Seoul leg onto your globe.

### Out of scope
- 1.0 s total, first words at 0.7 s, 1 model steps, reasoning tokens per step 28
- tools: none
- unsourced money: none

> That's outside my galaxy, Sam, sights and itineraries aren't my department. Point me at where you're starting from and what date, though, and I'll get you to Shanghai and find the fares.
