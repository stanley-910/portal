# Ground vehicles on the globe

Date: 2026-10-03

## Goal

After a trip lands, the vehicle parked at the landing point matches the mode of the offer the person has picked: a plane for a flight, a train, a bus or a ferry. Other trip members see the same vehicle on stored legs.

While flying, the vehicle is always the plane. Only a landed trip changes vehicle.

## Behaviour

- **Home globe (`/`).** The vehicle follows the selected row in the ticket card. Switching rows or tabs switches the vehicle. Until the search finishes, or when it returns nothing, the vehicle stays a plane. Takeoff and cancel reset it to the plane.
- **Trip room (`/t/<id>`).** Each stored leg's parked vehicle follows that leg's chosen offer (`leg.chosen`, looked up in `leg.search.offers`). With no chosen offer it is a plane. Your own landed vehicle follows the leg you just landed (`landedLeg`) the same way. Members still in the air come from presence and are always planes, so presence (`FlightState`) does not change.
- **Placement.** Every vehicle parks where the plane touched down: on the surface (altitude 0), nose along the route, no bank or pitch, shadow tucked under it. The route arc and ground path are unchanged.
- **Swap.** When the vehicle changes, the old one shrinks to nothing and the new one grows back over about 0.25s, like a sticker being swapped. The mesh changes at the midpoint. Under reduced motion it swaps instantly. This counts as part of the landing moment in DESIGN.md's "three moments only".

## Vehicles

All are built from code in the plane's style: object space x = right, y = up, z = nose, length about 1, the same `slab` and `tube` helpers, faceted paper with an ink outline. Each has a part id per vertex for painting.

- **Train.** A high-speed rail power car with a long tapered nose cab, followed by one or two shorter trailing cars with small gaps. Window band in `sticker-ink`, a stripe along the side in `roundel`.
- **Bus.** A rounded box, a window band in `sticker-ink`, a `roundel` stripe and four short wheel stubs.
- **Ferry.** A wedge hull, two stepped deck tiers with a window band, a funnel in `roundel`.

The plane stays as it is. Its fin is painted fully in `roundel`, which `tokens.json` says is only for the wing roundels. That is out of scope here and is left unchanged.

## Architecture

### Meshes

- `src/components/trip-globe/mesh.ts` (new): the mesh helpers (`slab`, `tube`, part centring, smoothed normals) move here from `plane-model.ts`, along with the `VehicleMesh` type (`PlaneMesh` renamed).
- `plane-model.ts` keeps `buildPlane()` with the same name, signature and output, built on `mesh.ts`.
- `src/components/trip-globe/vehicle-models.ts` (new): `buildTrain()`, `buildBus()`, `buildFerry()`, each returning a `VehicleMesh`, and `VEHICLE_LENGTH: Record<Mode, number>`, the length of each mesh (plane included) in object units, for label spacing.

### Engine (`engine.ts`)

- `Plane` gains `vehicle: Mode` (what is drawn), `next: Mode` (what it is changing to) and `swap: number` (0 to 1 progress through the pop).
- One VAO and vertex count per vehicle, built in `start()` and freed in `destroy()`.
- New public `setVehicle(mode: Mode)` for this viewer's own vehicle. It is ignored while flying. Takeoff and `cancel()` reset to `"flight"`.
- `RemoteFlight` gains an optional `vehicle?: Mode`, defaulting to `"flight"`. `setRemoteFlights` starts a swap when it changes.
- Per frame, swap progress advances. The draw scale is `S * (1 - sin(π * swap))`, and `vehicle` takes the value of `next` once `swap` passes 0.5. With reduced motion, `vehicle = next` straight away.
- A landed ground vehicle keeps the existing touchdown: altitude, bank and pitch ease to 0.
- The draw loop binds each plane's vehicle VAO and count and sets a new `uVehicle` uniform.
- `underPlane` uses `VEHICLE_LENGTH[vehicle]` in place of a fixed plane length, so the tag clears a long train.

### Shaders (`shaders.ts`)

`FS_PLANE` gains `uniform int uVehicle` and branches on it for per-part paint. The plane's branch is unchanged. No new programs or vertex attributes.

### `TripGlobe` (`trip-globe.tsx`)

`TripGlobeHandle` gains `setVehicle(mode: Mode): void`, passed through to the engine.

### Home globe (`globe-screen.tsx`, `ticket-search.tsx`)

- `TicketSearch` gains an optional `onChoiceChange?: (offer: Offer | null) => void`. It fires from an effect when the selected offer (`choice`) changes, including to null.
- `GlobeScreen` passes `offer => globe.current?.setVehicle(offer?.mode ?? "flight")`.

### Trip room (`remote-planes.tsx`, `trip-room.tsx`)

- `storedFlights` reads each leg's chosen offer id, finds it in `leg.search.offers` and sets `vehicle` to its mode, or `"flight"` when there is none.
- `trip-room.tsx` reads the chosen mode of `landedLeg` from storage and calls `globe.current?.setVehicle(...)` when it changes.

## Docs

- `DESIGN.md`, Stickers and the route: the globe's vehicle matches the picked offer's mode (plane, train, bus, ferry). Ground vehicles park on the surface and swap with a quick pop. Only the plane flies.
- `src/design/tokens.json`: the `roundel` usage covers the accent on each vehicle as well as the plane's wing roundels.

## Testing

- **Meshes (`vehicle-models.test.ts`, new).** Each builder returns a non-empty mesh with `count * 3` floats per attribute, unit-length normals, part ids in the documented range, and a length close to `VEHICLE_LENGTH`.
- **Engine (`engine.test.ts`).** `setVehicle` while landed changes the drawn vehicle after the swap. While flying it is ignored. Takeoff and cancel reset it to the plane. A remote flight's `vehicle` reaches its parked vehicle, and a missing `vehicle` gives a plane.
- **Trip room.** `storedFlights` maps a leg's chosen offer to its mode, and a leg with no choice to `"flight"`.
- **Manual check.** On `/`, land HK to Shanghai, select a train row, a bus row, a ferry row and a flight row in turn, and watch the vehicle change. In a trip room with two browsers, choose a train offer on a leg and check the other browser shows a parked train.
