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

## G5. Preview nearby bundled transport hubs, without moving the clicked points

**Status:** built in `feat/click-to-transport-hubs`, 2026-10-03

Idle hover and the flying plane now label the closest nearby airport, railway
station or ferry terminal from the bundled catalog. This removes the old mock
airport weight/pull behavior. Uncovered locations have no hub label; clicked
coordinates and click-to-click distance stay exact even when both previews select
the same hub. Hover is browser-local, throttled and updated after camera movement;
it does not call providers or determine country boundaries. The landing search
still performs connection-aware pair selection. See [TR4](../transport/decisions.md#tr4-use-the-bundled-catalog-for-local-hover-and-in-flight-previews).

## Known issues
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
