# Ground Vehicles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a trip lands, the vehicle parked on the globe matches the picked offer's mode: plane, train, bus or ferry. This works on the home globe and on stored trip legs.

**Architecture:** The plane's procedural mesh helpers move into a shared `MeshBuilder`, and three new builders make the train, bus and ferry. The engine keeps one VAO per vehicle. Each drawn `Plane` carries `vehicle`, `next` and `swap`, which drive a 0.25s shrink-and-grow pop. The plane shader paints each vehicle's parts, selected by a `uVehicle` uniform. React wiring feeds the mode in: the ticket card's selected row on `/`, and each stored leg's chosen offer in `/t/<id>`.

**Tech Stack:** TypeScript, WebGL2 (hand-written GLSL in `shaders.ts`), React 19 / Next.js, Liveblocks storage, Vitest (`environment: "node"`).

**Spec:** `docs/superpowers/specs/2026-10-03-ground-vehicles-design.md`

## Global Constraints

- Work and commit in `.worktrees/dev` on `dev/ahmet`. Never push without asking.
- Before running pnpm, put Node 24 first on the PATH: `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.
- UI colours come from tokens only. Vehicles use `sticker-fill`, `sticker-ink` and `roundel`, through `th.stickerGL` (already wired). No new colours.
- While flying, the vehicle is always the plane. Only a landed trip changes vehicle.
- With no picked offer, an unfinished search, or an empty result, the vehicle is the plane.
- Pop length: `SWAP = 0.25` seconds. Under reduced motion the swap is instant.
- Presence (`FlightState`) doesn't change. `RemoteFlight` gains an optional `vehicle`.
- Every vehicle mesh: object space x = right, y = up, z = nose. The bottom sits at y = -0.09 (the engine raises the origin `0.09 * S` off the ground). Length is set by `VEHICLE_LENGTH`.
- The plane mesh must come out byte-for-byte the same after the refactor (fingerprint test in Task 1).
- Match the surrounding code: short lowercase comments, no JSDoc on private helpers, the same idioms as `engine.ts`.
- Test command: `pnpm test` (vitest run). Lint: `pnpm lint`. Types: `pnpm exec tsc --noEmit`.

---

### Task 1: Shared mesh builder

**Files:**
- Create: `src/components/trip-globe/mesh.ts`
- Modify: `src/components/trip-globe/plane-model.ts` (whole file)
- Test: `src/components/trip-globe/plane-model.test.ts` (new)

**Interfaces:**
- Produces:
  - `interface VehicleMesh { pos: Float32Array; nrm: Float32Array; sm: Float32Array; part: Float32Array; count: number }`
  - `interface Station { z: number; w: number; wb?: number; y0: number; y1: number }`
  - `class MeshBuilder` with `slab(id: number, cs: Vec3[], th: Vec3): void`, `tube(id, stations: [number, number][], sides, rot, cx, cy, tipA: Vec3, tipB: Vec3): void`, `loft(id: number, stations: Station[]): void` and `build(): VehicleMesh`
  - `buildPlane(): VehicleMesh` (unchanged output)

- [ ] **Step 1: Write the fingerprint test (it passes against today's code)**

`src/components/trip-globe/plane-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPlane } from "./plane-model";

// weighted sums of every attribute, taken from the mesh before it moved onto MeshBuilder
const fingerprint = (a: Float32Array) => {
  let x = 0;
  for (let i = 0; i < a.length; i++) x += a[i] * ((i % 7) + 1);
  return x.toFixed(4);
};

