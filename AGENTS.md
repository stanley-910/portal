# Trip Globe

A multiplayer globe for getting between places in Asia, built for the HKU Hackathon (Fall 2026).

## What it does

You click a point to take off. A paper plane follows your cursor with a dashed great-circle route. Each click on the way drops a stop and starts the next leg; clicking the last stop again (a double click) lands the trip, and the app finds the best flights, trains and buses for each leg between the nearest relevant hubs. Friends join the same trip from different origins. The app suggests where and when to meet, and splits costs by who is present for each leg and each night.

We solve how to get between places. We are not a trip guide or an event planner, so don't add itineraries, sights or reviews.

**Demo route:**
1. Two friends take the high-speed rail from HK West Kowloon to Shanghai.
2. A third friend flies from Seoul to Shanghai.
3. The party meets in Shanghai and flies to Tokyo.
4. One member leaves early, and the stay split updates live.

## How it fits together

- `/` is the globe screen: a custom WebGL2 globe (`<TripGlobe>`, `src/components/trip-globe`). Landing resolves the exact clicked points to transport hubs and searches providers through `/api/transport/search`. `docs/transport/README.md` covers how search works, coverage, credentials and estimated data.
- `/t/<id>` is a shared trip. Its URL is the invite. The plan, presence and thread live in a Liveblocks room (`src/lib/liveblocks`, `src/lib/trip`). `docs/trip/README.md` covers the plan's shape, who sleeps where and the cost split. `docs/booking/README.md` covers how riders buy their own seats on a leg through Duffel and Stripe (`src/lib/booking`).
- Pip is the shared agent in a trip's thread (`src/lib/agent`, `src/components/agent`). It edits the plan with Undo and finds meet-up cities. It runs on DeepSeek V4.1 Flash and needs `DEEPSEEK_API_KEY` in `.env.local`; without it, Pip only answers meet-up questions from its own tools.
- Identity (`src/lib/identity.ts`) is a Supabase account (`src/lib/supabase`, `/login`, `/signup`) or else a guest cookie with a display name (`src/lib/guest.ts`). Guests can use the globe and join a trip from its link; saving a trip, "Plan with friends" and asking Pip need an account. Supabase off or down leaves everyone a guest. The profile menu at the end of the nav bar holds who you are and the app's settings.
- `/design` is the Paper Atlas gallery. The rules are in `DESIGN.md` and the tokens in `src/design/tokens.json`.
- Work is tracked in Linear: project "Hackathon MVP", team POR. The code is the source of truth; where a ticket disagrees with it, ask.

## Rules

- For UI work, follow `DESIGN.md` and use the tokens. Never hard-code colours, fonts, radii or shadows.
- Every leg shows where its data came from. Anything that isn't live shows an "estimated" badge.
- The demo must never depend on a flaky API, so every provider needs a mock fallback.
- Provider calls happen only on the server, so keys never reach the browser.
- Don't use Amadeus Self-Service. It shut down on 2026-07-17.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
