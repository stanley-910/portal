# Paper Atlas

Paper Atlas is the look of Portal: a globe printed in halftone ink on paper, with paper stickers for the things you move around on it. It has two themes. **Day** is coloured ink on cream paper. **Night** is light ink on blue-black paper.

It speaks in two registers:

- **Interface** is modern and quiet: Instrument Sans, soft corners, soft shadows, clear button states. Use it for everything you operate: titles, text, buttons, panels, menus, inputs.
- **Atlas** is printed and stamped: the old-style serif, the typewriter, hard offset shadows, paper stickers. Use it only for the trip itself: places (airport codes, destinations, city names), the ticket, airport tags, stickers and the route.

When unsure, it is Interface. Atlas is the accent.

## Content

- Let the globe speak. Put no instructions, hints or captions on the globe screen. The only words there are airport codes, city names, a date and a distance.
- Write airport codes as three capitals (`HKG`), set in the `code` or `tag` style.
- Write city names in their own spelling, accents included (`Montréal`, `São Paulo`), in the `city` style.
- Write dates as weekday, day, month: `Sat 3 Oct`, shown in capitals in the `stamp` style. Distances use a thousands comma and a space before the unit: `9,624 km`.
- Never use exclamation marks, emoji or marketing words. When something needs a sentence, write one short plain sentence in `body`.
- Button labels are a verb plus its object, in sentence case: `Search flights`, `Change date`. No full stops.

## Colour

- Lay every screen on `paper`. Put raised surfaces (the ticket, tags, panels, secondary buttons) on `paper-raised`.
- Set all text and borders in `ink`. Use `ink-muted` for secondary text, on `paper` or `paper-raised` only.
- Fill the primary button with `ink` and set its label in `on-ink`; on hover it becomes `ink-hover`. Secondary and quiet buttons use `control-hover` behind them on hover. Outline controls in `control-border`; `line` is for decorative dividers only.
- Use `rule` for faint marks that are not text: the graticule, ground tracks, the hover ring.
- Keep `sea`, `sea-deep`, `sage` and `moss` for the globe and for maps. They are print inks, not UI colours: never use them for buttons or text.
- Stickers keep the same paper colours in both themes (`sticker-fill`, `sticker-ink`, the `member-*` colours). A sticker is a real piece of paper laid on the page, so it does not change at night. Everything printed on the page (text, route, tags, ticket) follows the theme.
- There is no accent colour. Emphasis comes from size, the sticker treatment, or motion.

## Type