describe("buildPlane", () => {
  it("builds the same mesh as before the shared builder", () => {
    const m = buildPlane();
    expect([m.count, fingerprint(m.pos), fingerprint(m.nrm), fingerprint(m.sm), fingerprint(m.part)])
      .toEqual([744, "-110.3174", "84.2387", "80.9735", "3014.0000"]);
  });
});
```

- [ ] **Step 2: Run it against the current code**

Run: `pnpm exec vitest run src/components/trip-globe/plane-model.test.ts`
Expected: PASS. This pins today's output before anything moves.

- [ ] **Step 3: Create `mesh.ts`**

```ts
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
```

- [ ] **Step 4: Rewrite `plane-model.ts` on top of it**

Replace the whole file with:

```ts
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
```

- [ ] **Step 5: Run the fingerprint test again**

Run: `pnpm exec vitest run src/components/trip-globe/plane-model.test.ts`
Expected: PASS with the same numbers. If it fails, the refactor changed the order of parts or a helper. Fix it; do not update the expected numbers.

- [ ] **Step 6: Type check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

```bash
git add src/components/trip-globe/mesh.ts src/components/trip-globe/plane-model.ts src/components/trip-globe/plane-model.test.ts
git commit -m "refactor(globe): move the plane's mesh helpers into a shared MeshBuilder"
```

---

### Task 2: Train, bus and ferry meshes

**Files:**
- Create: `src/components/trip-globe/vehicle-models.ts`
- Test: `src/components/trip-globe/vehicle-models.test.ts` (new)

**Interfaces:**
- Consumes: `MeshBuilder`, `VehicleMesh` from `./mesh` (Task 1); `buildPlane` from `./plane-model`.
- Produces:
  - `type Vehicle = Mode` (re-exported `Mode` from `@/lib/transport/types`: `"flight" | "train" | "bus" | "ferry"`)
  - `const VEHICLES: readonly Vehicle[] = ["flight", "train", "bus", "ferry"]`. The index is the shader's `uVehicle` value.
  - `const VEHICLE_LENGTH: Record<Vehicle, number>`: flight 1, train 1, bus 0.8, ferry 0.93
  - `buildTrain()`, `buildBus()`, `buildFerry()`: each returns a `VehicleMesh`
  - `buildVehicle(v: Vehicle): VehicleMesh`
  - Part ids: train 0 = cars; bus 0 = body, 2 = wheels; ferry 0 = hull, 1 = decks, 2 = funnel.

- [ ] **Step 1: Write the failing tests**

`src/components/trip-globe/vehicle-models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildVehicle, VEHICLE_LENGTH, VEHICLES } from "./vehicle-models";

const PARTS = { flight: [0, 1, 2, 3, 4], train: [0], bus: [0, 2], ferry: [0, 1, 2] } as const;

describe.each(VEHICLES)("%s mesh", (v) => {
  const m = buildVehicle(v);

  it("has whole triangles and one value per vertex in each attribute", () => {
    expect(m.count).toBeGreaterThan(0);
    expect(m.count % 3).toBe(0);
    expect(m.pos.length).toBe(m.count * 3);
    expect(m.nrm.length).toBe(m.count * 3);
    expect(m.sm.length).toBe(m.count * 3);
    expect(m.part.length).toBe(m.count);
  });

  it("has unit normals", () => {
    for (const a of [m.nrm, m.sm]) {
      for (let i = 0; i < m.count; i++) {
        expect(Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])).toBeCloseTo(1, 4);
      }
    }
  });

  it("uses only its documented part ids", () => {
    expect([...new Set(m.part)].sort()).toEqual([...PARTS[v]]);
  });

  it("is as long as VEHICLE_LENGTH says, nose along +z", () => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.count; i++) {
      lo = Math.min(lo, m.pos[i * 3 + 2]);
      hi = Math.max(hi, m.pos[i * 3 + 2]);
    }
    expect(hi - lo).toBeCloseTo(VEHICLE_LENGTH[v], 1);
    expect(hi).toBeGreaterThan(-lo - 0.1);
  });
});

