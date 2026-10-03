import { describe, expect, it } from "vitest";
import { arrivalDate } from "./arrival";
describe("destination stay dates", () => {
  it.each([
    ["2026-11-16T05:00:00+00:00", "2026-11-16"],
    ["2026-11-14T17:30:00-08:00", "2026-11-14"],
    ["2026-11-17T05:00:00+09:00", "2026-11-17"],
    ["2026-11-16T05:00:00Z", "2026-11-15"],
    ["invalid", "2026-11-15"],
  ])("uses a known local arrival date: %s", (arrive, expected) => {
    expect(arrivalDate("2026-11-15", { kind: "live", arrive })).toBe(expected);
  });
  it("keeps departure fallback for estimates, old records and retimed offers", () => {
    expect(arrivalDate("2026-11-15", { kind: "estimated", arrive: "2026-11-16T05:00:00+00:00" })).toBe("2026-11-15");
    expect(arrivalDate("2026-11-15", { kind: "live" })).toBe("2026-11-15");
    expect(arrivalDate("2026-11-15", { kind: "live", depart: "2026-11-12T23:00:00+08:00", arrive: "2026-11-13T05:00:00+00:00" })).toBe("2026-11-15");
  });
});