- Four faces, all from Google Fonts:
  - **Instrument Sans** (`sans`): the interface. Styles `title`, `heading`, `body`, `label`, `button`, `caption`.
  - **IM Fell English SC** (`fell-sc`) and **IM Fell English** (`fell`): places only. Styles `code` (airport codes), `destination` (a place's name when it is the subject of a screen or card) and `city` (italic city names).
  - **Courier Prime** (`typewriter`): the ticket and tags. Styles `stamp`, `meta`, `tag`.
- Load them with one link: `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Courier+Prime:wght@400;700&family=IM+Fell+English+SC&family=IM+Fell+English:ital@0;1&display=swap`.
- Never set interface text (buttons, labels, titles) in the serif, and never set a place name in the sans when it is the subject. Do not mix styles inside one line, except a `city` beside a `code`.

## Print textures (the globe)

- Draw the globe orthographic, lit from the upper left, centred at 45.5% of the screen height, with radius `min(40% of width, 37% of height)`.
- Print the sea and land as halftone dots at `halftone-pitch`, with each ink at its own screen angle (`screen-sea`, `screen-land`, `screen-moss`). Print `moss` offset by `misregister`.
- By day, ink gathers on the shadow side. By night, the inks are light, so they gather on the lit side instead.
- Draw coastlines in `ink` at about one device pixel. Add three or four water-lining ripples in `sea-deep` off each coast, fading out from the shore.
- Draw the graticule every `graticule-step` in `ink` at 30% (20% at night), with the equator slightly stronger.
- Ring the globe with a solid `ink` outline plus two thin rings just outside it, and give the whole globe a hard offset shadow, like a paper cut-out.
- Lay a fine paper grain over everything.

## Stickers and the route

- Two stickers exist: the **plane** (the cursor while flying) and the **star pin** (origin and destination). Draw each as its face with a `sticker-ink` outline at `line-ink`, and no cut border. Set it off the page with the cast shadow below.
- **Cast shadow.** A sticker casts its shadow in `sticker-shadow`, down and to the right along the light. How far off and how soft it falls depends on altitude, from 0 (on the page) to 1 (high): about `1.5px 2px`, blurred 1px, at 0, out to `10.5px 14px`, blurred 3.5px, at 1. Star pins sit at 0, the plane sticker at 0.5 and cursors at 0.5. On a textured globe, lower the altitude over high terrain so the shadow closes in on mountain tops.
- While flying, the plane casts a soft shadow offset down and to the right. On landing, the shadow slides in under the plane and the plane shrinks to about 70%: a touchdown.
- Draw a route as a great-circle arc that rises off the surface, dashed in `ink` at `line-route` with `dash-route`. Under it, draw the surface path dotted in `rule` with `dash-ground`. Hide any part that passes behind the globe.

## Cursors and members

- Each trip member gets a colour of sticker paper, `member-1` to `member-6`, handed out in that order; a seventh member starts again at `member-1`. These are the only colours that tell people apart, and the one exception to "no accent colour". Never use them for anything but a member's cursor and name label.
- They are paper, so they stay the same in both themes. `sticker-ink` reads on every one at 5.4:1 or better.
- A member's cursor is a sticker in their colour (see Cursor), with their name on a label beside it in the `tag` style.

## Motion

- Keep three moments only. **Takeoff:** an ink ripple from the origin, and the star pin pops in. **Landing:** the touchdown, and the globe turns to frame the whole route. **Searching:** the route dashes march forward and the ticket's three dots bob.
- When the viewer prefers reduced motion, keep the end states and drop the movement.

## Layout and controls

- The globe is the whole screen. The ticket sits bottom-centre, `space-6` from the bottom, tilted −1.2°. Interface panels float over the globe on `paper-raised` with `radius-panel` and `shadow-float`, never tilted.
- Every interactive target is at least 44px tall. Buttons use `radius-control`, `space-control` side padding and the `button` style. Use one primary button per view; the rest are secondary or quiet.
- Button states: hover changes the fill (150ms), pressing scales the button to 98%, disabled drops it to 45% opacity. Round icon buttons are `paper-raised` discs with a `control-border` outline and `shadow-float`.
- Show keyboard focus as a solid 2px `focus` outline, offset 2px, on every control.

## Logo

- The logo is a hand-drawn globe split by a tilted horizon: the top half stippled, the bottom half solid by day and open by night. It sits beside or above the word "Portal" in Instrument Sans SemiBold, already outlined in the files.
- Use the files in the Logos group as they are: `portal-logo-horizontal-*` in headers, `portal-logo-stacked-*` on splash and landing screens, `portal-mark-*` alone. Pick `-light` on `paper` and `-dark` on night `paper`; `portal-mark.svg` switches by itself and is the favicon.
- Never redraw, recolour, clean up or re-letter the logo. Keep clear space of at least half the mark's width around it.

## Iconography

- There is no icon set. Draw the few glyphs needed (close, arrows) as inline stroke SVGs, 1.6px, in `currentColor`.

## Components

Interface:

- **Button**: every action. `primary` (one per view), `secondary`, `quiet`; optional 16px icon.
- **RoundButton**: a 44px round icon button, mostly close. Floats over the globe or pins to a surface's corner.
- **Panel**: the floating surface for anything you operate over the globe (results, filters, details). Optional close.
- **PlaceHeader**: an interface eyebrow over a place name in the atlas serif. Use it whenever a view is about a place.

Atlas:

- **Ticket**: the trip summary after landing. Stamped, tilted, hard shadow; one per screen.
- **Tag**: a three-letter airport code beside a pin or the plane.
- **Sticker**: the plane and the star pin.
- **Route**: a dashed arc between two places in flat layouts; the globe draws its own.
- **Cursor**: another member's pointer, a sticker in their colour with their name on a label.

Build new screens from these first. When something new is needed, decide its register before styling it: if a person operates it, it is Interface; if it is part of the trip itself, it is Atlas.

## Using this system

- Tokens are in `tokens.json` (Day is the first theme, Night the second). In code, expose them as CSS custom properties with the same names (`--ink`, `--paper-raised`, `--radius-control`…), switching to the Night values under the dark theme. Expose font families as `--font-sans`, `--font-fell-sc`, `--font-fell` and `--font-typewriter`.
- Components are in `components/bundle.js` as `window.PaperAtlas` (React 18), styled by `components/bundle.css`, typed in `components/index.d.ts`. In a codebase, port them as typed components with the same names and props, keeping the class rules from `bundle.css`.
- The logo files are in the Logos group; copy them as files, never redraw them.
