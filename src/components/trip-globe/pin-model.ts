// The map pin dropped where a trip's riders arrive: a small round head on a long, fine needle. Object space: z runs
// up the needle from its point at the origin, which the engine sinks a little into the ground. Parts: 0 head,
// 1 needle. Unlike the vehicles it's smooth-shaded, so the head reads as a bead rather than cut paper.
import { MeshBuilder, type VehicleMesh } from "./mesh";

/** Needle length, then the head's radius and centre, in vehicle units (the plane is 1 long). */
export const PIN_NEEDLE = 0.44;
export const PIN_HEAD_R = 0.1;
export const PIN_HEAD_Z = PIN_NEEDLE + PIN_HEAD_R * 0.7;

export function buildPin(): VehicleMesh {
  const b = new MeshBuilder();
  // the needle: a fine taper from its point up into the head
  b.tube(1, [[0.04, 0.004], [PIN_NEEDLE, 0.007]], 8, 0, 0, 0, [0, 0, 0], [0, 0, PIN_NEEDLE + 0.01]);
  const rings: [number, number][] = [];
  for (let k = 1; k < 12; k++) {
    const a = (Math.PI * k) / 12;
    rings.push([PIN_HEAD_Z - PIN_HEAD_R * Math.cos(a), PIN_HEAD_R * Math.sin(a)]);
  }
  b.tube(0, rings, 20, 0, 0, 0, [0, 0, PIN_HEAD_Z - PIN_HEAD_R], [0, 0, PIN_HEAD_Z + PIN_HEAD_R]);
  const m = b.build();
  // smooth shading: light by the smoothed normals instead of each facet's
  m.nrm.set(m.sm);
  return m;
}
