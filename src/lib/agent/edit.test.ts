import { LiveMap, LiveObject, type Lson, type LsonObject } from "@liveblocks/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LegBooking, Stop } from "@/lib/liveblocks/types";

import { editPlan, editTarget, undoChangeset } from "./edit";
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

  it("marks each change for the globe, over where its leg ends", async () => {
    const h = handlesFor(plan);
    const result = await editPlan("room", plan, h, [
      { op: "remove_leg", leg: "L3" },
      { op: "add_leg", from: { stop: h.stop.get("hk")! }, to: { stop: h.stop.get("bj")! }, date: "2026-10-05", riders: ["M1"] },
    ], "agent:pip");
    expect(result.marks.map((m) => m.text)).toEqual(["Removed Taichung (Qingshui) → Bintulu", "Added Hong Kong → Beijing"]);
    // at Bintulu, though it went with the leg, and at Beijing: never out at sea between
    expect(result.marks.map((m) => m.at)).toEqual([{ lat: 3.12, lng: 113.02 }, { lat: 39.9, lng: 116.4 }]);
  });

  it("knows where an edit lands before making it, so the saucer can get there first", () => {
    const h = handlesFor(plan);
    expect(editTarget(plan, h, [{ op: "add_leg", from: { stop: "S1" }, to: { stop: h.stop.get("bj")! }, date: "2026-10-05", riders: ["M1"] }])).toEqual({ lat: 39.9, lng: 116.4 });
    expect(editTarget(plan, h, [{ op: "remove_leg", leg: "L3" }])).toEqual({ lat: 3.12, lng: 113.02 });
    expect(editTarget(plan, h, [{ op: "set_leaves", member: "M1", date: null }])).toBeNull();
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

  it("refuses a rider who left between the run's read and its write", async () => {
    const h = handlesFor(plan);
    (root.get("members") as LiveMap<string, Lson>).delete("u1");
    const result = await editPlan("room", plan, h, [
      { op: "add_leg", from: { stop: h.stop.get("hk")! }, to: { stop: h.stop.get("bt")! }, date: "2026-10-05", riders: ["M1"] },
      { op: "set_riders", leg: h.leg.get("a")!, riders: ["M1"] },
    ], "agent:pip");
    expect(result.refused.map((r) => [r.op, r.code])).toEqual([[0, "UNKNOWN_HANDLE"], [1, "UNKNOWN_HANDLE"]]);
    expect(result.changesetId).toBeNull();
    expect(Object.keys(json().legs ?? {})).toEqual(["a", "b", "c"]);
  });
});

describe("editPlan, dates", () => {
  // Stanley takes the train HK → Taichung on the 4th, then on to Bintulu on the 7th; the trip ends on the 9th
  const dated: PlanJson = {
    ...plan,
    legs: { a: leg("hk", "tc", 1), c: { ...leg("tc", "bt", 3), date: "2026-10-07" } },
    ends: "2026-10-09",
  };
  const dates = () => Object.fromEntries(Object.entries(json().legs ?? {}).map(([id, l]) => [id, l.date]));

  beforeEach(() => {
    root = storageFrom(dated);
    root.set("ends", "2026-10-09");
  });

  it("pushes the next leg along, and the trip's end, when a leg moves past them", async () => {
    const h = handlesFor(dated);
    const result = await editPlan("room", dated, h, [{ op: "set_date", leg: "L1", date: "2026-10-10" }], "agent:pip");
    expect(dates()).toEqual({ a: "2026-10-10", c: "2026-10-10" });
    expect(json().ends).toBe("2026-10-10");
    expect(result.applied).toEqual([
      "Moved Hong Kong → Taichung (Qingshui) to Sat 10 Oct",
      "Moved Taichung (Qingshui) → Bintulu to Sat 10 Oct so it still comes after Hong Kong → Taichung (Qingshui)",
      "Trip now ends the morning of Sat 10 Oct, the day of its last leg",
    ]);
    // one Undo puts all three back
    await undoChangeset("room", result.changesetId!);
    expect(dates()).toEqual({ a: "2026-10-04", c: "2026-10-07" });
    expect(json().ends).toBe("2026-10-09");
  });

  it("won't move a leg before the leg that gets its riders there", async () => {
    const result = await editPlan("room", dated, handlesFor(dated), [{ op: "set_date", leg: "L2", date: "2026-10-01" }], "agent:pip");
    expect(dates()).toEqual({ a: "2026-10-04", c: "2026-10-04" });
    expect(result.applied).toEqual(["Moved Taichung (Qingshui) → Bintulu to Sun 4 Oct, the earliest after Hong Kong → Taichung (Qingshui)"]);
  });

  it("refuses a move that would push a leg being booked", async () => {
    const booked: PlanJson = { ...dated, legs: { ...dated.legs, c: { ...dated.legs!.c, booking: { status: "paying" } as unknown as LegBooking } } };
    root = storageFrom(booked);
    const result = await editPlan("room", booked, handlesFor(booked), [{ op: "set_date", leg: "L1", date: "2026-10-08" }], "agent:pip");
    expect(result.refused).toMatchObject([{ op: 0, code: "LOCKED" }]);
    expect(dates()).toEqual({ a: "2026-10-04", c: "2026-10-07" });
  });

  it("keeps a leave date after the member's first leg", async () => {
    const result = await editPlan("room", dated, handlesFor(dated), [{ op: "set_leaves", member: "M1", date: "2026-10-01" }], "agent:pip");
    expect(json().members?.u1?.leaves).toBe("2026-10-04");
    expect(result.applied).toEqual(["Stanley leaves on Sun 4 Oct, the day of their first leg"]);
  });
});

