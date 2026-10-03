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
