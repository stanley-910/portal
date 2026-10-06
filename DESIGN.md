# Paper Atlas: the Portal design system

<!-- Source: https://claude.ai/artifact/8jz9oTWn1hxuQ1C2GScXPm (project/README.md). Keep the brand book below in sync with it. -->

Paper Atlas is the look of Portal: a globe printed in halftone ink on paper, with paper stickers for the things you move around on it. It has two themes. **Day** is coloured ink on cream paper. **Night** is light ink on blue-black paper.

## Content

- Let the globe speak. Put no instructions, hints or captions on the globe screen. The only words there are airport codes, city names, country names, a date and a distance.
- Write airport codes as three capitals (`HKG`), set in the `code` or `tag` style.
- Write city names in their own spelling, accents included (`Montréal`, `São Paulo`), in the `city` style.
- Write country names in their short English form (`Japan`, `South Korea`, `DR Congo`), in capitals in the `country` style.
- Write dates as weekday, day, month: `Sat 3 Oct`, shown in capitals in the `stamp` style. Distances use a thousands comma and a space before the unit: `9,624 km`.
- Never use exclamation marks, emoji or marketing words. When something needs a sentence, write one short plain sentence in `body`.

## Colour

- Lay every screen on `paper`. Put raised surfaces (the ticket, tags, round buttons) on `paper-raised`.
- Set all text and borders in `ink`. Use `ink-muted` for secondary text, on `paper` or `paper-raised` only.
- Use `rule` for faint marks that are not text: the graticule, ground tracks, the hover ring.
- Keep `sea`, `sea-deep`, `sage` and `moss` for the globe and for maps. They are print inks, not UI colours: never use them for buttons or text.
- Stickers keep the same paper colours in both themes (`sticker-fill`, `sticker-ink`, the `member-*` colours). A sticker is a real piece of paper laid on the page, so it does not change at night. Everything printed on the page (text, route, tags, ticket) follows the theme.
- There is no accent colour. Emphasis comes from size, the sticker treatment, or motion.
- `alert` is a signal, not an accent: a small mark for something waiting on you, such as Pip's new-reply badge. Edge it in `sticker-ink`, keep it to a dot, and never set text in it or behind it.

## Type

- Four faces, all from Google Fonts: **Barlow Semi Condensed** (`sans`) for the interface (titles, text, buttons, panels, inputs), **IM Fell English SC** (`fell-sc`) for codes and titles, **IM Fell English** (`fell`) for city names and running text, **Courier Prime** (`typewriter`) for dates, distances, tags and country names.
- Load them with one link: `https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=IM+Fell+English+SC&family=IM+Fell+English:ital@0;1&display=swap`.
- Styles: `code`, `title`, `country`, `body`, `city`, `stamp`, `meta`, `tag`. Do not mix them inside one line.

## Print textures (the globe)

- Draw the globe orthographic, lit from the upper left, centred at 45.5% of the screen height, with radius `min(40% of width, 37% of height)`.
- Print the sea and land as halftone dots at `halftone-pitch`, with each ink at its own screen angle (`screen-sea`, `screen-land`, `screen-moss`). Print `moss` offset by `misregister`.
- By day, ink gathers on the shadow side. By night, the inks are light, so they gather on the lit side instead.
- Draw coastlines in `ink` at about one device pixel. Add three or four water-lining ripples in `sea-deep` off each coast, fading out from the shore.
- Draw the graticule every `graticule-step` in `ink` at 30% (20% at night), with the equator slightly stronger.
- Draw country borders on land only, in `ink` at about 55% (75% at night): finer and fainter than the coastline, and fading toward the globe's edge. They are part of the print, so they sit under the plane and its shadow.
- When a trip lands, light up the destination country's outline (its borders and coast): full-strength `ink`, a little wider, over a soft halo of whichever of `paper` and `ink` is lighter. It comes up just after touchdown and goes with the trip.
- Print country names in the `country` style: tracked capitals in `ink`, with a soft `paper` halo that lifts them off the halftone without boxing them in. Set each name level along its parallel, or along a long thin country's axis (Japan, Norway) when that axis is within 60° of level. The whole globe, fully zoomed out, carries no names: they print in as you zoom in. A name shows only once its country has room for it on screen, bigger countries win where names collide, and no name sits on a plane or an airport tag. While a trip is on the globe, country names print at 70% so the route leads.
- Draw no outline round the globe: its halftone meets the sky directly. It hangs in a stippled night sky, so it casts no shadow on the page.
- Lay a fine paper grain over everything.

## Stickers and the route

