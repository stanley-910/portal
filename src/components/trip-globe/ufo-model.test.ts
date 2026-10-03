import { describe, expect, it } from "vitest";
import { buildUfo, UFO_DOME } from "./ufo-model";

describe("buildUfo", () => {
  it("stands upright: about 1 across, flat, with the dome on top", () => {
    const m = buildUfo();
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < m.pos.length; i += 3) {
      xs.push(m.pos[i]);
      ys.push(m.pos[i + 1]);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
    expect(Math.max(...ys)).toBeGreaterThan(UFO_DOME.y + UFO_DOME.r);
  });

  it("has unit normals pointing out of the dome", () => {
    const m = buildUfo();
    for (let i = 0; i < m.count; i++) {
      expect(Math.hypot(m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2])).toBeCloseTo(1, 3);
      if (m.part[i] !== 1) continue;
      const out = [m.pos[i * 3], m.pos[i * 3 + 1] - UFO_DOME.y, m.pos[i * 3 + 2]];
      expect(out[0] * m.nrm[i * 3] + out[1] * m.nrm[i * 3 + 1] + out[2] * m.nrm[i * 3 + 2]).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});
