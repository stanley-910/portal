import { describe, expect, it } from "vitest";

import { stayDates } from "./leg-edit";

const leg = (from: string, to: string, date: string, riders: string[]) => ({ from, to, date, riders });

// The demo: Ann and Bo take the train HK → Shanghai, Cy flies Seoul → Shanghai a day later, all three fly on to Tokyo.
const legs = [
  leg("hk", "sh", "2026-10-10", ["ann", "bo"]),
  leg("sel", "sh", "2026-10-11", ["cy"]),
  leg("sh", "tyo", "2026-10-13", ["ann", "bo", "cy"]),
];

describe("stayDates", () => {
  it("runs from the leg's arrival to its riders' next leg out of the stop", () => {
    expect(stayDates(legs, legs[0]!)).toEqual({ checkIn: "2026-10-10", checkOut: "2026-10-13", people: 2 });
    expect(stayDates(legs, legs[1]!)).toEqual({ checkIn: "2026-10-11", checkOut: "2026-10-13", people: 1 });
  });

  it("is one night at the last stop, with no leg out", () => {
    expect(stayDates(legs, legs[2]!)).toEqual({ checkIn: "2026-10-13", checkOut: "2026-10-14", people: 3 });
  });

  it("ends at anyone's leg out when its riders haven't drawn theirs", () => {
    const more = [...legs, leg("sh", "bkk", "2026-10-12", ["dee"])];
    expect(stayDates(more, leg("x", "sh", "2026-10-11", ["eve"]))).toEqual({ checkIn: "2026-10-11", checkOut: "2026-10-12", people: 1 });
  });

  it("starts on the known arrival rather than the departure day", () => {
    expect(stayDates([], { to: "lhr", date: "2026-11-15", arrival: "2026-11-16", riders: ["ann"] })).toEqual({ checkIn: "2026-11-16", checkOut: "2026-11-17", people: 1 });
    expect(stayDates([], { to: "sfo", date: "2026-11-15", arrival: "2026-11-14", riders: [] }).checkIn).toBe("2026-11-14");
  });
});
