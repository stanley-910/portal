# UI waiting to be wired

UI built ahead of its data or flow, mostly while polishing in the playground (`/playground`, dev only). Each entry says
what exists, what it does today, and what wiring it needs. Remove an entry once it's wired.

## Built, partly wired

- **My Trips library.** Built and wired on `/` for accounts: the Trips button in the nav opens `<TripLibrary>`
  (`src/components/library`), fed by `loadLibrary` (`listMyLibrary` reads each trip's plan and who's in its room), with
  renames through `renameTrip` and Leave and Delete through the trip dialogs. It has replaced the `/trips` page, which
  now redirects to `/?trips`. Not yet seen end to end with a real account, as the dev worktree has no Supabase; check
  it signed in, including leaving and deleting a trip from it.

- **Hotel photos without a key.** With `LITEAPI_API_KEY` set (a sandbox key is enough), stays show LiteAPI's real
  hotels with photos. Without it, the bundled typical stays have none, as there are no licensed images to ship, so
  the playground never shows a stay row with a photo. Needs: images we're allowed to ship, if that row should be
  visible without a key.
- **Fading past trips on the real globe.** The Library prototype fades a past trip's routes and pins by styling the
  playground's flat globe. The WebGL globe has no "archived" look for a route or pin yet. Needs: a flag on
  `RemoteFlight` and `GlobePin` that the engine draws faded.

## Playground stand-ins

These are the playground's, not the app's, and need nothing unless the playground should show the real thing.

- Book on the Home scene runs checkout against stand-ins (`checkout-stand-in.ts`): the fare moves once, the details
  want a passport, and paying lands on done. Nothing is settled, held or charged.
- Pip on the Home scene answers with a canned reply (`/api/pip` is stubbed in the page).
- The Pip lab (`/playground/pip`) plays Pip's tool calls from scripts (`scenarios.ts`) on the real globe: `/api/pip`
  is answered from the script, so no model is called. Each script mirrors the events `runSolo` streams for that tool.
- Pip's checkout card on the Panels page runs against stand-ins (`checkout-card-stand-in.tsx`): each state starts a
  made-up group booking at that point, and its buttons move it on. Nothing is held or charged; adding a new card needs
  Stripe, so that form only fails.
- Leave and Delete on the Library scene take the trip off the list with no confirm; nothing is left or deleted.
- Save on the Home scene waits and shows Saved; nothing is saved. Plan with friends does nothing.
- The Trip scene and the Panels page's plan card run in the local `pnpm dev:party` room.