describe("editPlan, stays", () => {
  const two: PlanJson = { ...plan, members: { u1: { name: "Stanley", color: 1 }, u2: { name: "Mei", color: 2 } } };
  beforeEach(() => {
    root = storageFrom(two);
  });

  it("adds a stay with its own guests and nights, apart from who rides there", async () => {
    const h = handlesFor(two);
    const result = await editPlan("room", two, h, [
      { op: "set_stay", stop: h.stop.get("tc")!, check_in: "2026-10-04", check_out: "2026-10-07", guests: ["M2"], nightly: { amount: 900, currency: "TWD" }, label: "Flat" },
    ], "agent:pip");
    const stays = Object.values(json().stays ?? {});
    expect(stays).toMatchObject([{ stop: "tc", checkIn: "2026-10-04", checkOut: "2026-10-07", guests: ["u2"], nightly: { amount: 900, currency: "TWD" }, label: "Flat", estimated: false }]);
    expect(result.applied).toEqual(["Added a stay in Taichung (Qingshui) (Flat): Sun 4 Oct to Wed 7 Oct for Mei, TWD 900 a night"]);
  });

  it("changes a stay by its handle, removes it, and Undo puts it back", async () => {
    const h = handlesFor(two);
    await editPlan("room", two, h, [{ op: "set_stay", stop: h.stop.get("tc")!, check_in: "2026-10-04", check_out: "2026-10-07", guests: ["M1"] }], "agent:pip");
    const after = json();
    const h2 = handlesFor(after, h);
    await editPlan("room", after, h2, [{ op: "set_stay", stay: "H1", guests: ["M1", "M2"], check_out: "2026-10-06" }], "agent:pip");
    expect(Object.values(json().stays ?? {})).toMatchObject([{ guests: ["u1", "u2"], checkIn: "2026-10-04", checkOut: "2026-10-06" }]);
    const removed = await editPlan("room", json(), handlesFor(json(), h2), [{ op: "remove_stay", stay: "H1" }], "agent:pip");
    expect(Object.keys(json().stays ?? {})).toEqual([]);
    await undoChangeset("room", removed.changesetId!);
    expect(Object.values(json().stays ?? {})).toMatchObject([{ guests: ["u1", "u2"] }]);
  });

  it("refuses a new stay without its nights or guests", async () => {
    const h = handlesFor(two);
    const result = await editPlan("room", two, h, [
      { op: "set_stay", stop: h.stop.get("tc")!, check_in: "2026-10-07", check_out: "2026-10-04", guests: ["M1"] },
      { op: "set_stay", stop: h.stop.get("tc")!, check_in: "2026-10-04", check_out: "2026-10-07" },
    ], "agent:pip");
    expect(result.refused.map((r) => r.code)).toEqual(["BAD_DATE", "UNKNOWN_HANDLE"]);
  });

  it("keeps a stop a stay uses when its last leg goes", async () => {
    const h = handlesFor(two);
    await editPlan("room", two, h, [{ op: "set_stay", stop: h.stop.get("bt")!, check_in: "2026-10-04", check_out: "2026-10-07", guests: ["M1"] }], "agent:pip");
    await editPlan("room", json(), handlesFor(json(), h), [{ op: "remove_leg", leg: "L3" }], "agent:pip");
    expect(json().stops?.bt).toBeDefined();
  });

  it("writes an older room's stop-keyed stay out whole before changing it", async () => {
    // Stanley reaches Taichung on the 4th and leaves on the 7th, so the old rule gave him three nights there
    const older: PlanJson = {
      ...two,
      legs: { a: leg("hk", "tc", 1), c: { ...leg("tc", "bt", 3), date: "2026-10-07" } },
      stays: { tc: { nightly: { amount: 900, currency: "TWD" }, label: null } },
    };
    root = storageFrom(older);
    root.set("stays", new LiveMap([["tc", new LiveObject({ nightly: { amount: 900, currency: "TWD" }, label: null })]]) as never);
    const h = handlesFor(older);
    expect(h.stay.get("tc")).toBe("H1");
    const result = await editPlan("room", older, h, [{ op: "set_stay", stay: "H1", guests: ["M1", "M2"] }], "agent:pip");
    expect(json().stays?.tc).toMatchObject({ stop: "tc", checkIn: "2026-10-04", checkOut: "2026-10-07", guests: ["u1", "u2"], nightly: { amount: 900, currency: "TWD" } });
    await undoChangeset("room", result.changesetId!);
    expect(json().stays?.tc).toEqual({ nightly: { amount: 900, currency: "TWD" }, label: null });
  });
});

describe("editPlan, out of time", () => {
  it("changes nothing once the run's turn is over", async () => {
    const h = handlesFor(plan);
    const result = await editPlan("room", plan, h, [{ op: "remove_leg", leg: h.leg.get("c")! }], "agent:pip", Date.now() - 1);
    expect(result.refused).toMatchObject([{ op: 0, code: "OUT_OF_TIME" }]);
    expect(result.changesetId).toBeNull();
    expect(json().legs?.c).toBeDefined();
    expect(root.get("changesets")).toBeUndefined();
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
