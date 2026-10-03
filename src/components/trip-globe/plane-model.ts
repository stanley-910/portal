// The plane mesh. Object space: x = right, y = up, z = nose. Length is about 1 (scaled by the engine).
// Part ids: 0 fuselage, 1 wing, 2 engine, 3 fin, 4 tailplane.
import { MeshBuilder, type VehicleMesh } from "./mesh";

export function buildPlane(): VehicleMesh {
  const b = new MeshBuilder();
  // fuselage
  b.tube(
    0,
    [[0.46, 0.035], [0.41, 0.06], [0.33, 0.076], [0.2, 0.082], [-0.2, 0.082], [-0.36, 0.06], [-0.47, 0.03]],
    10,
    Math.PI / 10,
    0,
    0,
    [0, -0.005, 0.5],
    [0, 0.03, -0.5],
  );
  // wings (swept, slight dihedral), tailplane and engines
  for (const s of [1, -1]) {
    b.slab(1, [[0.06 * s, -0.01, 0.12], [0.48 * s, 0.02, -0.1], [0.48 * s, 0.02, -0.2], [0.06 * s, -0.01, -0.1]], [0, 0.022, 0]);
    b.slab(4, [[0.03 * s, 0.03, -0.33], [0.2 * s, 0.04, -0.44], [0.2 * s, 0.04, -0.5], [0.03 * s, 0.03, -0.46]], [0, 0.014, 0]);
    b.tube(2, [[0.07, 0.036], [-0.06, 0.03]], 6, Math.PI / 6, 0.22 * s, -0.045, [0.22 * s, -0.045, 0.08], [0.22 * s, -0.045, -0.075]);
  }
  // tail fin
  b.slab(3, [[0, 0.06, -0.28], [0, 0.25, -0.43], [0, 0.25, -0.49], [0, 0.06, -0.47]], [0.016, 0, 0]);
  return b.build();
}