- Two stickers exist: the **plane** (the cursor while flying) and the **star pin**. On the globe, only the plane is used, plus the 3D map pins a landed trip drops (below); a trip's start is marked with a small `ink` ring at the foot of the route. Draw each sticker as its face with a `sticker-ink` outline at `line-ink`, and no cut border. Set it off the page with the cast shadow below.
- While a leg is drawn, the plane turns into the vehicle the leg looks like: a **train**, a **bus** or a **ferry**. They are the same paper as the plane: `sticker-fill` faces, `sticker-ink` outlines and windows, one `roundel` accent each (the train's side stripe, the bus's stripe along its sides and roof edges, the ferry's funnel). Ground vehicles skim low over the surface. When the vehicle changes, the old one shrinks away and the new one grows in over 0.25s; under reduced motion it swaps at once.
- **Landing and pins.** A landed trip parks nothing. The plane settles onto the ground (0.45s), shrinks away (0.25s), and then a **pin** drops into each stop the trip goes to, one per rider. A pin is a small, smooth round head in the rider's member colour, outlined in ink like the vehicles, on a fine `sticker-ink` needle that keeps only a hairline of outline. It leans back from upright so its needle shows from above. It falls from about one and a half times its height (0.3s), its point sinks a little into the ground, and it squashes and springs back, with a fading `ink` ring on the ground. Pins dropped together land 0.09s apart. Several riders' pins at one stop share its point and fan out sideways like a bunch. The globe prints each pin's shadow, and a stop's tag sits clear above its pins. Pointing at a bunch names its riders on a `tag`-style label. Dragging a stop's pins lifts them just under their own height over a ring marking where they'll land, which keeps the offset from the pointer it was picked up at, so picking them up moves nothing; the routes into the stop meet the ground at the ring's centre, and on release the pins drop the same way. Under reduced motion pins appear in place.
- **Cast shadow.** A sticker casts its shadow in `sticker-shadow`, down and to the right along the light. How far off and how soft it falls depends on altitude, from 0 (on the page) to 1 (high): about `1.5px 2px`, blurred 1px, at 0, out to `10.5px 14px`, blurred 3.5px, at 1. Star pins sit at 0, the plane sticker at 0.5 and cursors at 0.5. On a textured globe, lower the altitude over high terrain so the shadow closes in on mountain tops.
- While flying, the plane casts a soft shadow offset down and to the right. On landing, the shadow slides in under the plane and the plane shrinks to about 70%: a touchdown.
- Draw a route as a great-circle arc that rises off the surface, dashed at `line-route` with `dash-route`. The route and its start ring take the colour of the member who drew it, the same as their cursor, mixed toward `ink` (45% on light paper, 25% at night), over a `paper` halo at 85% like the country names' so it reads over land and sea alike. A leg no member drew (Pip's) stays `ink`. Under it, draw the surface path dotted in `rule` with `dash-ground`. Hide any part that passes behind the globe.

## Cursors and members

- Each trip member gets a colour of sticker paper, `member-1` to `member-6`, handed out in that order (`memberColor(slot)`; a seventh member starts again at `member-1`). These are the only colours that tell people apart. Never use them for anything but a member's cursor, name label, pins and the routes they draw.
- A member's cursor is a sticker in their colour, with the tip as the hotspot: `arrow` (plain pointer), `compass` (needle with a coloured north half) or `map` (the arrow folded like a road map). Each member picks theirs in the profile menu, and everyone in a room sees it in that shape, shadow and all.
- Beside the cursor sits their name on a label in the `tag` style, `sticker-ink` on their colour, tilted −1.2°. Cursor and label cast one shadow together (`altitude`, default 0.5). Jade, cornflower and orchid have the same lightness, so the name, not the hue, is what tells members apart.
- Other members' cursors are DOM stickers (`<Cursor>`). To turn the viewer's own pointer into one, use `cursorUrl(shape, colour, theme)` as the CSS `cursor`.
- Remote cursors ease between updates over 90ms. Under reduced motion they jump.

## Motion

- Keep three moments only. **Takeoff:** an ink ripple from the origin. **Landing:** the touchdown, and the globe turns to frame the whole route. **Searching:** the route dashes march forward and the ticket's three dots bob.
- When the viewer prefers reduced motion, keep the end states and drop the movement.

## Layout and controls

