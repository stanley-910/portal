# HKU Hackathon Fall 2026 Project

Portal: draw a trip on the globe and find the best way to get there. Click to take off, move the plane, click to land.

## Get started

Needs Node 22.18 or newer (it runs the TypeScript token script directly) and pnpm.

```sh
pnpm install
echo 'LIVEBLOCKS_SECRET_KEY=sk_...' >> .env.local   # ask Stanley for the key; needed for /t/<trip> pages
pnpm dev
```

Each git worktree needs its own copy of `.env.local`.

Open http://localhost:3000 for the globe and http://localhost:3000/design for the design system gallery.

| Command | What it does |
|---|---|
| `pnpm dev` | Regenerates design tokens, then starts the dev server |
| `pnpm build` | Production build; fails if `tokens.css` is out of date |
| `pnpm lint` | ESLint |
| `pnpm tokens` | Regenerates `src/design/tokens.css` from `tokens.json` |

## Where things live

- `src/app` holds the routes:
  - `/` is the globe screen. "Plan with friends" opens a shared trip.
  - `/t/<id>` is a trip room, and its URL is the invite.
  - `/design` is the token and component gallery.
- `src/components/trip-globe` is `<TripGlobe>`, a WebGL2 globe. `engine.ts` contains the camera, picking, gestures and drawing.
- `src/lib/transport` resolves exact globe clicks to bundled Asia-wide hubs, searches a bounded set of endpoint pairs, and ranks provider offers. See [transport docs](docs/transport/README.md) for coverage, API setup, and honest estimated fallbacks.
- `src/components/paper-atlas` holds the design system components: Ticket, Tag, Sticker, Route and RoundButton.
- `src/components/ui` holds the shadcn/ui components, themed with our tokens.
- `src/design/tokens.json` holds the design tokens. Edit this file, then run `pnpm tokens`.
- `DESIGN.md` holds the design rules. Read it before any UI work.

## Working on it

- Tickets are in Linear: [Hackathon MVP](https://linear.app/portaldevs) (team POR). Branch from the issue's git branch name.
- This is Next.js 16, which has breaking changes from older versions. Check `node_modules/next/dist/docs/` rather than relying on memory. `AGENTS.md` is kept up to date by `next dev`; commit it as is.
- Never hard-code colours, fonts, radii or shadows. Use the tokens; see `DESIGN.md`.

## Licence

Portal is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You may read, run, change and
share the code for noncommercial purposes: personal study, research, hobby projects, and use by charities, schools and
public bodies. Any commercial use, including running Portal or a product built on it as a business, needs a separate
paid licence from the authors. Ask through [GitHub](https://github.com/stanley-910/portal/issues).

Bundled data keeps its own licence and is not covered by ours: OurAirports and Natural Earth are public domain,
Wikidata is CC0, OpenStreetMap-derived hub data is © OpenStreetMap contributors under the ODbL 1.0, and the Passport
Index dataset is credited to passportindex.org (see `src/lib/transport/hubs/DATA.md` and `data/entry/`). Dependencies
keep their own licences.
