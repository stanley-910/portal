import { describe, expect, it } from "vitest";

import { clampLeave, lastLegDate, leaveBounds, legBefore, moveLeg, setEnds, settle, type DatePlan } from "./dates";

// The demo: Ann and Bo take the train HK → Shanghai, Cy flies Seoul → Shanghai, all three fly on to Tokyo.
const demo = (): DatePlan => ({
  members: { ann: {}, bo: {}, cy: {} },
  legs: {
    hsr: { date: "2026-10-10", riders: ["ann", "bo"], createdAt: 1 },
    icn: { date: "2026-10-11", riders: ["cy"], createdAt: 2 },
    nrt: { date: "2026-10-13", riders: ["ann", "bo", "cy"], createdAt: 3 },
  },
  ends: "2026-10-16",
});

describe("legBefore", () => {
  it("is the latest earlier leg sharing a rider", () => {
    expect(legBefore(demo(), "nrt")).toEqual({ leg: "icn", date: "2026-10-11" });
    expect(legBefore(demo(), "hsr")).toBeNull();
    // Cy's flight to Shanghai doesn't wait on Ann and Bo's train
    expect(legBefore(demo(), "icn")).toBeNull();
  });
});

describe("moveLeg", () => {
  it("pushes the next leg along when one moves past it", () => {
    const result = moveLeg(demo(), "icn", "2026-10-14");
    expect(result.date).toBe("2026-10-14");
    expect(result.legs).toEqual({ icn: "2026-10-14", nrt: "2026-10-14" });
    expect(result.blocked).toEqual([]);
  });

  it("leaves later legs alone when they still come after", () => {
    expect(moveLeg(demo(), "hsr", "2026-10-12").legs).toEqual({ hsr: "2026-10-12" });
  });

  it("doesn't let a leg leave before the leg that gets its riders there", () => {
    const result = moveLeg(demo(), "nrt", "2026-10-09");
    expect(result.date).toBe("2026-10-11");
    expect(result.legs).toEqual({ nrt: "2026-10-11" });
  });

  it("pushes along a chain of riders, not legs nobody shares", () => {
    const plan = demo();
    plan.legs!.home = { date: "2026-10-15", riders: ["cy"], createdAt: 4 };
    plan.legs!.solo = { date: "2026-10-12", riders: ["dee"], createdAt: 5 };
    expect(moveLeg(plan, "hsr", "2026-10-17").legs).toEqual({ hsr: "2026-10-17", nrt: "2026-10-17", home: "2026-10-17" });
  });

  it("moves the trip's end and leave dates with the legs", () => {
    const plan = demo();
    plan.members!.cy = { leaves: "2026-10-12" };
    const result = moveLeg(plan, "nrt", "2026-10-18");
    expect(result.ends).toBe("2026-10-18");
    expect(result.leaves).toEqual({});
    const late = moveLeg(plan, "icn", "2026-10-13");
    // Cy can't leave before he arrives
    expect(late.leaves).toEqual({ cy: "2026-10-13" });
  });

  it("flags legs being booked that would have to move", () => {
    const plan = demo();
    plan.legs!.nrt.booking = { status: "paying" };
    expect(moveLeg(plan, "hsr", "2026-10-15").blocked).toEqual(["nrt"]);
    expect(moveLeg(plan, "hsr", "2026-10-12").blocked).toEqual([]);
  });

  it("changes nothing when the date is the same", () => {
    expect(moveLeg(demo(), "nrt", "2026-10-13")).toEqual({ legs: {}, leaves: {}, date: "2026-10-13", blocked: [] });
  });
});

describe("the trip's end and leave dates", () => {
  it("ends no earlier than the latest leg, whatever order they were drawn in", () => {
    const plan = demo();
    plan.legs!.icn.createdAt = 9;
    expect(lastLegDate(plan)).toBe("2026-10-13");
    expect(setEnds(plan, "2026-10-12").ends).toBe("2026-10-13");
    expect(setEnds(plan, null).ends).toBeNull();
  });

  it("brings leave dates back to an earlier end", () => {
    const plan = demo();
    plan.members!.ann = { leaves: "2026-10-15" };
    expect(setEnds(plan, "2026-10-14")).toEqual({ legs: {}, leaves: { ann: "2026-10-14" }, ends: "2026-10-14" });
  });

  it("keeps a leave date between the member's first leg and the end", () => {
    const plan = demo();
    expect(leaveBounds(plan, "cy")).toEqual({ min: "2026-10-11", max: "2026-10-16" });
    expect(clampLeave(plan, "cy", "2026-10-01")).toBe("2026-10-11");
    expect(clampLeave(plan, "cy", "2026-10-20")).toBe("2026-10-16");
    expect(clampLeave(plan, "cy", "2026-10-14")).toBe("2026-10-14");
    expect(clampLeave(plan, "cy", null)).toBeNull();
    // with no end set, only the start is bounded
    expect(clampLeave({ ...plan, ends: null }, "cy", "2026-10-20")).toBe("2026-10-20");
  });

  it("settles nothing in a plan that's already in order", () => {
    const plan = demo();
    plan.members!.ann = { leaves: "2026-10-14" };
    expect(settle(plan)).toEqual({ legs: {}, leaves: {} });
  });
});
