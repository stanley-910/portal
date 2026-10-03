import { describe, expect, it } from "vitest";

import { editorChoice, stayDates } from "./leg-edit";
import { computeSplit, type SplitInput } from "./split";

describe("editorChoice", () => {
  it("shows the stored pick until this member clicks", () => {
    expect(editorChoice(undefined, "a", ["a", "b"])).toBe("a");
    expect(editorChoice(undefined, null, ["a", "b"])).toBeNull();
  });

  it("follows a pick someone else made after the editor opened", () => {
    // the editor never copies the stored pick, so a remote change shows straight away
    expect(editorChoice(undefined, "b", ["a", "b"])).toBe("b");
  });

  it("shows this member's click, including clearing the pick", () => {
    expect(editorChoice("b", "a", ["a", "b"])).toBe("b");
    expect(editorChoice(null, "a", ["a", "b"])).toBeNull();
  });

  it("drops a click on an option a new search replaced", () => {
    expect(editorChoice("old", null, ["a", "b"])).toBeNull();
    expect(editorChoice("old", "a", ["a", "b"])).toBe("a");
  });
});

const offer = { id: "o", price: { amount: 100, currency: "USD" }, kind: "live" as const };
const leg = (from: string, to: string, date: string, riders: string[], createdAt: number) => ({
  from, to, date, riders, search: { offers: [offer] }, chosen: "o", createdAt,
});

// The demo: Ann and Bo take the train HK → Shanghai, Cy flies Seoul → Shanghai a day later, all three fly on to Tokyo.
const demo = (): SplitInput => ({
  members: { ann: {}, bo: {}, cy: {} },
  legs: {
    hsr: leg("hk", "sh", "2026-10-10", ["ann", "bo"], 1),
    icn: leg("sel", "sh", "2026-10-11", ["cy"], 2),
    nrt: leg("sh", "tyo", "2026-10-13", ["ann", "bo", "cy"], 3),
  },
  ends: "2026-10-16",
});

const datesFor = (input: SplitInput, id: string) => {
  const split = computeSplit(input);
  const l = input.legs![id]!;
  return stayDates({ nights: split.nights, ends: split.ends, legs: Object.values(input.legs!) }, l);
};

describe("stayDates", () => {
  it("runs from the leg's arrival to the next leg out of the stop", () => {
    expect(datesFor(demo(), "hsr")).toEqual({ checkIn: "2026-10-10", checkOut: "2026-10-13", people: 3 });
  });

  it("covers the whole group's stay for someone who arrives later", () => {
    expect(datesFor(demo(), "icn")).toEqual({ checkIn: "2026-10-10", checkOut: "2026-10-13", people: 3 });
  });

  it("ends with the trip at the last stop", () => {
    expect(datesFor(demo(), "nrt")).toEqual({ checkIn: "2026-10-13", checkOut: "2026-10-16", people: 3 });
  });

  it("stops at the morning the last person leaves", () => {
    const input = demo();
    input.members = { ann: { leaves: "2026-10-14" }, bo: { leaves: "2026-10-14" }, cy: { leaves: "2026-10-15" } };
    expect(datesFor(input, "nrt")).toEqual({ checkIn: "2026-10-13", checkOut: "2026-10-15", people: 3 });
  });

  it("falls back to the next leg out, the trip's end or one night when nobody rides the leg", () => {
    const input = demo();
    input.legs!.hsr!.riders = [];
    input.legs!.icn!.riders = [];
    expect(datesFor(input, "hsr")).toEqual({ checkIn: "2026-10-10", checkOut: "2026-10-13", people: 1 });

    const last = demo();
    last.legs!.nrt!.riders = [];
    expect(datesFor(last, "nrt")).toEqual({ checkIn: "2026-10-13", checkOut: "2026-10-16", people: 1 });

    const open = demo();
    open.legs!.nrt!.riders = [];
    open.ends = null;
    // without an end date the trip ends the morning after its last leg, so the stay is one night
    expect(datesFor(open, "nrt")).toEqual({ checkIn: "2026-10-13", checkOut: "2026-10-14", people: 1 });
  });

  it("starts a new run when the group comes back to a stop", () => {
    const input: SplitInput = {
      members: { ann: {} },
      legs: {
        a: leg("hk", "sh", "2026-10-10", ["ann"], 1),
        b: leg("sh", "tyo", "2026-10-12", ["ann"], 2),
        c: leg("tyo", "sh", "2026-10-14", ["ann"], 3),
      },
      ends: "2026-10-16",
    };
    expect(datesFor(input, "a")).toEqual({ checkIn: "2026-10-10", checkOut: "2026-10-12", people: 1 });
    expect(datesFor(input, "c")).toEqual({ checkIn: "2026-10-14", checkOut: "2026-10-16", people: 1 });
  });
});

it("anchors the shared hotel run on known arrival instead of the departure day", () => {
  expect(stayDates({ nights: [
    { stop: "lhr", date: "2026-11-16", present: ["ann"] },
    { stop: "lhr", date: "2026-11-17", present: ["ann", "bo"] },
  ], ends: "2026-11-18", legs: [] }, { to: "lhr", date: "2026-11-15", arrival: "2026-11-16", riders: ["ann"] }))
    .toEqual({ checkIn: "2026-11-16", checkOut: "2026-11-18", people: 2 });
  expect(stayDates({ nights: [], ends: null, legs: [] }, { to: "sfo", date: "2026-11-15", arrival: "2026-11-14", riders: [] }).checkIn).toBe("2026-11-14");
});
