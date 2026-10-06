import { describe, expect, it } from "vitest";
import { clockOfIso, formatClock } from "./clock";

describe("formatClock", () => {
  it("shows 12-hour by default, with midnight and noon as 12", () => {
    expect(["00:05", "09:30", "12:00", "20:27"].map((t) => formatClock(t))).toEqual(["12:05 AM", "9:30 AM", "12:00 PM", "8:27 PM"]);
  });
  it("keeps HH:MM for 24-hour and leaves anything else alone", () => {
    expect(formatClock("9:30", "24")).toBe("09:30");
    expect(formatClock("--:--")).toBe("--:--");
  });
  it("reads the local time an ISO timestamp was written in", () => {
    expect(clockOfIso("2026-11-15T20:27:00+08:00")).toBe("8:27 PM");
  });
});
