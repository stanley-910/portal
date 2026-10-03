import { describe, expect, it } from "vitest";
import { buildVehicle, VEHICLE_LENGTH, VEHICLES } from "./vehicle-models";

const PARTS = { flight: [0, 1, 2, 3, 4], train: [0], bus: [0, 2, 3], ferry: [0, 1, 2] } as const;

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
