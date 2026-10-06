# The trip

A trip is one Liveblocks room (`trip:<id>`). Its Storage is the plan, shared by everyone in it and by Pip. Types are in `src/lib/liveblocks/types.ts`.

## Shape

The plan is flat maps keyed by id. Nothing is nested per member, so a leg several people ride is one leg with one set of options and votes.

- **members**: everyone who has joined, by account or guest id. Each has a name, a colour, and optionally `leaves`, the date they leave the trip. The colour is the one they picked in the profile menu (saved on their account or guest cookie), else one handed out in join order. Picking one inside a trip writes it here, so everyone's cursors, planes, pins, routes and avatars show it at once; two people may share a colour, and their names tell them apart.
- **stops**: the points legs start and end at. A leg landing at a hub the trip already has, or within 25 km of an existing stop, reuses that stop (`sharesStop`), so friends arriving in the same city share one place, one stay and its nights; the first click's exact point stands. Dragging a stop's pins on the globe moves the stop for everyone: it takes the hub nearest where it's dropped, every leg into or out of it searches again, and its stays stay with it. A stop with a leg being booked doesn't move.
- **legs**: a trip between two stops on a date. A leg has riders, the search's options, votes, and the chosen option. Each end can be snapped to a hub (`snap`, hub ids): opened in the plan, the airport code under each city picks the airport, station or ferry terminal that end uses, and the leg then searches exactly that hub. The snap is the leg's, not the stop's, so a group can fly into Haneda and take the Shinkansen on from Tokyo Station at one stop. Snapping doesn't move the stop, so other legs there keep their options and votes; a hub picked beyond the stop's reach (an airport 200 km off, a station 100 km) is somewhere else, so the stop moves onto it first. Moving a stop, by its pins or that way, lets go of its legs' hubs there.
  It keeps up to 20 options in the search's order: the pick, each provider's best three, then the rest by rank, so
  one provider's dozens of fares can't push out the trains or the bookable flights.
- **stays**: where some of the group sleep, apart from the legs. Each has a stop, a check-in and check-out date, its guests, and what it costs a night for all of them. Any member adds one from a leg's hotel search in the plan (for that leg's riders, from their arrival to their next leg out, else one night), and anyone can change its dates and guests or remove it; Pip adds and changes them too. Saving a trip from the globe carries the hotel picked in its Hotels tab as a stay for the saver. A hotel search's price is an estimate unless the rate is live, and is marked so until someone gives a real one. Stays are booked on their own, apart from the legs: a stay picked from an estimate or a LiteAPI listing keeps what to search for (`listing`: the property, or the city for a typical stay), and its card links to a Booking.com search for its current nights and guests, so changing them carries over. A live quote has no link, since another seller wouldn't honour its price.
- **ends**: only older rooms read it (below). Nothing sets it any more.

## Who sleeps where

Stays say it, not legs. Riding a leg never puts anyone in a stay, so someone can fly in and stay with family, join the hotel without the group's train, or drop off a flight and keep their room, and the other way round.

- A stay's guests sleep there each night from check-in to the night before check-out.
- Nobody has a night anywhere until there's a stay for it, so a trip that's only the flights in costs only the flights.
- `leaves`, someone's leave date, ends their nights in every stay from that night on. Leaving early is that, or a leg home and being taken out of the stays after it. Only Pip sets it now.

Rooms made before stays had their own guests and dates stored a price per stop and worked nights out from legs: riders slept at a leg's destination until their next leg, their leave date or the trip's end (`ends`, else the morning after the last leg), never at home. `staysOf` reads those as whole stays, one per run of nights with the same people, so their numbers don't change, and the first edit to a stay writes them out whole.

## Dates stay in order

`src/lib/trip/dates.ts` keeps the dates consistent, for the plan panel and Pip alike, by moving whatever is out of step to the nearest day that fits.

- A rider's legs go in date order. A leg can't leave before the leg that gets its riders there, and moving it later pushes the legs they take after it along to the same day, each searched again. A move that would push a leg being booked doesn't happen.
- The trip ends no earlier than its latest leg.
- A leave date sits between the member's first leg and the trip's end, when one is set.

A round trip is no special case. A return date on the globe's last leg saves as one more leg, from the last stop back to where the first leg left, with the picked return option chosen, so nights at the last stop end on the return date.

## The split

`computeSplit` in `src/lib/trip/split.ts` takes the Storage as JSON and returns every night with who was there, and for each member their fares by leg, their night shares and their totals. The UI and Pip both read it, and Pip never adds money up itself.

- A leg's chosen option is priced per person, so each rider pays its fare.
- Totals are kept per currency. The split never converts, since one trip mixes yuan, won and dollars. The currency setting converts for display only.
- A night's cost is a stay's, split evenly among its guests there that night.
- `missing` flags a leg with no chosen option or a stay nobody has priced. Those are left out of the totals, and the split should say so.
- My trips, the library on the home globe (`/?trips`, which old `/trips` links redirect to), reads every trip's plan side by side for its legs and your share. A plan that isn't read within 2.5 seconds lists its trip without them rather than holding up the list.

The bill on the plan card shows the split for the whole group (`TripSplit`): each member's total, opening to their fares by leg, with any leg that has no option chosen, and their nights by stop, with any that have no price.

Not covered yet: who paid what and settling up, shared extras, and overnight legs that replace a night.

## Leaving

Anyone can leave a trip from the profile menu in the room, or from the trip picked in My trips, after confirming. Leaving takes them off every leg and out of every stay, with their votes and messages. Legs and stays others are still on go on without them, whoever drew them; one left with nobody on it goes, and so does any stop no remaining leg or stay uses.

The owner is whoever made the trip, until it passes on (`owner` in the room's metadata, which the server trusts, and in Storage, so the room sees it change). When the owner leaves, the trip passes to whoever joined next; when the last person leaves, the trip is deleted. The link is still the invite, so opening it again joins afresh. You join when the room connects, never when the page renders, so nothing that re-renders the page puts someone who left back in.

Only the owner can delete a trip: with Delete on the trip picked in My trips, or with End trip in the room's profile menu. Everyone still in the room is told it ended and sees "This trip has ended" instead of the plan. If a leave or end fails, the server log says why (`[trip] leaving …`, `[trip] ending …`).

## A test party locally

`pnpm dev:party` runs the app against the local Liveblocks dev server (needs Bun) instead of a real project, and seeds a trip at `/t/partyTestRoom001`: Mei, Ada, Joon and Sam meeting in Shanghai and Tokyo, then on to Osaka, with picks, votes and stays already made (`scripts/seed-party.mts`). Join it as a guest. Each start reseeds it fresh, and the seed refuses to write anywhere but localhost.
