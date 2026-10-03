// Faceted sticker meshes built from convex parts. Object space: x = right, y = up, z = nose.
import { add, cross, dot, len, mul, norm, sub, type Vec3 } from "./vec";

export interface VehicleMesh {
  pos: Float32Array;
  nrm: Float32Array;
  /** Smoothed vertex normals, used to push out the ink outline hull. */
  sm: Float32Array;
  /** Part id per vertex. Each vehicle sets its own ids; the vehicle shader paints by them. */
  part: Float32Array;
  count: number;
}

/** One ring of a loft: `w` half-wide at the top (`y1`) and `wb` at the bottom (`y0`, default `w`), at `z`. */
export interface Station {
  z: number;
  w: number;
  wb?: number;
  y0: number;
  y1: number;
}

type Tri = [Vec3, Vec3, Vec3, Vec3];
interface Part {
  id: number;
  c: Vec3;
  tris: Tri[];
}

export class MeshBuilder {
  private parts: Part[] = [];

  // each part must be convex: its triangles are wound to face away from its centre
  private part(id: number, verts: Vec3[]) {
    const c = mul(verts.reduce<Vec3>((s, v) => add(s, v), [0, 0, 0]), 1 / verts.length);
    const p: Part = { id, c, tris: [] };
    this.parts.push(p);
    return p;
  }

  private tri(p: Part, a: Vec3, b: Vec3, c: Vec3) {
    let n = cross(sub(b, a), sub(c, a));
    const fc = mul(add(add(a, b), c), 1 / 3);
    if (dot(n, sub(fc, p.c)) < 0) {
      [b, c] = [c, b];
      n = mul(n, -1);
    }
    if (len(n) < 1e-9) return;
    p.tris.push([a, b, c, norm(n)]);
  }

  private quad(p: Part, a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    this.tri(p, a, b, c);
    this.tri(p, a, c, d);
  }

  /** A flat plate: the quad `cs`, thickened by `th` (half each side). */
  slab(id: number, cs: Vec3[], th: Vec3) {
    const h = mul(th, 0.5);
    const top = cs.map((v) => add(v, h));
    const bot = cs.map((v) => sub(v, h));
    const p = this.part(id, top.concat(bot));
    this.quad(p, top[0], top[1], top[2], top[3]);
    this.quad(p, bot[0], bot[1], bot[2], bot[3]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(p, top[i], top[j], bot[j], bot[i]);
    }
  }

  /** A round body along z: rings of radius r at each station, closed by a tip at each end. */
  tube(
    id: number,
    stations: [number, number][],
    sides: number,
    rot: number,
    cx: number,
    cy: number,
    tipA: Vec3,
    tipB: Vec3,
  ) {
    const rings = stations.map(([z, r]) => {
      const ring: Vec3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = rot + (k * 2 * Math.PI) / sides;
        ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.95, z]);
      }
      return ring;
    });
    const p = this.part(id, [...rings.flat(), tipA, tipB]);
    for (let s = 0; s < rings.length - 1; s++) {
      for (let k = 0; k < sides; k++) {
        const j = (k + 1) % sides;
        this.quad(p, rings[s][k], rings[s][j], rings[s + 1][j], rings[s + 1][k]);
      }
    }
    const first = rings[0];
    const last = rings[rings.length - 1];
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      this.tri(p, tipA, first[k], first[j]);
      this.tri(p, tipB, last[k], last[j]);
    }
  }

  /** A boxy body along z through four-cornered rings, capped flat at both ends. */
  loft(id: number, stations: Station[]) {
    const rings = stations.map(({ z, w, wb = w, y0, y1 }): Vec3[] => [[-w, y1, z], [w, y1, z], [wb, y0, z], [-wb, y0, z]]);
    const p = this.part(id, rings.flat());
    for (let s = 0; s < rings.length - 1; s++) {
      for (let k = 0; k < 4; k++) {
        const j = (k + 1) % 4;
        this.quad(p, rings[s][k], rings[s][j], rings[s + 1][j], rings[s + 1][k]);
      }
    }
    const first = rings[0];
    const last = rings[rings.length - 1];
    this.quad(p, first[0], first[1], first[2], first[3]);
    this.quad(p, last[0], last[1], last[2], last[3]);
  }

  build(): VehicleMesh {
    const P: number[] = [];
    const N: number[] = [];
    const Sm: number[] = [];
    const Pt: number[] = [];
    for (const p of this.parts) {
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
}
