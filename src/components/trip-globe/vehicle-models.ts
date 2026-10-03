// The ground vehicles a landed trip can park as, alongside the plane. Object space: x = right, y = up, z = nose.
// Each rests on y = -0.09: the engine lifts the origin 0.09 of the vehicle's scale off the ground.
import type { Mode } from "@/lib/transport/types";
import { MeshBuilder, type VehicleMesh } from "./mesh";
import { buildPlane } from "./plane-model";

export type Vehicle = Mode;

/** In the order the vehicle shader numbers them (`uVehicle`). */
export const VEHICLES: readonly Vehicle[] = ["flight", "train", "bus", "ferry"];

/** Nose to tail in object units, for spacing the tag under a vehicle. */
export const VEHICLE_LENGTH: Record<Vehicle, number> = { flight: 1, train: 1, bus: 1, ferry: 0.93 };

const FLOOR = -0.09;

/** A high-speed train: a power car with a long tapered nose, then one trailing car. Part 0: cars. */
export function buildTrain(): VehicleMesh {
  const b = new MeshBuilder();
  const car = { w: 0.065, wb: 0.06, y0: FLOOR, y1: 0.03 };
  const end = { w: 0.055, wb: 0.055, y0: FLOOR, y1: 0.02 };
  // power car
  b.loft(0, [
    { z: 0.02, ...end },
    { z: 0.05, ...car },
    { z: 0.26, ...car },
    { z: 0.4, w: 0.055, wb: 0.055, y0: FLOOR, y1: 0 },
    { z: 0.5, w: 0.02, wb: 0.03, y0: -0.08, y1: -0.06 },
  ]);
  // trailing car
  b.loft(0, [
    { z: -0.5, ...end },
    { z: -0.47, ...car },
    { z: -0.06, ...car },
    { z: -0.03, ...end },
  ]);
  return b.build();
}

/**
 * A coach: a long box on four wheels. Seen from above it must still read as a bus, so the windscreen rakes back
 * onto the roof, the wheels stand proud of the sides at the four corners, and the roof carries two vents and a
 * roundel trim along its edges.
 * Parts: 0 body, 2 wheels, 3 roof vents.
 */
export function buildBus(): VehicleMesh {
  const b = new MeshBuilder();
  const side = { w: 0.13, y0: -0.07, y1: 0.12 };
  b.loft(0, [
    { z: -0.5, w: 0.12, y0: -0.07, y1: 0.11 },
    { z: -0.47, ...side },
    { z: 0.38, ...side },
    // raked windscreen, then the bumper
    { z: 0.46, w: 0.125, y0: -0.07, y1: 0.05 },
    { z: 0.5, w: 0.12, y0: -0.07, y1: 0 },
  ]);
  for (const x of [0.15, -0.15]) {
    for (const zc of [0.32, -0.32]) {
      b.slab(2, [[x, FLOOR, zc - 0.07], [x, FLOOR, zc + 0.07], [x, -0.02, zc + 0.07], [x, -0.02, zc - 0.07]], [0.06, 0, 0]);
    }
  }
  for (const zc of [-0.18, 0.1]) {
    b.slab(3, [[-0.06, 0.1325, zc - 0.05], [0.06, 0.1325, zc - 0.05], [0.06, 0.1325, zc + 0.05], [-0.06, 0.1325, zc + 0.05]], [0, 0.025, 0]);
  }
  return b.build();
}

/** A ferry: a wedge hull, two stepped decks and a funnel. Parts: 0 hull, 1 decks, 2 funnel. */
export function buildFerry(): VehicleMesh {
  const b = new MeshBuilder();
  b.loft(0, [
    { z: -0.45, w: 0.14, wb: 0.1, y0: FLOOR, y1: 0 },
    { z: 0.15, w: 0.14, wb: 0.1, y0: FLOOR, y1: 0 },
    { z: 0.35, w: 0.1, wb: 0.05, y0: -0.085, y1: 0 },
    { z: 0.48, w: 0.015, wb: 0.01, y0: -0.06, y1: 0 },
  ]);
  b.loft(1, [{ z: -0.38, w: 0.11, y0: 0, y1: 0.07 }, { z: 0.12, w: 0.11, y0: 0, y1: 0.07 }]);
  b.loft(1, [{ z: -0.3, w: 0.08, y0: 0.07, y1: 0.13 }, { z: 0, w: 0.08, y0: 0.07, y1: 0.13 }]);
  b.slab(2, [[-0.03, 0.165, -0.22], [0.03, 0.165, -0.22], [0.03, 0.165, -0.14], [-0.03, 0.165, -0.14]], [0, 0.07, 0]);
  return b.build();
}

export function buildVehicle(v: Vehicle): VehicleMesh {
  return v === "train" ? buildTrain() : v === "bus" ? buildBus() : v === "ferry" ? buildFerry() : buildPlane();
}