- The globe is the whole screen. The ticket sits bottom-centre, `space-6` from the bottom, tilted −1.2°.
- Every interactive target is at least 44px. A `Button` inside a card is drawn compact (32px, `radius-tag` corners) and keeps its 44px tap area unseen. A round button over the globe is a `paper-raised` disc with a `control-border` border and the `shadow-float` shadow, so it reads against the map. Inside a panel (sign-in, Pip's chat) use the quiet one instead: the bare glyph in `ink-muted`, with no border or shadow, that fills with `control-hover` on hover.
- Every scrollbar is a thin pixel bar: 6px of solid `control-border` (`ink-muted` while held), its corner pixels stepped off. Don't restyle one per component; a component that sets `scrollbar-width` or `scrollbar-color` loses it in Chrome.
- Text fields (inputs, search boxes, the message box, rename fields) never show a focus outline or a bright frame: while you type in one it fills with `control-hover`, and its border stays as it is. A field drawn inside a wrapper fills the wrapper (`:focus-within`), never outlines it.
- Show keyboard focus on everything else (buttons, links, chips) as a solid 2px `focus` outline, offset 3px. Never outline a selection: a picked, open or typed-in control fills with `control-hover` (or `ink`, for a picked choice), and its border stays `control-border`.

## Logo

- The Portal logo files and the `<portal-logo-reveal>` web component live in `design-system/paper-atlas/` (`assets/Logos/`, `components/LogoReveal/`). Use the logo files as they are: never redraw, recolour or re-letter them.
- `<NavBar>` (`src/components/nav-bar`) shows the logo top-left and the screen's controls top-right. The logo is always `<portal-logo-reveal>`, imported once on the client, which draws it on at load; never swap in the static horizontal SVG, which can't animate. When the globe zooms in, the bar shrinks to the bare mark and icon-only controls. Its actions are a primary `Button` (ink fill) and `RoundButton`s; zoomed in, the Button folds into a disc and every control shrinks from 36px to the size of the globe mark (28px). Each keeps a 44px tap area.
- The bar always ends with the profile disc (`ProfileMenu`): your initials, or a person glyph before you have a name. It opens a panel with who you are, Theme (Day, Night, Auto) and the screen's own settings, such as Currency, as segmented choices. Put settings there, not as more buttons in the bar.

## Iconography

- There is no icon set. Draw the few glyphs needed (close, arrows) as inline stroke SVGs, 1.6px, in `currentColor`.

## In this repo

- **Tokens:** `src/design/tokens.json` is the source of truth. `pnpm tokens` writes `src/design/tokens.css` (CSS variables for Day under `:root` and Night under `html.dark`, plus Tailwind utilities). `pnpm build` fails if the CSS is stale.
- **Tailwind:** colours as `bg-paper`, `bg-paper-raised`, `text-ink`, `text-ink-muted`, `border-ink`, `border-rule`. Type styles as `type-code`, `type-title`, `type-body`, `type-city`, `type-stamp`, `type-meta`, `type-tag`. Also `font-fell-sc`, `font-fell`, `font-typewriter`, `rounded-tag`, `rounded-ticket`, `shadow-ticket`, `shadow-tag`. Spacing tokens as `p-(--space-3)`.
- **shadcn/ui:** its variables (`--background`, `--primary`, `--border`, ...) are mapped onto these tokens in `src/app/globals.css`, so `src/components/ui/*` render in ink on paper.
- **Components:** `src/components/paper-atlas` (`Ticket`, `Tag`, `Sticker`, `Route`, `RoundButton`, `Cursor`), styled by `paper-atlas.css` in the same folder.
- **Globe:** `src/components/trip-globe` (`<TripGlobe theme onTakeoff onLand onCancel />`). Its WebGL and canvas colours are read from `tokens.json`. The earth data texture is `public/textures/earth.png`. Borders (`public/textures/borders.png`) and name placement (`countries.ts`) come from Natural Earth 50m through `pnpm borders`. Province and state borders (`public/textures/provinces.png`, `pnpm provinces`) and city names (`cities.ts`, `pnpm cities`) come from Natural Earth 10m and print in as you zoom: provinces as a finer, fainter line than country borders, cities biggest first in the `city` face beside a small ink dot, a ring for a capital. The face has one weight, so size and ink carry the hierarchy: world cities at 19px with a bigger dot, regional cities at the `city` size, towns at 12–13px. Every city name is `ink`; each fades in from nothing to fully printed as you zoom to its size, and city names don't dim while a trip is on the globe.
- **Hub markers:** zoomed in, the airports, stations and ferry terminals the pointer can lock on to show as their mode's glyph in `ink` over a `paper` halo, never a dot a city could be taken for: a plane climbing up and to the right for an airport, the front-on train for a station, the ferry for a terminal, smaller for minor hubs. They show once a country and its neighbours fill the view. Large airports print their code in the `tag` face over a `paper` halo on the first side of the glyph (right, left, under, over) clear of the names and other markers. A marker pops up as it comes into reach (none under reduced motion); whatever the pointer is locked on, hub or city, is marked by two `ink` rings on the ground that snap in as it catches (the hub's glyph steps aside for them), with a short tether in `ink` (1.1px over a `paper` halo, dashed at `dash-lock`) out to the pointer, whose label names it; flying, there's no tether. Before the hubs show, the pointer locks on to the cities named on the globe the same way. A marker right by a city's dot stands in for it, the city's name beside the marker; other markers keep clear of city names, giving way where a name has to sit on one. City names never move or hide for a plane, since the label under the plane already names where it is; a flying plane or vehicle is cut out of the names it passes over, so it reads as above the print, and a country's name gives way to a city's rather than the other way round. A carried stop keeps the offset from the pointer it was picked up at, and its routes meet the ground at the centre of the ring marking where it will land. See `docs/transport/README.md`.
- **Fonts:** self-hosted with `next/font` in `src/app/fonts.ts`, not the Google Fonts link above.
- **Gallery:** `/design` renders every token and component in both themes.
