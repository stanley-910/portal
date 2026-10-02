# Foundation decisions

## F1. Stack

**Status:** built (POR-43), 2026-10-02

**Decision:** Next.js 16 (App Router, Turbopack), React 19.2, TypeScript, Tailwind v4, shadcn/ui (base-nova), next-themes, pnpm, Vercel Hobby.

**Why:** It's the stack the team already knows, and every service we use has a free tier. `docs/multiplayer/free-tiers.md` lists the limits.

**Note:** Next 16 has breaking changes. Read `node_modules/next/dist/docs/` rather than relying on memory.

## F2. A custom WebGL2 globe instead of react-globe.gl

**Status:** built, 2026-10-02

**Decision:** `<TripGlobe>` (`src/components/trip-globe`) is a hand-written WebGL2 globe:
- the sphere is ray-traced in a shader on a single full-screen quad;
- the plane is a 3D mesh;
- route arcs, pins and tags are drawn on a 2D HUD canvas.

It was ported from the design prototype (`Flight.dc.html`). react-globe.gl and three.js were removed.

**Why:**
- The halftone print look (screen angles, misregistration, water-lining) is a shader effect that react-globe.gl can't do.
- The prototype already had picking, the plane and the HUD working.

**Consequence:** some tickets (POR-13, POR-22, POR-23) still mention react-globe.gl APIs such as `pointOfView` and `toGlobeCoords`. Ignore those and use `GlobeEngine` (`engine.ts`) instead.

## F3. Design tokens come from one JSON file

**Status:** built, 2026-10-02

**Decision:** `src/design/tokens.json` is a verbatim copy of the Paper Atlas design system's tokens. `scripts/tokens.mts` generates `src/design/tokens.css` from it:
- CSS variables in `:root` (Day) and `.dark` (Night);
- Tailwind `@theme` colours;
- `@utility` classes for type, radius and shadow.

`pnpm dev` regenerates the CSS, and `pnpm build` fails if it is stale. The shadcn variables are mapped onto tokens in `globals.css`.

**Why:**
- The design system stays the single source of truth.
- Re-syncing it means replacing one file.

**Rule:** never hard-code colours, fonts, radii or shadows (`DESIGN.md`).

## F4. Fonts are self-hosted with next/font

**Status:** built, 2026-10-02

**Decision:** `src/app/fonts.ts` loads IM Fell English SC, IM Fell English and Courier Prime through `next/font/google`. They are exposed as `--font-fell-sc`, `--font-fell` and `--font-typewriter`.

**Why:**
- There's no request to Google at runtime.
- next/font keeps the real family names, so the token font stacks still match.

## F5. The design system lives in the published artifact

**Status:** partly done, 2026-10-03

**Decision:** the published Paper Atlas system (https://claude.ai/artifact/8jz9oTWn1hxuQ1C2GScXPm) is the source. The repo copies from it; we don't push the repo up to it.

The published system is now at version 2, which adds:
- an Interface register set in Instrument Sans;
- Button, Panel and PlaceHeader;
- control, panel and float tokens;
- a Logos group.

The repo is still on version 1.

**Partly pulled, 2026-10-03:** the navbar needed version 2's Button kinds, so these are in:
- `tokens.json` replaced with version 2 (`pnpm tokens` now honours a type style's own `family`, which `city` uses);
- Instrument Sans added as `--font-sans`, which `title`, `body` and the other interface styles now use;
- Button ported, and RoundButton restyled (it also takes an `icon` now);
- the logo SVGs and `<portal-logo-reveal>` copied.

Still to pull: Panel, PlaceHeader, and rebuilding `DESIGN.md`.

**Why:** pushing the repo up would have deleted the version 2 work.
