// The ground vehicles a landed trip can park as, alongside the plane. Object space: x = right, y = up, z = nose.
// Each rests on y = -0.09: the engine lifts the origin 0.09 of the vehicle's scale off the ground.
import type { Mode } from "@/lib/transport/types";
import { MeshBuilder, type VehicleMesh } from "./mesh";
import { buildPlane } from "./plane-model";

export type Vehicle = Mode;

/** In the order the vehicle shader numbers them (`uVehicle`). */
export const VEHICLES: readonly Vehicle[] = ["flight", "train", "bus", "ferry"];

/** Nose to tail in object units, for spacing the tag under a vehicle. */
export const VEHICLE_LENGTH: Record<Vehicle, number> = { flight: 1, train: 1, bus: 0.8, ferry: 0.93 };

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

/** A coach: a rounded box on four wheels. Parts: 0 body, 2 wheels. */
export function buildBus(): VehicleMesh {
  const b = new MeshBuilder();
  const side = { w: 0.11, y0: -0.07, y1: 0.12 };
  b.loft(0, [
    { z: -0.4, w: 0.1, y0: -0.07, y1: 0.11 },
    { z: -0.38, ...side },
    { z: 0.36, ...side },
    { z: 0.4, w: 0.1, y0: -0.07, y1: 0.1 },
  ]);
  for (const x of [0.105, -0.105]) {
    for (const zc of [0.26, -0.26]) {
      b.slab(2, [[x, FLOOR, zc - 0.05], [x, FLOOR, zc + 0.05], [x, -0.04, zc + 0.05], [x, -0.04, zc - 0.05]], [0.03, 0, 0]);
    }
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
