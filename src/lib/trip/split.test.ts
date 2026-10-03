import { describe, expect, it } from "vitest";
import { computeSplit, nightsByStop, splitGaps, staysOf, type SplitInput } from "./split";

const offer = (id: string, amount: number, currency: string, kind: "live" | "estimated" = "live") => ({
  id,
  price: { amount, currency },
  kind,
});

const legs = (): SplitInput["legs"] => ({
  hsr: { from: "hk", to: "sh", date: "2026-10-10", riders: ["ann", "bo"], search: { offers: [offer("t1", 1000, "HKD")] }, chosen: "t1", createdAt: 1 },
  icn: { from: "sel", to: "sh", date: "2026-10-10", riders: ["cy"], search: { offers: [offer("f1", 300000, "KRW", "estimated")] }, chosen: "f1", createdAt: 2 },
  nrt: { from: "sh", to: "tyo", date: "2026-10-13", riders: ["ann", "bo", "cy"], search: { offers: [offer("f2", 250, "USD")] }, chosen: "f2", createdAt: 3 },
});

// The demo: Ann and Bo take the train HK → Shanghai, Cy flies Seoul → Shanghai, all three fly on to Tokyo, and all
// three share a flat in each city.
const demo = (): SplitInput => ({
  members: { ann: {}, bo: {}, cy: {} },
  legs: legs(),
  stays: {
    s1: { stop: "sh", checkIn: "2026-10-10", checkOut: "2026-10-13", guests: ["ann", "bo", "cy"], nightly: { amount: 900, currency: "CNY" }, label: null, createdAt: 1 },
    s2: { stop: "tyo", checkIn: "2026-10-13", checkOut: "2026-10-16", guests: ["ann", "bo", "cy"], nightly: { amount: 30000, currency: "JPY" }, label: "Shinjuku apartment", createdAt: 2 },
  },
});

describe("computeSplit", () => {
  it("splits each night among the stay's guests and keeps currencies apart", () => {
    const split = computeSplit(demo());
    expect(split.nights.map((n) => `${n.stop} ${n.date} ${n.present.length}`)).toEqual([
      "sh 2026-10-10 3",
      "sh 2026-10-11 3",
      "sh 2026-10-12 3",
      "tyo 2026-10-13 3",
      "tyo 2026-10-14 3",
      "tyo 2026-10-15 3",
    ]);
    expect(split.members.ann!.totals).toEqual({ HKD: 1000, CNY: 900, USD: 250, JPY: 30000 });
    expect(split.members.cy!.totals).toEqual({ KRW: 300000, CNY: 900, USD: 250, JPY: 30000 });
    expect(split.members.cy!.fares).toEqual([
      { leg: "icn", price: { amount: 300000, currency: "KRW" }, kind: "estimated" },
      { leg: "nrt", price: { amount: 250, currency: "USD" }, kind: "live" },
    ]);
    expect(split.members.ann!.missing).toEqual([]);
    expect(split.ends).toBe("2026-10-16");
  });

  it("keeps riding and staying apart: a rider needn't stay, and a guest needn't ride", () => {
    const plan = demo();
    plan.members!.dee = {};
    plan.stays!.s1!.guests = ["ann", "bo"];
    plan.stays!.s2!.guests = ["ann", "bo", "cy", "dee"];
    const split = computeSplit(plan);
    expect(split.members.cy!.totals.CNY).toBeUndefined();
    expect(split.members.ann!.totals.CNY).toBe(1350);
    expect(split.members.dee!.fares).toEqual([]);
    expect(split.members.dee!.totals).toEqual({ JPY: 22500 });
  });

  it("raises everyone else's share when one member leaves early", () => {
    const plan = demo();
    plan.members!.cy = { leaves: "2026-10-15" };
    const split = computeSplit(plan);
    expect(split.nights.at(-1)!.present).toEqual(["ann", "bo"]);
    expect(split.members.cy!.totals.JPY).toBe(20000);
    expect(split.members.ann!.totals.JPY).toBe(35000);
  });

  it("charges only fares for a trip with no stays", () => {
    const plan = demo();
    delete plan.stays;
    const split = computeSplit(plan);
    expect(split.nights).toEqual([]);
    expect(split.ends).toBeNull();
    expect(split.members.bo!.totals).toEqual({ HKD: 1000, USD: 250 });
  });

  it("flags a stay nobody has priced and leaves it out of totals", () => {
    const plan = demo();
    plan.stays!.s2!.nightly = null;
    const split = computeSplit(plan);
    expect(split.members.bo!.missing).toEqual(["no_stay_cost"]);
    expect(split.members.bo!.totals).toEqual({ HKD: 1000, CNY: 900, USD: 250 });
  });

  it("is empty for an empty trip", () => {
    expect(computeSplit({})).toEqual({ ends: null, nights: [], members: {} });
  });
});

describe("computeSplit with a booking", () => {
  it("charges each rider their settled share instead of the quoted fare", () => {
    const plan = demo();
    plan.legs!.nrt.booking = { seats: { ann: { share: { amount: 260.5, currency: "USD" } }, bo: { share: { amount: 260.5, currency: "USD" } }, cy: { share: { amount: 260.51, currency: "USD" } } } };
    const split = computeSplit(plan);
    expect(split.members.cy!.fares.find((f) => f.leg === "nrt")).toEqual({ leg: "nrt", price: { amount: 260.51, currency: "USD" }, kind: "live" });
    expect(split.members.ann!.totals.USD).toBe(260.5);
  });
});

