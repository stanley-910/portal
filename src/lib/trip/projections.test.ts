import { describe, expect, it } from "vitest";
import { selectPlanDates, selectPlanLegs, selectPlanStays, selectSplit, type PlanSnapshot } from "./projections";
import { computeSplit, staysOf } from "./split";
const room = (): PlanSnapshot => ({
  members: { a: { name: "A", color: 1 } },
  stops: { a: { lat: 0, lng: 0, hub: null, name: "A" }, b: { lat: 1, lng: 1, hub: null, name: "B" } },
  legs: Object.fromEntries(["one", "two"].map((id, i) => [id, { from: "a", to: "b", date: "2026-10-05", createdBy: "a", riders: ["a"], search: { id, status: "done" as const, offers: [] }, votes: {}, chosen: null, createdAt: i }])),
  stays: { s: { stop: "b", checkIn: "2026-10-05", checkOut: "2026-10-07", guests: ["a"], nightly: { amount: 80, currency: "USD" }, label: "Stay" } },
});
describe("shared immutable projections", () => {
  it("shares work across subscribers and ignores unrelated root changes", () => {
    const root = room();
    for (const select of [selectPlanLegs, selectPlanDates, selectPlanStays, selectSplit]) {
      const first = select(root);
      expect(select({ ...root })).toBe(first);
      expect(select(root)).toBe(first);
    }
  });
  it("retains unchanged leg identity while invalidating votes and stops", () => {
    const root = room(), first = selectPlanLegs(root);
    const voted = { ...root, legs: { ...root.legs, one: { ...root.legs.one, votes: { a: "fare" } } } };
    const dates = selectPlanDates(root), split = selectSplit(root);
    expect(selectPlanDates(voted)).toBe(dates);
    expect(selectSplit(voted)).toBe(split);
    const second = selectPlanLegs(voted);
    expect(second[0].votes).toEqual({ fare: ["a"] });
    expect(second[1]).toBe(first[1]);
    const moved = selectPlanLegs({ ...voted, stops: { ...root.stops, b: { ...root.stops.b, lng: 20 } } });
    expect(moved[0].to.lng).toBe(20);
    expect(moved[1]).not.toBe(first[1]);
  });
  it("matches splits and invalidates changes in who stays and who leaves", () => {
    const root = room();
    expect(selectSplit(root)).toEqual(computeSplit(root));
    expect(selectPlanStays(root)).toEqual(staysOf(root));
    const changed = { ...root, members: { a: { ...root.members.a, leaves: "2026-10-06" } } };
    expect(selectSplit(changed)).toEqual(computeSplit(changed));
    expect(selectSplit(changed)).not.toBe(selectSplit(root));
    expect(selectPlanDates(changed).members?.a.leaves).toBe("2026-10-06");
    expect(selectSplit(room())).not.toBe(selectSplit(root));
  });
});
