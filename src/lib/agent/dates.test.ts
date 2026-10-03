import { describe, expect, it } from "vitest";

import { dateIn } from "@/lib/agent/dates";

describe("dateIn", () => {
  const today = new Date("2026-10-03T12:00:00Z");
  it("reads day-month, month-day and ISO dates", () => {
    expect(dateIn("meet on 14 Nov?", today)).toBe("2026-11-14");
    expect(dateIn("Nov 14th works", today)).toBe("2026-11-14");
    expect(dateIn("by 2027-01-02", today)).toBe("2027-01-02");
  });
  it("rolls a date already past this year to next year", () => {
    expect(dateIn("on 2 Jan", today)).toBe("2027-01-02");
  });
  it("finds nothing in plain words", () => {
    expect(dateIn("sometime soon", today)).toBeNull();
    expect(dateIn("I'm in Hong Kong, Mei is in Seoul", today)).toBeNull();
  });
});