describe("nightsByStop", () => {
  it("adds up a member's nights at each stop per currency", () => {
    const split = computeSplit(demo());
    expect(nightsByStop(split.members.ann!.nightShares)).toEqual([
      { stop: "sh", nights: 3, totals: { CNY: 900 } },
      { stop: "tyo", nights: 3, totals: { JPY: 30000 } },
    ]);
  });
});

describe("splitGaps", () => {
  it("names nothing when every leg is picked and every stay priced", () => {
    expect(splitGaps(computeSplit(demo()))).toEqual({ legs: [], stops: [] });
  });

  it("names legs with no pick and stops with a stay nobody has priced", () => {
    const plan = demo();
    plan.legs!.icn!.chosen = null;
    plan.stays!.s2!.nightly = null;
    expect(splitGaps(computeSplit(plan))).toEqual({ legs: ["icn"], stops: ["tyo"] });
  });
});

// Rooms from before stays had their own guests and dates: a stop id → price, nights from who rode in.
describe("staysOf, for older rooms", () => {
  const older = (): SplitInput => ({
    members: { ann: {}, bo: {}, cy: {} },
    legs: legs(),
    stays: {
      sh: { nightly: { amount: 900, currency: "CNY" }, label: null },
      tyo: { nightly: { amount: 30000, currency: "JPY" }, label: "Shinjuku apartment" },
    },
    ends: "2026-10-16",
  });

  it("turns each stop's nights into a stay for whoever rode in, keeping the stop id", () => {
    expect(staysOf(older()).map((s) => [s.id, s.stop, s.checkIn, s.checkOut, s.guests.sort().join()])).toEqual([
      ["sh", "sh", "2026-10-10", "2026-10-13", "ann,bo,cy"],
      ["tyo", "tyo", "2026-10-13", "2026-10-16", "ann,bo,cy"],
    ]);
    expect(computeSplit(older()).members.ann!.totals).toEqual(computeSplit(demo()).members.ann!.totals);
  });

  it("charges no nights at home, so a leg back ends them", () => {
    const plan = older();
    plan.legs!.home = { from: "tyo", to: "sel", date: "2026-10-14", riders: ["cy"], search: { offers: [] }, chosen: null, createdAt: 4 };
    const split = computeSplit(plan);
    expect(split.nights.filter((n) => n.stop === "sel")).toEqual([]);
    expect(split.members.cy!.nightShares.filter((n) => n.stop === "tyo").map((n) => n.date)).toEqual(["2026-10-13"]);
  });

  it("ends the morning after the latest leg or on a leave date when no end is set", () => {
    const plan = older();
    plan.ends = null;
    expect(computeSplit(plan).nights.filter((n) => n.stop === "tyo").map((n) => n.date)).toEqual(["2026-10-13"]);
    plan.members!.ann = { leaves: "2026-10-15" };
    expect(computeSplit(plan).nights.filter((n) => n.stop === "tyo").map((n) => n.date)).toEqual(["2026-10-13", "2026-10-14"]);
  });

  it("starts a second stay when the group comes back to a stop", () => {
    const plan: SplitInput = {
      members: { ann: {} },
      legs: {
        a: { from: "hk", to: "sh", date: "2026-10-10", riders: ["ann"], search: { offers: [] }, chosen: null, createdAt: 1 },
        b: { from: "sh", to: "tyo", date: "2026-10-12", riders: ["ann"], search: { offers: [] }, chosen: null, createdAt: 2 },
        c: { from: "tyo", to: "sh", date: "2026-10-14", riders: ["ann"], search: { offers: [] }, chosen: null, createdAt: 3 },
      },
      stays: { sh: { nightly: null, label: null } },
      ends: "2026-10-16",
    };
    expect(staysOf(plan).map((s) => [s.id, s.checkIn, s.checkOut])).toEqual([
      ["sh", "2026-10-10", "2026-10-12"],
      ["sh#2", "2026-10-14", "2026-10-16"],
    ]);
  });

  it("starts on local arrival and keeps previous-day arrivals", () => {
    const plan: SplitInput = { members: { ann: {}, bo: {} }, ends: "2026-11-17", stays: { sf: { nightly: null, label: null } }, legs: {
      ann: { from: "tokyo", to: "sf", date: "2026-11-15", riders: ["ann"], createdAt: 1, chosen: "a",
        search: { offers: [{ id: "a", kind: "cached", price: null, arrive: "2026-11-14T17:30:00-08:00" }] } },
      bo: { from: "hk", to: "sf", date: "2026-11-15", riders: ["bo"], createdAt: 2, chosen: "b",
        search: { offers: [{ id: "b", kind: "live", price: null, arrive: "2026-11-16T05:00:00-08:00" }] } },
    } };
    expect(staysOf(plan).map((s) => [s.id, s.checkIn, s.checkOut, s.guests])).toEqual([
      ["sf", "2026-11-14", "2026-11-16", ["ann"]],
      ["sf#2", "2026-11-16", "2026-11-17", ["ann", "bo"]],
    ]);
  });
});
