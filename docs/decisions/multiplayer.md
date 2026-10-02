# Multiplayer decisions

These were agreed in a grilling session on 2026-10-02. **None of them are built yet**, and the Linear tickets haven't been updated: several tickets (POR-12, 21, 29, 30, 31, 34, 38, 39) still describe the old Supabase-centred plan. Where they disagree, this file wins.

Liveblocks facts behind these decisions were checked against the docs on 2026-10-02 (`@liveblocks/*` 3.24.3, which supports React 19). Free-tier limits are in `docs/research/free-tiers.md`.

## Scope

### M1. Multiplayer is the core loop

**Status:** decided

**Decision:** we're building all three layers:
1. **The core loop.** Each friend joins the trip and lands their own plane on their origin. The meet-up solver (POR-26) uses everyone's origins.
2. **Watching together.** Others' cursors, planes and routes are live, and you can follow someone.
3. **Presence.** An avatar stack.

**Why:** the pitch is group trips. The demo script (POR-33) is three friends from two cities meeting in Shanghai.

### M2. Team and deadline

**Status:** decided

**Decision:**
- Three people.
- The deadline is Sunday 4 October, morning (Hong Kong time).
- Nobody is sectioned off: anyone takes any ticket.

## State and identity

### M3. The shared trip plan lives in Liveblocks Storage

**Status:** decided. This supersedes the "Postgres is the source of truth" line in POR-21 and POR-30.

**Decision:** the trip being edited lives in the room's Storage (`LiveObject`, `LiveList`, `LiveMap`). That covers:
- members, stops, legs and riders;
- search results;
- votes and chosen options;
- the chat thread;
- the paid status shown in the UI.

The server reads and writes it with `@liveblocks/node` (`mutateStorage`, `getStorageDocument`) or the REST JSON-patch endpoint.

**Why:**
- Sync is instant and conflict-free.
- Optimistic updates and undo/redo come free.
- It removes RLS for anonymous users, hand-written optimistic UI, and `trip-changed` refetch races.

**Costs:**
- Vendor lock-in.
- Storage is capped at 10 MB per room and 3M updates per month on Free.

### M4. Who you are: a guest cookie and a Liveblocks ID token

**Status:** decided. This replaces Supabase auth (POR-12).

**Decision:**
- On first visit, set a random guest id in a cookie.
- A route handler turns it into a Liveblocks ID token (`identifyUser`), with `userInfo` carrying the name and colour.
- You pick a name when you first join a trip, and you're given a colour.

**Why:**
- It takes about 30 minutes, versus half a day for Supabase anonymous auth with captcha.
- Guest ids count as monthly active users, which are unlimited on Free. They don't count as anonymous connections, which are capped at 3,000 a month.

**Accepted:** if someone clears their cookies, they come back as a new person.

### M5. No Supabase

**Status:** decided

**Decision:** we don't use Supabase at all, so there's no database. What it would have held moves elsewhere:
- **Provider cache:** JSON fixtures committed to the repo. They also serve as the required mock fallback.
- **Payment truth:** Stripe (see M17).
- **Public share page (POR-31):** reads Storage on the server through the REST API.

**Why:** one less service to set up, to wake up before the demo, and to watch for free-tier limits.

**Tickets affected:**
- POR-12, POR-21 and POR-29: close or rewrite.
- POR-30 and POR-31: rewrite around Storage.

### M6. Saved trips

**Status:** decided

**Decision:** "My trips" works per device, with no database:
- When you join, the auth route grants your user id access to the room (`updateRoom` with `usersAccesses`).
- `getRooms({ userId })` lists your trips.
- Room metadata holds the title for the list.

**Stretch:** an optional Google sign-in so trips follow you across devices. On sign-in, the server grants your account id access to every room your guest id has. We'd use an auth-only provider, still with no database.

### M7. Getting into a trip

**Status:** decided. This simplifies POR-29.

**Decision:**
- `/` stays a solo globe. "Plan with friends" creates a trip and gives you an unguessable URL.
- That URL is the invite, so there's no invite token table.
- Everyone is an editor; there are no roles and no revocation.

**Why:** roles and revocation aren't worth the build time this weekend.

**Rooms:** room id `trip:<id>`, with up to 10 connections per room on Free.

## Trip model and editing

### M8. A trip is a graph of shared stops

**Status:** decided

**Decision:**
- **Stops** are points: lat/lng, hub and name.
- **Legs** connect two stops and carry riders, search results, votes and a chosen option.
- Landing near an existing stop snaps onto it. For example, HK → Shanghai, Seoul → Shanghai and Shanghai → Tokyo all share one Shanghai stop.
- Moving a stop moves every leg attached to it.

