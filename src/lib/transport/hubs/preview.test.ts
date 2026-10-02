import { describe, expect, it } from "vitest";
import { HUBS } from "./catalog";
import { HoverHubResolver, hubPreviewLabel, nearestPreviewHub } from "./preview";
import type { Hub, HubMode } from "./types";

function hub(id: string, mode: HubMode = "flight", lat = 0, lng = 0): Hub {
  return { id, mode, lat, lng, code: "AAA", name: "A terminal", city: "A city", importance: 3, source: "https://example.com" };
}

describe("local hover preview", () => {
  it("uses real bundled airports instead of a weighted global mock snap", () => {
    const airport = HUBS.find((hub) => hub.iata === "HKG")!;
    expect(nearestPreviewHub(airport)?.id).toBe("airport:HKG");
    expect(hubPreviewLabel(airport)).toContain("HKG");
  });
  it.each(["train", "ferry"] as const)("can preview a %s hub", (mode) => {
    const target = HUBS.find((hub) => hub.mode === mode)!;
    expect(nearestPreviewHub(target)?.id).toBe(target.id);
    expect(hubPreviewLabel(target)).toContain(target.name);
  });
  it("prefers the physically nearest hub across modes, with stable tie-breaking", () => {
    const data = [hub("flight:b", "flight", 0, 0.1), hub("train:b", "train"), hub("train:a", "train")];
    expect(nearestPreviewHub({ lat: 0, lng: 0 }, data)?.id).toBe("train:a");
    expect(nearestPreviewHub({ lat: 0, lng: 0 }, [...data].reverse())?.id).toBe("train:a");
  });
  it.each([
    ["flight", 1.7, 1.9], ["train", 0.89, 1.1], ["ferry", 0.5, 0.6],
  ] as const)("bounds the %s catchment instead of always returning a distant hub", (mode, inside, outside) => {
    const data = [hub("test", mode)];
    expect(nearestPreviewHub({ lat: inside, lng: 0 }, data)).not.toBeNull();
    expect(nearestPreviewHub({ lat: outside, lng: 0 }, data)).toBeNull();
  });
  it("does not invent a nearby hub in uncovered ocean or invalid coordinates", () => {
    expect(nearestPreviewHub({ lat: 0, lng: -140 })).toBeNull();
    expect(nearestPreviewHub({ lat: NaN, lng: 0 })).toBeNull();
    expect(nearestPreviewHub({ lat: 91, lng: 0 })).toBeNull();
  });
  it("handles date-line neighbors", () => {
    expect(nearestPreviewHub({ lat: 0, lng: 179.5 }, [hub("date-line", "flight", 0, -179.5)])?.id).toBe("date-line");
  });
  it("throttles movement, updates after camera motion and clears immediately off-globe", () => {
    const data = [hub("a"), hub("b", "flight", 0, 20)];
    const resolver = new HoverHubResolver(data);
    expect(resolver.resolve({ lat: 0, lng: 0 }, 0)?.id).toBe("a");
    expect(resolver.resolve({ lat: 0, lng: 20 }, 40)?.id).toBe("a");
    expect(resolver.resolve({ lat: 0, lng: 20 }, 80)?.id).toBe("b");
    expect(resolver.resolve(null, 81)).toBeNull();
    expect(resolver.resolve({ lat: 0, lng: 0 }, 82)?.id).toBe("a");
    expect(resolver.resolve({ lat: 0, lng: -140 }, 200)).toBeNull();
  });
  it("does not rescan unchanged ground coordinates", () => {
    let reads = 0;
    const location = { ...hub("count"), get lat() { reads++; return 0; } };
    const resolver = new HoverHubResolver([location]);
    resolver.resolve({ lat: 0, lng: 0 }, 0);
    const initial = reads;
    resolver.resolve({ lat: 0, lng: 0 }, 1000);
    expect(reads).toBe(initial);
  });
});
