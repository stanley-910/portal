import { describe, expect, it } from "vitest";

import { HUB_LIMITS } from "./limits";
import { beyondReach, crossesModes, hubById, hubChoices } from "./pick";
import { distanceKm } from "./geo";

const seattle = { lat: 47.6062, lng: -122.3321 };
const hongKong = { lat: 22.3193, lng: 114.1694 };

describe("picking a stop's hub", () => {
  it("offers the hubs a search would consider, the big airport first", () => {
    const hubs = hubChoices("", seattle);
    expect(hubs[0].code).toBe("SEA");
    expect(hubs.length).toBeGreaterThan(1);
    for (const hub of hubs) expect(distanceKm(seattle, hub)).toBeLessThanOrEqual(HUB_LIMITS.radiusKm[hub.mode]);
  });
  it("offers nothing nearby out at sea", () => {
    expect(hubChoices("", { lat: 0, lng: -140 })).toEqual([]);
  });
  it("puts an exact code first, wherever it is", () => {
    expect(hubChoices("nrt", seattle)[0].code).toBe("NRT");
    expect(hubChoices("Narita", seattle)[0].code).toBe("NRT");
  });
  it("matches stations and cities, nearer ones first", () => {
    expect(hubChoices("west kowloon", hongKong)[0].id).toBe("train:HK-WEST-KOWLOON");
    const tokyo = hubChoices("tokyo", { lat: 35.68, lng: 139.77 });
    expect(tokyo.map((hub) => hub.code)).toContain("HND");
  });
  it("tells a nearby hub from one somewhere else, and hubs that can't share a leg", () => {
    const sea = hubById("airport:SEA")!;
    expect(beyondReach(seattle, sea)).toBe(false);
    expect(beyondReach(seattle, hubById("airport:NRT")!)).toBe(true);
    expect(crossesModes(sea, hubById("train:TOKYO"))).toBe(true);
    expect(crossesModes(sea, hubById("airport:NRT"))).toBe(false);
    expect(crossesModes(sea, null)).toBe(false);
  });
  it("finds a hub by id", () => {
    expect(hubById("airport:SEA")?.code).toBe("SEA");
    expect(hubById("airport:ZZZ")).toBeNull();
    expect(hubById(null)).toBeNull();
  });
});
