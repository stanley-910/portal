# Globe decisions

All the code is in `src/components/trip-globe/engine.ts` unless noted.

## G1. Zoom like Google Earth (POR-45)

**Status:** built, 2026-10-02

**Decision:**

**Camera:** it orbits a ground target `(lat0, lon0)` at a distance `range`.

**Inputs:**
- trackpad pinch (`wheel` with ctrl or meta held);
- Safari gesture events;
- two-finger touch pinch.

**How it behaves:**
- Zoom is anchored: the ground point under the cursor, or between the fingers, stays put.
- It eases in log space with a little inertia.
- The camera tilts up to 0.8 rad as you get close.
- Landing does a short fly-to hop.
- The sky stays as you zoom in: see G5.

**Why:** it's the zoom the team pointed to as the reference. Anchoring is what makes it feel like zooming into a place rather than towards the screen centre.

**Limits:**
- `RANGE_MAX = DG - 1 = 2.4`: fully zoomed out.
- `RANGE_MIN = 0.2`: the 2048×1024 earth texture gets blobby closer than that.

## G2. Two-finger pan, including during a flight (POR-44)

**Status:** built, 2026-10-02

**Decision:**
- A two-finger scroll (`wheel` without ctrl) or a touch drag turns the globe, with the same inertia as a click-drag.
- While a trip is being plotted, scrolling turns the globe faster (`FLY_SCROLL = 2.5`).
- The plane stays under the cursor, so the camera effectively follows the flight.

## G3. The plane is a sticker on top of the print (POR-46)

**Status:** built, 2026-10-02

**Decision:** the plane is drawn as a flat paper body with a soft shade and an ink outline hull. It has no halftone shading of its own, and no white cut border.

**Why:**
- The plane is a paper sticker laid on the printed page (`DESIGN.md`), so no globe dots should show through it.
- The old halftone used the same pitch and angle as the land, so it looked like the land showing through.
- We dropped the white border at the user's request.

## G4. The plane grows a little as you zoom in

**Status:** built, 2026-10-02

**Decision:** the plane's world scale is `zoomScale ^ 0.85`, where `zoomScale = range / RANGE_MAX`. On screen it grows to about 1.5× when fully zoomed in. Its height above the surface and its shadow use the same scale.

**Why:**
- If its world size stayed fixed, it would balloon as you zoomed in.
- If its screen size stayed fixed, it would feel pasted on.
- A slight growth keeps it reading as an object on the map.

## Known issues

- Snapping to an airport always pulls up to 220 km, whatever the zoom. Zoomed in, this can snap a short hop onto the same airport (HKG → HKG, 0 km). It should scale with zoom; POR-16 (hub picker) owns it.
- Pan glide and pinch haven't been tuned on real touch hardware yet.

## G5. A generated, stippled sky in world space

**Status:** built, 2026-10-03

**Decision:** the three sticker stars around the globe are gone. In their place is a sky printed in stippled `ink`, generated from a seed. Each load rolls a new seed, so the sky is different every time. Code is in `sky.ts`, with the GLSL in `shaders.ts`.

**What's in it:**
- About 48 bright stars with four diffraction spikes, 150 medium stars and 900 specks of dust. Roughly a tenth of the sky is on screen, so a few spiked stars show at a time.
- Every class is placed on a Fibonacci lattice, turned to a random orientation, with each point jittered within its cell. The layout changes every time, but the spread stays even: any view holds about the same number of stars, with no clumps or bare patches.
- Around nine nebulae. They are dense where their north rim catches the light and sparse inside. Stars behind a nebula's body are hidden.
- Stars are hidden behind the globe and fade out through its atmosphere hatching.

**How it reacts to the camera:**
- Stars are directions on the sphere, so they turn with the camera.
- About a third of the stars, and all the nebulae, sit on nearer shells: radius 5 to 14 for stars, and `SKY_R = 9` for nebulae. They drift against the far stars when you pan or zoom, and the nearer stars grow a little as the camera closes in.

**Cost:**
- The stars are one instanced draw. The stipple is a per-pixel hash, anchored to each star so it doesn't crawl as the star moves.
- The nebula stipple is hashed on a lattice fixed to the sky, not to screen pixels, so its grain moves with the clouds. Hashing per screen pixel left specks that stayed put while the globe turned.
- The nebulae are baked once per seed into a 2048×1024 RG8 texture. After that, the globe pass only adds one texture read and one hash per pixel.
- None of this depends on how many people are on the trip.

**Multiplayer:** `<TripGlobe skySeed>` takes any string or number. Without it, every load gets a new sky. To share one sky across a trip, roll a seed when the trip is created, store it with the trip, and pass it in.

**Why:**
- The sticker stars were fixed to the screen, so they didn't move with the globe.
- The reference was a stippled night sky.
- Ink stipple on `paper` keeps it a print in both themes: an engraved star chart by day, light ink on blue-black at night.
- It doesn't animate (no twinkle), keeping to the three motion moments in `DESIGN.md`.

## G6. A calmer print: finer halftone, no outer rings, no cut-out shadow

**Status:** built, 2026-10-03

**Decision:**
- `halftone-pitch` drops from 4.5px to 3.2px. The engine now reads it from `tokens.json` instead of hard-coding it.
- The two thin rings outside the globe are gone. The solid outline on the globe's edge stays.
- The hard offset shadow, down and to the right of the globe, is gone. The plane's shadow on the ground stays.

