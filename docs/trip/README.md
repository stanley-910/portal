# The trip

A trip is one Liveblocks room (`trip:<id>`). Its Storage is the plan, shared by everyone in it and by Pip. Types are in `src/lib/liveblocks/types.ts`.

## Shape

The plan is flat maps keyed by id. Nothing is nested per member, so a leg several people ride is one leg with one set of options and votes.

- **members**: everyone who has joined, by account or guest id. Each has a name, a colour, and optionally `leaves`, the date they leave the trip.
- **stops**: the exact points legs start and end at.
- **legs**: a trip between two stops on a date. A leg has riders, the search's options, votes, and the chosen option.
- **stays**: stop id → what lodging there costs the group per night, typed in by a member or Pip. Saving a trip from the globe can also carry the hotel picked in its Hotels tab; that price is an estimate and is marked so until someone gives a real one.
- **ends**: the date the trip ends, the morning after its last night. Optional.

## Who sleeps where

Presence is worked out from legs, never stored, so moving a leg moves its nights with it.

- After a leg, its riders sleep at its destination from that night until their next leg, the day they leave, or the trip's end, whichever is first.
- Nobody pays for nights at home, which is where their first leg left from. A leg back home ends their nights.
- Without an end date, the trip ends on its latest leg or leave date.

Leaving early is setting `leaves`, or adding a leg home.

A round trip is no special case. A return date on the globe's last leg saves as one more leg, from the last stop back to where the first leg left, with the picked return option chosen, so nights at the last stop end on the return date.

## The split

`computeSplit` in `src/lib/trip/split.ts` takes the Storage as JSON and returns every night with who was there, and for each member their fares by leg, their night shares and their totals. The UI and Pip both read it, and Pip never adds money up itself.

- A leg's chosen option is priced per person, so each rider pays its fare.
- A night's cost is split evenly among whoever is there that night.
- Totals are kept per currency. The split never converts, since one trip mixes yuan, won and dollars. The currency setting converts for display only.
- `missing` flags a leg with no chosen option or a night at a stop nobody has priced. Those are left out of the totals, and the split should say so.

Not covered yet: who paid what and settling up, shared extras, and overnight legs that replace a night.

## Leaving

Anyone can leave a trip from the profile menu in the room, or from My trips, after confirming. Leaving takes what they added with them: the legs they drew, their seats on others' legs (a leg left with no riders goes too), their votes, their messages, and any stop no remaining leg uses, with its stay. Pip's legs stay.

The owner is whoever made the trip, until it passes on (`owner` in the room's metadata). When the owner leaves, the trip passes to whoever joined next; when the last person leaves, the trip is deleted. Only the owner can delete a trip. The link is still the invite, so opening it again joins afresh.

## A test party locally

`pnpm dev:party` runs the app against the local Liveblocks dev server (needs Bun) instead of a real project, and seeds a trip at `/t/partyTestRoom001`: Mei, Ada, Joon and Sam meeting in Shanghai and Tokyo, then on to Osaka, with picks, votes and stays already made (`scripts/seed-party.mts`). Join it as a guest. Each start reseeds it fresh, and the seed refuses to write anywhere but localhost.