describe.each(["train", "bus", "ferry"] as const)("%s on the ground", (v) => {
  it("rests its lowest point at y = -0.09", () => {
    const m = buildVehicle(v);
    let lo = Infinity;
    for (let i = 0; i < m.count; i++) lo = Math.min(lo, m.pos[i * 3 + 1]);
    expect(lo).toBeCloseTo(-0.09, 4);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run src/components/trip-globe/vehicle-models.test.ts`
Expected: FAIL with "Failed to resolve import "./vehicle-models"".

- [ ] **Step 3: Create `vehicle-models.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/components/trip-globe/vehicle-models.test.ts`
Expected: PASS. Lengths come to train 1.00, bus 0.80, ferry 0.93 and plane 1.00, all within 0.05 (`toBeCloseTo(…, 1)`).

- [ ] **Step 5: Commit**

```bash
git add src/components/trip-globe/vehicle-models.ts src/components/trip-globe/vehicle-models.test.ts
git commit -m "feat(globe): train, bus and ferry meshes"
```

---

### Task 3: Engine draws and swaps vehicles

**Files:**
- Modify: `src/components/trip-globe/engine.ts`. Imports (lines 9-10). `RemoteFlight` (~line 49). Constants (~line 66). `Plane` (~line 92). Fields `vaoPlane` and `planeCount` (~lines 189-190). `start()` mesh upload (~lines 342-350). `takeoff()` (~line 664). New `setVehicle()` after `flight()` (~line 919). `setRemoteFlights()` (~lines 921-947). `sim()` (~line 994). `sceneChanged()` (~line 1077). `underPlane()` (~line 1145). The plane draw loop in `drawGL()` (~lines 1286-1316).
- Modify: `src/components/trip-globe/shaders.ts` (`FS_PLANE`, ~line 259)
- Modify: `src/components/trip-globe/trip-globe.tsx` (`TripGlobeHandle`, `useImperativeHandle`)
- Modify: `src/components/trip-globe/index.ts`
- Test: `src/components/trip-globe/engine.test.ts`

**Interfaces:**
- Consumes: `VEHICLES`, `VEHICLE_LENGTH`, `buildVehicle`, `type Vehicle` from `./vehicle-models` (Task 2).
- Produces:
  - `GlobeEngine.setVehicle(v: Vehicle): void`. Ignored unless landed.
  - `RemoteFlight.vehicle?: Vehicle`. Used only when `landed`; defaults to `"flight"`.
  - `TripGlobeHandle.setVehicle(v: Vehicle): void`
  - `index.ts` exports `type Vehicle`.

- [ ] **Step 1: Write the failing engine tests**

Append to `src/components/trip-globe/engine.test.ts`. `setup()` and `point()` already exist in the file:

```ts
describe("vehicles", () => {
  type Drawn = { vehicle: string; next: string; swap: number };
  const own = (engine: unknown) => (engine as { pl: Drawn | null }).pl;
  const remote = (engine: unknown, id: string) => (engine as { remotes: Map<string, { pl: Drawn }> }).remotes.get(id)!.pl;

  it("parks the picked vehicle once landed, keeps the plane in the air, and resets on takeoff", () => {
    const { engine, frames } = setup();
    engine["takeoff"](point(22.3, 114.17));
    engine.setVehicle("train");
    frames(1);
    expect(own(engine)!.vehicle).toBe("flight");
    engine["land"](point(31.23, 121.47));
    engine.setVehicle("train");
    frames(1);
    expect(own(engine)!.vehicle).toBe("train");
    engine.setVehicle("flight");
    frames(1);
    expect(own(engine)!.vehicle).toBe("flight");
    engine.setVehicle("ferry");
    engine.cancel();
    engine["takeoff"](point(22.3, 114.17));
    expect(own(engine)!.vehicle).toBe("flight");
  });

  it("pops between vehicles over a quarter second, redrawing as it goes", () => {
    const { engine, state, frames, drawGL } = setup();
    state.reduceMotion = false;
    engine["takeoff"](point(22.3, 114.17));
    engine["land"](point(31.23, 121.47));
    frames(120);
    drawGL.mockClear();
    engine.setVehicle("bus");
    frames(3);
    expect(own(engine)!.vehicle).toBe("flight");
    expect(own(engine)!.swap).toBeGreaterThan(0);
    frames(17);
    expect(own(engine)!.vehicle).toBe("bus");
    expect(own(engine)!.swap).toBe(0);
    expect(drawGL.mock.calls.length).toBeGreaterThanOrEqual(15);
  });

  it("turns back mid-pop without jumping to full size", () => {
    const { engine, state, frames } = setup();
    state.reduceMotion = false;
    engine["takeoff"](point(22.3, 114.17));
    engine["land"](point(31.23, 121.47));
    engine.setVehicle("train");
    frames(10);
    const before = own(engine)!.swap;
    expect(before).toBeGreaterThan(0.5);
    engine.setVehicle("bus");
    expect(own(engine)!.swap).toBeCloseTo(1 - before);
    frames(30);
    expect(own(engine)!.vehicle).toBe("bus");
  });

  it("parks other members' landed trips as their vehicle, planes otherwise", () => {
    const { engine, frames } = setup();
    const base = { origin: { lat: 22, lng: 114 }, at: { lat: 31, lng: 121 }, ahead: { lat: 31.1, lng: 121.1 } };
    engine.setRemoteFlights([
      { id: "a", ...base, landed: true, vehicle: "ferry" },
      { id: "b", ...base, landed: true },
      { id: "c", ...base, landed: false, vehicle: "train" },
    ]);
    frames(1);
    expect(remote(engine, "a").vehicle).toBe("ferry");
    expect(remote(engine, "b").vehicle).toBe("flight");
    expect(remote(engine, "c").vehicle).toBe("flight");
    engine.setRemoteFlights([{ id: "a", ...base, landed: true, vehicle: "train" }]);
    frames(1);
    expect(remote(engine, "a").vehicle).toBe("train");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run src/components/trip-globe/engine.test.ts -t vehicles`
Expected: FAIL. TypeScript-unaware vitest reports "engine.setVehicle is not a function".

- [ ] **Step 3: Engine types, constants and imports**

In `engine.ts`, replace the line `import { buildPlane } from "./plane-model";` with:

```ts
import { buildVehicle, VEHICLE_LENGTH, VEHICLES, type Vehicle } from "./vehicle-models";
```

Change `RemoteFlight` to:

```ts
/** Another member's flight. `id` is stable while they stay in the room. */
export interface RemoteFlight extends FlightState {
  id: string;
  /** What a landed trip parks as. Leave it out for the plane. Ignored in the air. */
  vehicle?: Vehicle;
}
```

Below `const S_PLANE = 0.085; …`, add:

```ts
const SWAP = 0.25; // seconds for one vehicle to shrink away and the next to grow in
```

Change `interface Plane` to:

```ts
interface Plane {
  n: Vec3;
  f: Vec3;
  alt: number;
  bank: number;
  pitch: number;
  /** What's drawn, what it's turning into, and how far through that pop it is (0 to 1; 0.5 is the vanishing point). */
  vehicle: Vehicle;
  next: Vehicle;
  swap: number;
}
```

Below `interface Plane`, add these two module-level helpers:

```ts
const parked = (v: Vehicle): Pick<Plane, "vehicle" | "next" | "swap"> => ({ vehicle: v, next: v, swap: 0 });

// a change mid-pop that is already growing back turns it round at the same size, so it never jumps
function retarget(pl: Plane, v: Vehicle) {
  if (v === pl.next) return;
  pl.next = v;
  if (pl.swap > 0.5) pl.swap = 1 - pl.swap;
}
```

- [ ] **Step 4: One VAO per vehicle**

Replace the fields

```ts
  private vaoPlane: WebGLVertexArrayObject | null = null;
  private planeCount = 0;
```

with

```ts
  private vaoVehicle = new Map<Vehicle, { vao: WebGLVertexArrayObject; count: number }>();
```

In `start()`, replace the block from `const m = buildPlane();` through its `gl.bindVertexArray(null);` with:

```ts
    for (const v of VEHICLES) {
      const m = buildVehicle(v);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.attrib(gl, 0, m.pos, 3);
      this.attrib(gl, 1, m.nrm, 3);
      this.attrib(gl, 2, m.sm, 3);
      this.attrib(gl, 3, m.part, 1);
      this.vaoVehicle.set(v, { vao, count: m.count });
    }
    gl.bindVertexArray(null);
```

- [ ] **Step 5: Vehicle state through takeoff, `setVehicle` and remotes**

In `takeoff()`, change the `this.pl = …` line to:

```ts
    this.pl = { n: o, f: tangent(cam.U, o), alt: 0, bank: 0, pitch: 0, ...parked("flight") };
```

Directly after the `flight()` method, add:

```ts
  /** What this viewer's landed trip parks as: the mode of the offer they picked. Ignored unless landed. */
  setVehicle(v: Vehicle) {
    if (this.mode === "landed" && this.pl) retarget(this.pl, v);
  }
```

In `setRemoteFlights`, inside the `for (const f of flights)` loop, add as the first line:

```ts
      const vehicle = f.landed ? f.vehicle ?? "flight" : "flight";
```

Then change the update and create branches at the end of the loop body to:

```ts
      if (r) {
        Object.assign(r, { o, target, ft, landed: f.landed, originHub, destinationHub, originName, destinationName });
        retarget(r.pl, vehicle);
      } else this.remotes.set(f.id, {
        o, target, ft, landed: f.landed, originHub, destinationHub, originName, destinationName,
        pl: { n: target, f: ft, alt: 0, bank: 0, pitch: 0, ...parked(vehicle) },
      });
```

- [ ] **Step 6: Advance pops in `sim()` and count them as scene changes**

Add a private method next to `planeBasis`:

```ts
  private stepSwap(pl: Plane, dt: number) {
    if (pl.vehicle === pl.next && pl.swap === 0) return;
    if (this.reduceMotion) {
      Object.assign(pl, parked(pl.next));
      return;
    }
    pl.swap = Math.min(1, pl.swap + dt / SWAP);
    if (pl.swap >= 0.5) pl.vehicle = pl.next;
    if (pl.swap >= 1) pl.swap = 0;
  }
```

In `sim()`, in the `for (const r of this.remotes.values())` loop, add after the `pl.alt += …` line:

```ts
      this.stepSwap(pl, dt);
```

In `sim()`, right after `const pl = this.pl;` and `if (!pl || this.mode === "idle") return;`, add:

```ts
    this.stepSwap(pl, dt);
```

In `sceneChanged()`, change the `plane` lambda to:

```ts
    const plane = (pl: Plane) => state.push(...pl.n, ...pl.f, pl.alt, pl.bank, pl.pitch, VEHICLES.indexOf(pl.vehicle), pl.swap);
```

- [ ] **Step 7: Draw each vehicle, sized by its pop**

In `drawGL()`, in the plane section, delete the line `gl.bindVertexArray(this.vaoPlane);`. Then replace the whole `for (const { pl, pp } of shown) { … }` loop with:

```ts
    for (const { pl, pp } of shown) {
      const mesh = this.vaoVehicle.get(pl.vehicle);
      const s = S * (1 - Math.sin(Math.PI * pl.swap));
      if (!mesh || s < 1e-4) continue;
      const B = this.planeBasis(pl, s);
      gl.bindVertexArray(mesh.vao);
      gl.uniform1i(u.uVehicle, VEHICLES.indexOf(pl.vehicle));
      gl.uniform3fv(u.uPP, pp);
      gl.uniform3fv(u.uPX, B.X);
      gl.uniform3fv(u.uPY, B.Y);
      gl.uniform3fv(u.uPZ, B.Z);
      // each vehicle is its own sticker: a later one covers an earlier one wholly
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // 1: the ink outline, which also draws inner edges
      gl.uniform1f(u.uMode, 2);
      gl.uniform1f(u.uHull, 1.1 * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      // 2: the paper body
      gl.uniform1f(u.uMode, 0);
      gl.uniform1f(u.uHull, 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
```

In `underPlane()`, change the `nose` line so the tag clears a vehicle of any length:

```ts
    const nose = this.proj(mul(norm(add(pl.n, mul(pl.f, S_PLANE * this.planeScale * VEHICLE_LENGTH[pl.vehicle] * 0.5))), 1 + pl.alt));
```

- [ ] **Step 8: Paint each vehicle in `FS_PLANE`**

In `shaders.ts`, in `FS_PLANE`, add `uniform int uVehicle;` after `uniform vec3 uRoundel;`. Then replace the block from `vec3 base = uFill;` through the closing `}` of `if (part == 0) { … }` with:

```glsl
  vec3 base = uFill;
  int part = int(vPart + 0.5);
  vec3 o = vObj;
  if (uVehicle == 0) {
    // plane
    if (part == 3) base = uRoundel;
    if (part == 1 && o.y > 0.0 && length(vec2(abs(o.x) - 0.33, o.z + 0.09)) < 0.042) base = uRoundel;
    if (part == 0) {
      if (abs(o.x) > 0.045 && o.y > 0.005 && o.y < 0.04 && o.z > -0.26 && o.z < 0.3 && fract(o.z * 26.0) < 0.4) base = uInkS;
      if (o.z > 0.36 && o.y > 0.015) base = mix(base, uInkS, 0.85);
    }
  } else if (uVehicle == 1) {
    // train: window band and a roundel stripe down each side, a dark windscreen on the nose
    bool side = abs(o.x) > 0.05;
    if (side && o.y > -0.015 && o.y < 0.01 && o.z < 0.3 && fract(o.z * 30.0) < 0.6) base = uInkS;
    if (side && o.y > -0.06 && o.y < -0.045) base = uRoundel;
    if (o.z > 0.38 && o.y > -0.035) base = mix(base, uInkS, 0.85);
  } else if (uVehicle == 2) {
    // bus: window band and a roundel stripe down each side, windscreen in front, ink wheels
    bool side = abs(o.x) > 0.1;
    if (part == 2) base = uInkS;
    else {
      if (side && o.y > 0.03 && o.y < 0.09 && o.z > -0.33 && o.z < 0.3 && fract(o.z * 12.0) < 0.8) base = uInkS;
      if (side && o.y > -0.03 && o.y < -0.005) base = uRoundel;
      if (o.z > 0.39 && o.y > 0.0) base = mix(base, uInkS, 0.85);
    }
  } else {
    // ferry: a roundel funnel, a row of windows along each deck
    if (part == 2) base = uRoundel;
    if (part == 1) {
      bool lower = o.y < 0.07;
      float w = lower ? 0.105 : 0.075;
      float y = lower ? 0.035 : 0.1;
      if (abs(o.x) > w && abs(o.y - y) < 0.012 && fract(o.z * 25.0) < 0.5) base = uInkS;
    }
  }
```

Leave the shading lines after the block (`float dif = …` through `outColor`) unchanged.

- [ ] **Step 9: Expose it on `TripGlobe`**

In `trip-globe.tsx`, add `type Vehicle` to the import from `./engine` (or `./vehicle-models`). In `TripGlobeHandle`, add:

```ts
  /** What your landed trip parks as: the mode of the offer you picked. Ignored while flying. */
  setVehicle(v: Vehicle): void;
```

In the `useImperativeHandle` object, add next to `setRemoteFlights`:

```ts
      setVehicle: (v) => engineRef.current?.setVehicle(v),
```

In `index.ts`, add:

```ts
export type { Vehicle } from "./vehicle-models";
```

- [ ] **Step 10: Run tests, types and lint**

Run: `pnpm exec vitest run src/components/trip-globe && pnpm exec tsc --noEmit && pnpm lint`
Expected: all pass. The existing test "redraws when remote trips arrive, move, land or leave" still expects exactly 4 redraws. It sends no `vehicle`, so no pop starts.

- [ ] **Step 11: Commit**

```bash
git add src/components/trip-globe
git commit -m "feat(globe): park landed trips as the picked vehicle with a quick pop"
```

---

### Task 4: Home globe follows the selected ticket row

**Files:**
- Modify: `src/components/ticket-search/ticket-search.tsx` (`TicketSearchProps` ~line 130, component body after `const choice = …` ~line 186)
- Modify: `src/app/globe-screen.tsx` (the `<TicketSearch>` element ~line 82)

**Interfaces:**
- Consumes: `TripGlobeHandle.setVehicle(v: Vehicle)` (Task 3).
- Produces: `TicketSearchProps.onChoiceMode?: (mode: Mode | null) => void`. It fires on mount and whenever the selected row's mode changes, with null when no row is selected.

No unit test: ticket-search has no component test harness (vitest runs in `node`). This is covered by the manual check in Task 6.

- [ ] **Step 1: Add the prop**

In `ticket-search.tsx`, change the import `import type { Offer } from "@/lib/transport/types";` to:

```ts
import type { Mode, Offer } from "@/lib/transport/types";
```

In `TicketSearchProps`, after `onDismiss`, add:

```ts
  /** The selected row's mode, or null with nothing selected: the globe parks the landed trip as that vehicle. */
  onChoiceMode?: (mode: Mode | null) => void;
```

Add `onChoiceMode` to the destructured props in the `TicketSearch` signature.

- [ ] **Step 2: Report the mode when it changes**

Directly after the line `const choice = rows[Math.min(selected, rows.length - 1)];`, add:

```ts
  // the latest callback without re-firing when only its identity changes
  const choiceMode = useRef(onChoiceMode);
  useLayoutEffect(() => {
    choiceMode.current = onChoiceMode;
  });
  const mode = choice?.offer.mode ?? null;
  useEffect(() => choiceMode.current?.(mode), [mode]);
```

(`useRef`, `useLayoutEffect` and `useEffect` are already imported.)

- [ ] **Step 3: Drive the globe from `GlobeScreen`**

In `globe-screen.tsx`, on the `<TicketSearch …>` element, add after `onDismiss`:

```tsx
        onChoiceMode={(mode) => globe.current?.setVehicle(mode ?? "flight")}
```

- [ ] **Step 4: Types and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ticket-search/ticket-search.tsx src/app/globe-screen.tsx
git commit -m "feat(globe): the home globe parks the selected ticket's vehicle"
```

---

### Task 5: Trip room parks each leg's chosen vehicle

**Files:**
- Create: `src/components/multiplayer/stored-flights.ts`
- Test: `src/components/multiplayer/stored-flights.test.ts` (new)
- Modify: `src/components/multiplayer/remote-planes.tsx` (drop the local `Plan` type and `storedFlights`, import them)
- Modify: `src/app/t/[id]/trip-room.tsx`

**Interfaces:**
- Consumes: `RemoteFlight.vehicle?: Vehicle` and `TripGlobeHandle.setVehicle` (Task 3); `usePlanLegs()` from `@/lib/trip/plan`, which returns `PlanLeg[] | null` with `chosen: StoredOffer | null`.
- Produces:
  - `type StoredPlan`: the read-only storage shape `storedFlights` reads.
  - `storedFlights(root: StoredPlan): RemoteFlight[]`, now with `vehicle`.

- [ ] **Step 1: Write the failing test**

`src/components/multiplayer/stored-flights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { storedFlights, type StoredPlan } from "./stored-flights";

const offer = (id: string, mode: "flight" | "train" | "bus" | "ferry") => ({ id, mode });
const plan = (chosen: string | null): StoredPlan => ({
  stops: { a: { lat: 22.3, lng: 114.17 }, b: { lat: 31.23, lng: 121.47 } },
  legs: {
    l1: { from: "a", to: "b", chosen, search: { offers: [offer("o1", "flight"), offer("o2", "train")] } },
  },
});

describe("storedFlights", () => {
  it("parks each leg as its chosen offer's vehicle", () => {
    expect(storedFlights(plan("o2"))).toEqual([
      expect.objectContaining({ id: "leg:l1", landed: true, vehicle: "train", at: { lat: 31.23, lng: 121.47 } }),
    ]);
  });

  it("parks a plane when nothing is chosen or the choice is gone", () => {
    expect(storedFlights(plan(null))[0].vehicle).toBe("flight");
    expect(storedFlights(plan("missing"))[0].vehicle).toBe("flight");
  });

  it("skips legs whose stops are missing", () => {
    expect(storedFlights({ ...plan(null), stops: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm exec vitest run src/components/multiplayer/stored-flights.test.ts`
Expected: FAIL with "Failed to resolve import "./stored-flights"".

- [ ] **Step 3: Create `stored-flights.ts`**

```ts
import type { LatLng, RemoteFlight, Vehicle } from "@/components/trip-globe";

/** The parts of trip storage a parked leg needs. */
export type StoredPlan = {
  readonly legs: {
    readonly [id: string]: {
      readonly from: string;
      readonly to: string;
      readonly chosen: string | null;
      readonly search: { readonly offers: readonly { readonly id: string; readonly mode: Vehicle }[] };
    };
  };
  readonly stops: { readonly [id: string]: LatLng };
};

/** Each stored leg as a landed trip: parked at its end as its chosen offer's vehicle, facing along the route. */
export function storedFlights(root: StoredPlan): RemoteFlight[] {
  const flights: RemoteFlight[] = [];
  for (const [id, leg] of Object.entries(root.legs)) {
    const from = root.stops[leg.from];
    const to = root.stops[leg.to];
    if (!from || !to) continue;
    const o = { lat: from.lat, lng: from.lng };
    const at = { lat: to.lat, lng: to.lng };
    // a hair past the end gives the heading; near enough on a great circle for a parked vehicle
    const ahead = { lat: at.lat + (at.lat - o.lat) * 0.01, lng: at.lng + (at.lng - o.lng) * 0.01 };
    const vehicle = leg.search.offers.find((offer) => offer.id === leg.chosen)?.mode ?? "flight";
    flights.push({ id: `leg:${id}`, origin: o, at, ahead, landed: true, vehicle });
  }
  return flights;
}
```

- [ ] **Step 4: Use it from `remote-planes.tsx`**

In `remote-planes.tsx`, delete the local `type Plan = { … }` and the `function storedFlights(…) { … }` at the bottom of the file. Add this import:

```ts
import { storedFlights } from "./stored-flights";
```

Change the component's top doc comment line "Everyone else's trips on the globe and every stored leg" to "Everyone else's trips on the globe and every stored leg, parked as its chosen vehicle".

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run src/components/multiplayer/stored-flights.test.ts`
Expected: PASS.

- [ ] **Step 6: Park your own landed leg as its chosen vehicle**

In `trip-room.tsx`, change the React import to `import { useEffect, useRef, useState } from "react";`. Change the plan import to:

```ts
import { initialTripStorage, usePlanActions, usePlanLegs, usePlanReady, useRecordMember } from "@/lib/trip/plan";
```

In `TripScreen`, after the `landedLeg` state line, add:

```ts
  // your own vehicle is still standing in for that leg, so it parks as the leg's chosen offer
  const legs = usePlanLegs();
  const landedMode = legs?.find((leg) => leg.id === landedLeg)?.chosen?.mode ?? "flight";
  useEffect(() => globe.current?.setVehicle(landedMode), [landedMode]);
```

That effect must come before the early `if (full) return …`, so hooks keep their order. Put it directly after the `landedLeg` `useState`, above `useRecordMember()`.

- [ ] **Step 7: Types, lint, full test run**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/multiplayer "src/app/t/[id]/trip-room.tsx"
git commit -m "feat(trip): park stored legs and your landed leg as their chosen vehicle"
```

---

### Task 6: Design rules and manual check

**Files:**
- Modify: `DESIGN.md` (section "Stickers and the route", the bullets starting "Two stickers exist" and "While flying, the plane casts")
- Modify: `src/design/tokens.json` (`roundel` usage, ~line 151)

- [ ] **Step 1: Update `DESIGN.md`**

Replace the bullet starting "- Two stickers exist:" with:

```markdown
- Two stickers exist: the **plane** (the cursor while flying) and the **star pin**. On the globe, only the plane is used; a trip's start is marked with a small `ink` ring at the foot of the route. Draw each sticker as its face with a `sticker-ink` outline at `line-ink`, and no cut border. Set it off the page with the cast shadow below.
- Once a trip lands, the plane parks as the vehicle of the offer that's picked: the plane for a flight, a **train**, a **bus** or a **ferry**. They are the same paper as the plane: `sticker-fill` faces, `sticker-ink` outlines and windows, one `roundel` accent each (the train's and bus's side stripe, the ferry's funnel). Ground vehicles sit on the surface. When the pick changes, the old vehicle shrinks away and the new one grows in over 0.25s; under reduced motion it swaps at once. Only the plane flies.
```

- [ ] **Step 2: Update the `roundel` usage in `tokens.json`**

Change the `roundel` entry's `usage` to:

```json
"usage": "The two small wing roundels on the plane sticker, and the one accent on each ground vehicle: the train's and bus's side stripe, the ferry's funnel. Nowhere else."
```

`usage` text isn't copied into `tokens.css`, so no regeneration is needed. Confirm with:

Run: `pnpm tokens && git status --short src/design`
Expected: only `src/design/tokens.json` is modified.

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md src/design/tokens.json
git commit -m "docs(design): ground vehicles and their roundel accent"
```

- [ ] **Step 4: Manual check in the browser**

Run: `pnpm dev`, then open `http://localhost:3000/`.

1. Click Hong Kong, move the cursor to Shanghai and click to land. A plane parks.
2. When the ticket card shows results, open the Trains tab and pick a row. The plane pops into a train lying along the route. Check the side window band, the roundel stripe and the dark windscreen.
3. If the tabs offer them, pick a bus row and then a ferry row (try a route such as Hong Kong to Macau for a ferry). Each one pops in.
4. Pick a flight row. It pops back to the plane.
5. Take off again. It's a plane in the air.
6. Turn on reduced motion (macOS: System Settings › Accessibility › Display › Reduce motion). Switching rows now swaps instantly.
7. Switch to dark theme. The vehicles keep their paper colours.
8. Trip room: open `/t/<id>` in two browsers, land a leg in one, and choose a train offer for it in the plan. Both browsers show a parked train at the leg's end.

Report anything that looks wrong, such as z-fighting, inside-out faces (the outline showing on the wrong side) or a vehicle floating or sinking, together with a screenshot.
