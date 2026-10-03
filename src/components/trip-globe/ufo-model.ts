// Pip's saucer, the pixel UFO (src/components/agent/pixel.ts) cut as a sticker like the vehicles: a lens hull with
// a ring of rim lights, and a dome with Pip in it, its eyes on the side it flies toward. Object space: x = right,
// y = up, z = nose; the origin is the middle of the rim. About 1 across, like the plane is 1 long.
// Parts: 0 hull (its underside and rim are painted by height), 1 dome, 2 antennae, 3 bobbles.
import { MeshBuilder, type VehicleMesh } from "./mesh";

/** Where the rim's light band runs, in object y. The shader paints the hull by these. */
export const UFO_RIM = { y0: -0.004, y1: 0.022 };
/** The dome's centre height and radius. */
export const UFO_DOME = { y: 0.06, r: 0.19 };

/** Swaps a tube's z axis (its length) for y, so it stands up. Normals swap the same way. */
function standUp(m: VehicleMesh, from: number) {
  for (const a of [m.pos, m.nrm, m.sm]) {
    for (let i = from * 3; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
  }
}

export function buildUfo(): VehicleMesh {
  const tubes = new MeshBuilder();
  // hull: a shallow lens, widest at the rim
  tubes.tube(
    0,
    [[-0.08, 0.16], [-0.04, 0.38], [UFO_RIM.y0, 0.5], [UFO_RIM.y1, 0.5], [0.055, 0.38], [0.075, 0.22]],
    20,
    0,
    0,
    0,
    [0, 0, -0.08],
    [0, 0, 0.075],
  );
  // dome: rings up a sphere from where it sits in the hull
  const rings: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * (Math.PI / 2);
    rings.push([UFO_DOME.y + UFO_DOME.r * Math.sin(a), UFO_DOME.r * Math.cos(a)]);
  }
  tubes.tube(1, rings, 16, 0, 0, 0, [0, 0, UFO_DOME.y], [0, 0, UFO_DOME.y + UFO_DOME.r]);
  const hull = tubes.build();
  standUp(hull, 0);

  const b = new MeshBuilder();
  // antennae: a thin stalk each side of the dome, a bobble on top
  for (const s of [1, -1]) {
    const x = 0.075 * s;
    b.slab(2, [[x - 0.012, 0.2, 0], [x + 0.012, 0.2, 0], [x + 0.012 + 0.02 * s, 0.31, 0], [x - 0.012 + 0.02 * s, 0.31, 0]], [0, 0, 0.022]);
    const bx = x + 0.02 * s;
    b.slab(3, [[bx - 0.028, 0.31, -0.028], [bx + 0.028, 0.31, -0.028], [bx + 0.028, 0.31, 0.028], [bx - 0.028, 0.31, 0.028]], [0, 0.05, 0]);
  }
  const extra = b.build();

  const join = (a: Float32Array, c: Float32Array) => {
    const out = new Float32Array(a.length + c.length);
    out.set(a);
    out.set(c, a.length);
    return out;
  };
  return {
    pos: join(hull.pos, extra.pos),
    nrm: join(hull.nrm, extra.nrm),
    sm: join(hull.sm, extra.sm),
    part: join(hull.part, extra.part),
    count: hull.count + extra.count,
  };
}
