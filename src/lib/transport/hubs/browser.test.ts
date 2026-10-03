import { describe, expect, it } from "vitest";
import { HUBS as browser } from "./browser";
import { HUBS, HUB_LIMITS } from "./catalog";
import { distanceKm } from "./geo";
import { nearestPreviewHub } from "./preview";

describe("compact browser hubs", () => {
  it("preserves every original field, coordinate, ID and source", () => { expect(browser).toEqual(HUBS); });
  it("matches exhaustive nearest search including poles and the date line", () => {
    let seed = 792;
    const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const points = [ { lat: 90, lng: 180 }, { lat: -90, lng: -180 }, ...HUBS.filter((_, i) => i % 50 === 0), ...Array.from({ length: 500 }, () => ({ lat: next() * 180 - 90, lng: next() * 360 - 180 })) ];
    for (const point of points) {
      const expected = HUBS.map((hub) => ({ hub, d: distanceKm(point, hub) }))
        .filter(({ hub, d }) => d <= HUB_LIMITS.radiusKm[hub.mode])
        .sort((a, b) => a.d - b.d || (a.hub.id < b.hub.id ? -1 : 1))[0]?.hub.id ?? null;
      expect(nearestPreviewHub(point)?.id ?? null).toBe(expected);
    }
  });
});
