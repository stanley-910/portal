# HKU Hackathon Fall 2026 Project

Trip Globe: draw a trip on the globe and find the best way to get there. Click to take off, move the plane, click to land.

## Get started

Needs Node 22.18 or newer (it runs the TypeScript token script directly) and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000 for the globe and http://localhost:3000/design for the design system gallery.

| Command | What it does |
|---|---|
| `pnpm dev` | Regenerates design tokens, then starts the dev server |
| `pnpm build` | Production build; fails if `tokens.css` is out of date |
| `pnpm lint` | ESLint |
| `pnpm tokens` | Regenerates `src/design/tokens.css` from `tokens.json` |

## Where things live

- `src/app` holds the routes: `/` is the globe screen, `/design` is the token and component gallery.
- `src/components/trip-globe` is `<TripGlobe>`, a WebGL2 globe. `engine.ts` contains the camera, picking, gestures and drawing.
- `src/components/paper-atlas` holds the design system components: Ticket, Tag, Sticker, Route and RoundButton.
- `src/components/ui` holds the shadcn/ui components, themed with our tokens.
- `src/design/tokens.json` holds the design tokens. Edit this file, then run `pnpm tokens`.
- `DESIGN.md` holds the design rules. Read it before any UI work.
- `docs/decisions` records what we decided and why: foundation, globe and multiplayer. Read it before starting a ticket.
- `docs/research` holds research notes, such as free-tier limits.

## Working on it

- Tickets are in Linear: [Hackathon MVP](https://linear.app/portaldevs) (team POR). Branch from the issue's git branch name.
- This is Next.js 16, which has breaking changes from older versions. Check `node_modules/next/dist/docs/` rather than relying on memory. `AGENTS.md` is kept up to date by `next dev`; commit it as is.
- Never hard-code colours, fonts, radii or shadows. Use the tokens; see `DESIGN.md`.
