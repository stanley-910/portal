import { LiveMap, LiveObject, type Lson, type LsonObject } from "@liveblocks/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Stop } from "@/lib/liveblocks/types";

import { editPlan } from "./edit";
import { handlesFor, type PlanJson } from "./snapshot";

// A room's Storage held in memory: editPlan writes to it through the same LiveObject API as a real room.
let root: LiveObject<LsonObject>;
vi.mock("@/lib/liveblocks/server", () => ({
  liveblocks: () => ({ mutateStorage: async (_room: string, cb: (s: { root: unknown }) => void) => cb({ root }) }),
}));
vi.mock("@/lib/trip/search-leg", () => ({ runLegSearch: async () => {} }));

const stop = (name: string, lat: number, lng: number, hub: string | null = null): Stop => ({ name, lat, lng, hub, code: null });
const leg = (from: string, to: string, createdAt: number) => ({
  from, to, date: "2026-10-04", createdBy: "u1", riders: ["u1"], search: { id: `s${createdAt}`, status: "done", offers: [] },
  votes: {}, chosen: null, createdAt,
});

// The trip from the recording at 5:09, before Pip moved everyone to Taipei
const plan: PlanJson = {
  members: { u1: { name: "Stanley", color: 1 } },
  stops: {
    hk: stop("Hong Kong", 22.3, 114.2),
    bj: stop("Beijing", 39.9, 116.4),
    tc: stop("Taichung (Qingshui)", 24.26, 120.62),
    bt: stop("Bintulu", 3.12, 113.02),
  },
  legs: { a: leg("hk", "tc", 1), b: leg("bj", "tc", 2), c: leg("tc", "bt", 3) },
};

function storageFrom(p: PlanJson) {
  const legs = Object.entries(p.legs ?? {}).map(
    ([id, l]) => [id, new LiveObject({ ...l, votes: new LiveMap<string, string>() })] as const,
  );
  return new LiveObject<LsonObject>({
    members: new LiveMap(Object.entries(p.members ?? {}).map(([id, m]) => [id, new LiveObject(m)])),
    stops: new LiveMap(Object.entries(p.stops ?? {}).map(([id, s]) => [id, new LiveObject(s)])),
    legs: new LiveMap(legs),
  });
}

const json = () => root.toJSON() as unknown as PlanJson;

beforeEach(() => {
  root = storageFrom(plan);
});

describe("editPlan", () => {
  it("keeps the stops that later ops in the same change add legs to", async () => {
    const h = handlesFor(plan);
    const result = await editPlan("room", plan, h, [
      { op: "remove_leg", leg: "L1" },
      { op: "remove_leg", leg: "L2" },
      { op: "remove_leg", leg: "L3" },
      { op: "add_leg", from: { stop: h.stop.get("hk")! }, to: { place: "Taipei" }, date: "2026-10-04", riders: ["M1"] },
      { op: "add_leg", from: { stop: h.stop.get("bj")! }, to: { place: "Taipei" }, date: "2026-10-04", riders: ["M1"] },
      { op: "add_leg", from: { place: "Taipei" }, to: { stop: h.stop.get("bt")! }, date: "2026-10-04", riders: ["M1"] },
    ], "agent:pip");

    const after = json();
    for (const l of Object.values(after.legs ?? {})) {
      expect(after.stops?.[l.from], `stop ${l.from}`).toBeDefined();
      expect(after.stops?.[l.to], `stop ${l.to}`).toBeDefined();
    }
    expect(Object.keys(after.legs ?? {})).toHaveLength(3);
    // Taichung isn't on any leg now, so it goes; the others stay
    expect(after.stops?.tc).toBeUndefined();
    expect(after.stops?.hk && after.stops?.bj && after.stops?.bt).toBeTruthy();
    expect(result.applied.join("\n")).not.toContain("?");
  });

  it("puts back a stop someone removed since the snapshot instead of pointing a leg at it", async () => {
    const h = handlesFor(plan);
    (root.get("stops") as LiveMap<string, Lson>).delete("bt");
    await editPlan("room", plan, h, [{ op: "add_leg", from: { stop: h.stop.get("hk")! }, to: { stop: h.stop.get("bt")! }, date: "2026-10-05", riders: ["M1"] }], "agent:pip");
    expect(json().stops?.bt?.name).toBe("Bintulu");
  });

  it("names both ends of a removed leg whose stop goes with it", async () => {
    const result = await editPlan("room", plan, handlesFor(plan), [{ op: "remove_leg", leg: "L3" }], "agent:pip");
    expect(result.applied).toEqual(["Removed Taichung (Qingshui) → Bintulu"]);
    expect(json().stops?.bt).toBeUndefined();
  });
});

describe("editPlan, members", () => {
  it("refuses a handle the run kept for someone who has since left", async () => {
    const h = handlesFor(plan);
    const gone: PlanJson = { ...plan, members: {} };
    const result = await editPlan("room", gone, handlesFor(gone, h), [
      { op: "add_leg", from: { stop: h.stop.get("hk")! }, to: { stop: h.stop.get("bt")! }, date: "2026-10-05", riders: ["M1"] },
    ], "agent:pip");
    expect(result.refused[0]).toMatchObject({ code: "UNKNOWN_HANDLE" });
    expect(result.applied).toEqual([]);
  });
});

describe("handlesFor", () => {
  it("keeps handles the run already gave out, and never reuses a removed one", () => {
    const first = handlesFor(plan);
    expect(first.leg.get("b")).toBe("L2");
    // L1 is removed and a leg is added
    const next = handlesFor({ ...plan, legs: { b: plan.legs!.b, c: plan.legs!.c, d: leg("hk", "bt", 4) } }, first);
    expect(next.leg.get("b")).toBe("L2");
    expect(next.leg.get("c")).toBe("L3");
    expect(next.leg.get("d")).toBe("L4");
    expect(next.id.get("L1")).toBe("a");
  });
});
