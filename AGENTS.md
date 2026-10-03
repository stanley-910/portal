# Trip Globe

A multiplayer globe for getting between places in Asia, built for the HKU Hackathon (Fall 2026).

## What it does

You click a point to take off. A paper plane follows your cursor with a dashed great-circle route. You land it somewhere, and the app finds the best flights, trains and buses between the nearest relevant hubs. Friends join the same trip from different origins. The app suggests where and when to meet, and splits costs by who is present for each leg and each night.

We solve how to get between places. We are not a trip guide or an event planner, so don't add itineraries, sights or reviews.

**Demo route:**
1. Two friends take the high-speed rail from HK West Kowloon to Shanghai.
2. A third friend flies from Seoul to Shanghai.
3. The party meets in Shanghai and flies to Tokyo.
4. One member leaves early, and the stay split updates live.

## What exists in the repo today

- `/` is the globe screen: a custom WebGL2 globe (`src/components/trip-globe`). Idle/in-flight hover previews use local bundled transport hubs; landing resolves exact clicked coordinates to hub pairs and searches provider offers through `/api/transport/search`. See `docs/transport/README.md` for coverage, credentials, and estimated-data limits. Taking off, flying, landing, pan, zoom and the landing ticket work.
- `/t/<id>` trips have Pip, a shared agent in the trip thread (`src/lib/agent`, `src/components/agent`). It edits the plan with Undo and finds meet-up cities. Design and status: `docs/multiplayer/agent-harness.md`. **Setup needed:** Pip runs on DeepSeek V4.1 Flash (`deepseek-flash`) and needs `DEEPSEEK_API_KEY` in `.env.local` (see `.env.example`). Nobody has created one yet. Without it, Pip only answers "where should we meet" questions from its own tools, and the model path has never been run.
- Accounts: Supabase Auth with email and password (`src/lib/supabase`, `/login`, `/signup`). The solo globe at `/` is open to everyone; creating or joining a trip (`/t/<id>`) needs sign-in, and the Liveblocks user id is the Supabase user id.
- `/design` is the Paper Atlas design system gallery. The rules are in `DESIGN.md` and the tokens are in `src/design/tokens.json`.
- `docs/<area>/` holds each area's decisions and research, for example `docs/multiplayer/decisions.md`. See `docs/README.md`.

## Planned

All work is tracked in Linear: project "Hackathon MVP", team POR. Decisions made so far, and why, are in `docs/<area>/decisions.md`. Where a ticket disagrees with them, the decisions win.

| Area | Plan | Tickets |
|---|---|---|
| Planner | Multimodal route search | POR-24 |
| Planner | Meet-up solver | POR-26 |
| Planner | Pareto ranking | POR-25 |
| Planner | Shared Zod `Leg` schema with `freshness: live \| cached \| estimated`, and a mock fallback for every provider | POR-5 |
| Live layer | Liveblocks: the shared trip plan in Storage, presence (cursors as lat/lng, live planes), soft edit locks, follow mode | POR-32, POR-34, POR-35 |
| Accounts and trips | Supabase Auth accounts (built); trips need sign-in and the trip URL is the invite. Profiles hold only the display name; plans stay in Liveblocks Storage | POR-29, POR-30 (need rewriting) |
| Money and AI | Per-member cost split | POR-37 |
| Money and AI | Stripe test checkout per member, then a Duffel test order | POR-38 |
| Money and AI | Shared agent in the trip thread (Pip), built on the Vercel AI SDK and DeepSeek V4.1 Flash | POR-39 |

Some tickets predate the custom globe and mention react-globe.gl. Ignore that and use `<TripGlobe>`.

## Rules

- For UI work, follow `DESIGN.md` and use the tokens. Never hard-code colours, fonts, radii or shadows.
- Every leg shows where its data came from. Anything that isn't live shows an "estimated" badge.
- The demo must never depend on a flaky API, so every provider needs a mock fallback.
- Don't use Amadeus Self-Service. It shut down on 2026-07-17.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
