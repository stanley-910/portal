import { describe, expect, it } from "vitest";
import { computeSplit, nightsByStop, splitGaps, type SplitInput } from "./split";

const offer = (id: string, amount: number, currency: string, kind: "live" | "estimated" = "live") => ({
  id,
  price: { amount, currency },
  kind,
});

// The demo: Ann and Bo take the train HK → Shanghai, Cy flies Seoul → Shanghai, all three fly on to Tokyo.
const demo = (): SplitInput => ({
  members: { ann: {}, bo: {}, cy: {} },
  legs: {
    hsr: { from: "hk", to: "sh", date: "2026-10-10", riders: ["ann", "bo"], search: { offers: [offer("t1", 1000, "HKD")] }, chosen: "t1", createdAt: 1 },
    icn: { from: "sel", to: "sh", date: "2026-10-10", riders: ["cy"], search: { offers: [offer("f1", 300000, "KRW", "estimated")] }, chosen: "f1", createdAt: 2 },
    nrt: { from: "sh", to: "tyo", date: "2026-10-13", riders: ["ann", "bo", "cy"], search: { offers: [offer("f2", 250, "USD")] }, chosen: "f2", createdAt: 3 },
  },
  stays: {
    sh: { nightly: { amount: 900, currency: "CNY" }, label: null },
    tyo: { nightly: { amount: 30000, currency: "JPY" }, label: "Shinjuku apartment" },
  },
  ends: "2026-10-16",
});

describe("computeSplit", () => {
  it("splits each night among whoever is there and keeps currencies apart", () => {
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
  });

  it("raises everyone else's share when one member leaves early", () => {
    const plan = demo();
    plan.members!.cy = { leaves: "2026-10-15" };
    const split = computeSplit(plan);
    expect(split.nights.at(-1)!.present).toEqual(["ann", "bo"]);
    expect(split.members.cy!.totals.JPY).toBe(20000);
    expect(split.members.ann!.totals.JPY).toBe(35000);
  });

  it("charges no nights at home, so a leg back ends them", () => {
    const plan = demo();
    plan.legs!.home = { from: "tyo", to: "sel", date: "2026-10-14", riders: ["cy"], search: { offers: [] }, chosen: null, createdAt: 4 };
    const split = computeSplit(plan);
    expect(split.nights.filter((n) => n.stop === "sel")).toEqual([]);
    expect(split.members.cy!.nightShares.filter((n) => n.stop === "tyo").map((n) => n.date)).toEqual(["2026-10-13"]);
    expect(split.members.cy!.missing).toEqual(["no_chosen_offer"]);
  });

  it("flags stops nobody has priced and leaves them out of totals", () => {
    const plan = demo();
    delete plan.stays!.tyo;
    const split = computeSplit(plan);
    expect(split.members.bo!.missing).toEqual(["no_stay_cost"]);
    expect(split.members.bo!.totals).toEqual({ HKD: 1000, CNY: 900, USD: 250 });
  });

  it("ends the morning after the latest leg or on a leave date when no end is set", () => {
    const plan = demo();
    plan.ends = null;
    expect(computeSplit(plan).nights.filter((n) => n.stop === "tyo").map((n) => n.date)).toEqual(["2026-10-13"]);
    plan.members!.ann = { leaves: "2026-10-15" };
    const split = computeSplit(plan);
    expect(split.ends).toBe("2026-10-15");
    expect(split.nights.filter((n) => n.stop === "tyo").map((n) => n.date)).toEqual(["2026-10-13", "2026-10-14"]);
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
  it("names nothing when every leg is picked and every night priced", () => {
    expect(splitGaps(computeSplit(demo()))).toEqual({ legs: [], stops: [] });
  });

  it("names legs with no pick and stops nobody has priced", () => {
    const plan = demo();
    plan.legs!.icn!.chosen = null;
    delete plan.stays!.tyo;
    expect(splitGaps(computeSplit(plan))).toEqual({ legs: ["icn"], stops: ["tyo"] });
  });
});

describe("overnight destination nights", () => {
  it("starts on local arrival, excludes the return travel night, and defaults end after arrival", () => {
    const plan: SplitInput = { members: { ann: {} }, legs: {
      out: { from: "hk", to: "london", date: "2026-11-15", riders: ["ann"], createdAt: 1, chosen: "out",
        search: { offers: [{ id: "out", kind: "live", price: null, depart: "2026-11-15T23:00:00+08:00", arrive: "2026-11-16T05:00:00+00:00" }] } },
    } };
    expect(computeSplit(plan).nights.map((n) => n.date)).toEqual(["2026-11-16"]);
    expect(computeSplit(plan).ends).toBe("2026-11-17");
    plan.legs!.back = { from: "london", to: "hk", date: "2026-11-18", riders: ["ann"], createdAt: 2, chosen: null, search: { offers: [] } };
    expect(computeSplit(plan).nights.map((n) => n.date)).toEqual(["2026-11-16", "2026-11-17"]);
    plan.members!.ann.leaves = "2026-11-17";
    expect(computeSplit(plan).nights.map((n) => n.date)).toEqual(["2026-11-16"]);
  });
  it("keeps previous-day arrivals and does not allocate a night in flight to late riders", () => {
    const plan: SplitInput = { members: { ann: {}, bo: {} }, ends: "2026-11-17", legs: {
      ann: { from: "tokyo", to: "sf", date: "2026-11-15", riders: ["ann"], createdAt: 1, chosen: "a",
        search: { offers: [{ id: "a", kind: "cached", price: null, arrive: "2026-11-14T17:30:00-08:00" }] } },
      bo: { from: "hk", to: "sf", date: "2026-11-15", riders: ["bo"], createdAt: 2, chosen: "b",
        search: { offers: [{ id: "b", kind: "live", price: null, arrive: "2026-11-16T05:00:00-08:00" }] } },
    } };
    expect(computeSplit(plan).nights.map((n) => [n.date, n.present])).toEqual([
      ["2026-11-14", ["ann"]], ["2026-11-15", ["ann"]], ["2026-11-16", ["ann", "bo"]],
    ]);
  });
});