**Why:** the user liked the look, but the coarse ocean dots became disorienting after a while, and the outer rings competed with the sky. Fading them to 30% wasn't enough. With a sky behind it, the globe is no longer a paper cut-out lying on the page, so a fixed offset shadow didn't fit it.

## G7. A small ring marks the trip's start, not the star pin

**Status:** built, 2026-10-03

**Decision:** the trip's start is a small `ink` ring, filled with `paper-raised`, at the foot of the route. The star-pin sticker no longer pops in at takeoff, though the ink ripple stays. The origin's airport tag sits just under the ring.

**Why:** the user found the starburst too loud for a starting point. The star pin is still in `paper-atlas` (`Sticker`), but the globe doesn't use it.

## G8. Country borders printed into the globe, and names set like an atlas

**Status:** built, 2026-10-03

**Decision:**

**Borders** are part of the print, drawn in the globe shader like the coastline, not on the overlay canvas.
- `pnpm borders` (`scripts/build-borders.mts`) rasterises Natural Earth 50m countries (the `world-atlas` package) into `public/textures/borders.png`: 4096×2048, about 170 KB.
- Each country is filled with a 3-bit code, one bit per RGB channel, picked so no two touching countries share one. A border is wherever a channel crosses 0.5, so the shader inks it with the same `fwidth` trick as the coastline. It stays one line wide at every zoom.
- Each texel averages 4×4 samples, so the crossing lands between texels.
- The sea takes the code of the nearest country, so channels only cross on land. The shader also masks borders to land.
- Somaliland is folded into Somalia and Northern Cyprus into Cyprus. Hong Kong and Macao keep their own outlines.

**Names** are drawn on the overlay canvas, under the route, pins and tags.
- The same script writes `countries.ts`. For each country it gives an anchor (the pole of inaccessibility of its largest piece), its long axis and span (principal components of its texels near the main landmass), and its area.
- A name shows once its country has room for it on screen, so more names appear as you zoom in. It fades in as it gains room. Bigger countries are placed first, and a name that would collide is skipped.
- A long name that won't fit on one line breaks onto two at its most balanced space ("Papua New" over "Guinea"). It goes back to one line only once that fits with 25% to spare, so it doesn't flicker between the two.
- Running level, a country's room is its width along the parallel, taken as an ellipse on its long axis. Averaging length and width shortchanged wide, slightly tilted countries.
- A long thin country runs its name along its axis when that axis is within 60° of level. Other names run along their parallel, so they curve with the globe toward the edge.
- Names step around planes and airport tags, and print at 70% while a trip is on the globe.
- Names don't pop. Names already on screen are placed first, so a newcomer never displaces one. A new name needs 10% spare room to appear, and keeps its place until it is 5% short. A name that loses its place waits 0.6s before trying again. Each name fades in or out over about 0.2s, and switches at once under reduced motion. A long country flips to its axis below 60° and back above 66°. Measured: no visible name flipped back within 0.5s over an 8s spin and a 5s zoom.
- The type is a new `country` token: Courier Prime bold, 11px, in capitals with 0.16em tracking, set in `ink` with a soft 70% `paper` halo. It grows up to 1.25×.
- Each name is drawn once into a cached canvas, halo included, and frames only copy it, rotated and scaled. The cache clears on a theme or font change. Names facing away are rejected before any projection.
- Revised after review. The first cut used Fell SC: at 14px with a thin halo, halftone dots showed through the letters. Fell with an opaque halo was legible but heavy. A small mono in capitals reads cleanly and matches the tags. Drawing text every frame (font parse, letter spacing, three text passes per name) also cost CPU on large windows, hence the sprites.

**Why:**
- Borders on the overlay canvas would draw on top of the plane. Printing them keeps the plane a sticker over the map, and the borders pick up the paper grain and shading for free.
- A distance field can't hold a sharp line when magnified, because its zero sits between texels. Codes that cross 0.5 have the same signed-edge behaviour as the land mask.
- Small tracked capitals read over the halftone at any size and sit with the airport tags. `ink-muted` was too weak over the halftone land.

**Limits:**
- The border texture is about 10 km per texel. Hong Kong's border with Shenzhen is only a few texels long, and the coastline (`earth.png`, 2048 wide) is coarser still.
- Natural Earth's lines are de facto boundaries. Disputed areas (Kashmir, Western Sahara) follow its defaults.

## G9. Draw only what changed, and shade the surface only where the globe can be

**Status:** built, 2026-10-03 (by a Codex agent, reviewed and measured here)

**Decision:**
- When the view, the trip and the planes haven't changed, the GL canvas isn't redrawn, and the overlay is redrawn only for hover, fades and animation. Anything that changes the picture without moving the camera marks the canvases dirty: theme, sky seed, a texture arriving, fonts loading, a resize. Frame callbacks still run every frame, for remote cursors.
- `preserveDrawingBuffer` is off. A canvas with no new draw keeps showing its last frame.
- The globe pass is scissored. Rectangles outside the globe's projected bounds run the shader with `uSurface` off, which skips the surface. The branch is uniform per draw, so derivatives stay valid at the rectangle edges. Close, tilted views fall back to one full draw.
- The plane-shadow maths is skipped when there is no shadow.
- Route arcs, projected points and remote flights' airport lookups reuse buffers instead of allocating per frame.
- `engine.test.ts` covers the redraw skipping, the surface bounds and the arc buffers.

**Measured** (3200×2000 device px, median of 60 synced draws): the globe pass went from 6.6ms to 5.2ms per frame zoomed out or mid zoom, about 20% less. The overlay is 0.1–0.2ms either way. Settled frames now cost nothing.
