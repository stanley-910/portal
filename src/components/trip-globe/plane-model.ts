// The paper plane mesh. Object space: x = right, y = up, z = nose. Length is about 1 (scaled by the engine).
import { add, cross, dot, len, mul, norm, sub, type Vec3 } from "./vec";

export interface PlaneMesh {
  pos: Float32Array;
  nrm: Float32Array;
  /** Smoothed vertex normals, used to push out the ink outline hull. */
  sm: Float32Array;
  /** Part id per vertex: 0 fuselage, 1 wing, 2 engine, 3 fin, 4 tailplane. */
  part: Float32Array;
  count: number;
}

type Tri = [Vec3, Vec3, Vec3, Vec3];
interface Part {
  id: number;
  c: Vec3;
  tris: Tri[];
}

export function buildPlane(): PlaneMesh {
  const P: number[] = [];
  const N: number[] = [];
  const Sm: number[] = [];
  const Pt: number[] = [];
  const parts: Part[] = [];

  const mk = (id: number, verts: Vec3[]) => {
    const c = mul(verts.reduce<Vec3>((s, v) => add(s, v), [0, 0, 0]), 1 / verts.length);
    const p: Part = { id, c, tris: [] };
    parts.push(p);
    return p;
  };
  // winds each triangle so its normal points away from the part's centre
  const tri = (p: Part, a: Vec3, b: Vec3, c: Vec3) => {
    let n = cross(sub(b, a), sub(c, a));
    const fc = mul(add(add(a, b), c), 1 / 3);
    if (dot(n, sub(fc, p.c)) < 0) {
      [b, c] = [c, b];
      n = mul(n, -1);
    }
    if (len(n) < 1e-9) return;
    p.tris.push([a, b, c, norm(n)]);
  };
  const quad = (p: Part, a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    tri(p, a, b, c);
    tri(p, a, c, d);
  };
  const slab = (id: number, cs: Vec3[], th: Vec3) => {
    const h = mul(th, 0.5);
    const top = cs.map((v) => add(v, h));
    const bot = cs.map((v) => sub(v, h));
    const p = mk(id, top.concat(bot));
    quad(p, top[0], top[1], top[2], top[3]);
    quad(p, bot[0], bot[1], bot[2], bot[3]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(p, top[i], top[j], bot[j], bot[i]);
    }
  };
  const tube = (
    id: number,
    stations: [number, number][],
    sides: number,
    rot: number,
    cx: number,
    cy: number,
    tipA: Vec3,
    tipB: Vec3,
  ) => {
    const rings = stations.map(([z, r]) => {
      const ring: Vec3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = rot + (k * 2 * Math.PI) / sides;
        ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.95, z]);
      }
      return ring;
    });
    const p = mk(id, [...rings.flat(), tipA, tipB]);
    for (let s = 0; s < rings.length - 1; s++) {
      for (let k = 0; k < sides; k++) {
        const j = (k + 1) % sides;
        quad(p, rings[s][k], rings[s][j], rings[s + 1][j], rings[s + 1][k]);
      }
    }
    const first = rings[0];
    const last = rings[rings.length - 1];
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      tri(p, tipA, first[k], first[j]);
      tri(p, tipB, last[k], last[j]);
    }
  };

  // fuselage
  tube(
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
    slab(1, [[0.06 * s, -0.01, 0.12], [0.48 * s, 0.02, -0.1], [0.48 * s, 0.02, -0.2], [0.06 * s, -0.01, -0.1]], [0, 0.022, 0]);
    slab(4, [[0.03 * s, 0.03, -0.33], [0.2 * s, 0.04, -0.44], [0.2 * s, 0.04, -0.5], [0.03 * s, 0.03, -0.46]], [0, 0.014, 0]);
    tube(2, [[0.07, 0.036], [-0.06, 0.03]], 6, Math.PI / 6, 0.22 * s, -0.045, [0.22 * s, -0.045, 0.08], [0.22 * s, -0.045, -0.075]);
  }
  // tail fin
  slab(3, [[0, 0.06, -0.28], [0, 0.25, -0.43], [0, 0.25, -0.49], [0, 0.06, -0.47]], [0.016, 0, 0]);

  for (const p of parts) {
    const acc = new Map<string, Vec3>();
    const key = (v: Vec3) => v.map((x) => x.toFixed(4)).join(",");
    for (const [a, b, c, n] of p.tris) for (const v of [a, b, c]) acc.set(key(v), add(acc.get(key(v)) ?? [0, 0, 0], n));
    for (const [a, b, c, n] of p.tris) {
      for (const v of [a, b, c]) {
        P.push(v[0], v[1], v[2]);
        N.push(n[0], n[1], n[2]);
        const sm = norm(acc.get(key(v))!);
        Sm.push(sm[0], sm[1], sm[2]);
        Pt.push(p.id);
      }
    }
  }
  return {
    pos: new Float32Array(P),
    nrm: new Float32Array(N),
    sm: new Float32Array(Sm),
    part: new Float32Array(Pt),
    count: Pt.length,
  };
}
