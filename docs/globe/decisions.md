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
- The globe's rings and stars fade as you zoom in.

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