**Why:** a meet-up is literally where people's legs join. Separate endpoints would drift apart when edited.

### M9. Anyone can draw or edit any leg

**Status:** decided

**Decision:**
- Any member can draw new legs and edit existing ones, including other members' legs.
- Legs can be edited after landing; you never have to delete a trip to redo one leg.

### M10. Riders per leg

**Status:** decided

**Decision:** each leg has a list of riders, defaulting to whoever drew it. You toggle riders by clicking avatars on the leg's ticket.

**Why:** it feeds the cost split (POR-37) and the timeline (POR-36).

### M11. Conflicts are prevented with soft locks

**Status:** decided

**Decision:**
- When you grab a stop or leg, your presence says `editing: <id>`. Everyone sees it outlined in your colour with your avatar, and nobody else can grab it.
- The lock clears when you let go or disconnect, because presence disappears with you.
- Storage's per-field last-write-wins is the backstop for the rare race.
- The agent follows the same rule: it skips anything someone has locked and says so in the chat.

**Why:** like Figma, it prevents conflicts visibly instead of resolving them afterwards, and it comes almost free from presence.

### M12. Editing a leg resets its search

**Status:** decided

**Decision:**
- Moving a stop re-runs the search for each affected leg.
- It also clears that leg's votes and chosen option.
- Legs that someone has paid for are locked and can't be moved.

**Why:** old prices for a different route mean nothing, and locking paid legs means we never need refunds.

### M13. Planner results are shared

**Status:** decided

**Decision:** route options are written into Storage, so everyone sees the same option cards, votes on them, and sees which one is chosen.

## Live layer

### M14. Presence features, in build order

**Status:** decided

**Decision:** build these in order:
1. Avatar stack and lat/lng cursors.
2. Other members' planes and their dashed routes, live. The globe engine has to learn to draw several planes; today it draws one.
3. Follow mode (POR-35).

Emoji reactions are cut. Chat between people happens in the shared thread (M15).

**Implementation notes:**
- Remote state reaches the engine through `room.subscribe("others", …)` or `useOthersListener`, so it doesn't trigger a React re-render.
- Cursors are sent as lat/lng, never screen pixels.
- A route that's still being drawn lives in presence. Once it lands, it's written to Storage.

## AI agent

### M15. One shared thread per trip, with the agent in it

**Status:** decided (POR-39 is in scope)

**Decision:**
- Humans chat in the thread, and the agent answers when you @mention it.
- Messages are stored in Storage, so everyone sees them.
- The agent shows in the avatar stack through server-set presence (`setPresence`).
- It edits the trip through `mutateStorage`, so its changes appear live on everyone's globe.

**Why:**
- Liveblocks AI Copilots are private per user, and enabling them may need a sales call.
- A shared thread covers human chat for free.

### M16. What the agent can do

**Status:** decided

**Decision:**
- **Can:** add and edit stops and legs, set riders, and run searches.
- **Can't vote:** that's for humans only.
- **Can't pay:** it only posts "Pay your share" cards, and each member confirms their own payment.

## Payments

### M17. Payments in two layers

**Status:** decided (POR-38 is in scope)

**Decision:**
- **Layer 1:** each member pays their share through their own Stripe test checkout. When everyone has paid, the trip is "funded".
- **Layer 2:** the server then places a Duffel test order for the flight legs. We build this only if POR-8 confirms that real carriers return offers on our routes in test mode. Otherwise we stop at "funded" and show booking links.
- Rail and bus legs get prefilled affiliate links (POR-40).
- Stripe is the record of who has paid, not Storage:
  - Checkout sessions are tagged with the trip id.
  - The webhook copies paid status into Storage for display.
  - The server checks Stripe directly before placing the order.

**Why Duffel:** Stripe only collects money. Duffel actually books the flight and returns a booking reference. In test mode it's paid from a fake balance.

**Why Stripe is the record:** any member can write to Storage, so a "paid" flag there could be faked.

## Operational rules from the free tier

- **Ghost tabs:** set `backgroundKeepAliveTimeout`. Background tabs otherwise burn collaboration minutes (3,000 a month, hard cap; a minute is one connected person in a room with someone else).
- **Full rooms:** handle error 4005 with `useErrorListener` and show "This trip is full".
- **Watermark:** the Free plan can't remove the Liveblocks badge, but `badgeLocation` can move it to a corner.
- **Before the demo:** check collaboration minutes on the dashboard the day before.

## Open questions

- What happens when two people @mention the agent at the same time: queue the requests, or have the agent reply to each in turn?
- Follow mode details beyond POR-35, for example whether you can follow the agent.
- Exact Storage schema and the `RouteOption` shape (POR-15), to agree with whoever builds the planner.
- Updating the Linear tickets to match this file.
