import { describe, expect, it } from "vitest";

import { allPaid, bookingDeadline, fromMinorUnits, minorUnits, openSeats, priceRose, roundMoney, splitShares } from "./shares";

describe("splitShares", () => {
  it("puts the rounding remainder on whoever settled, so shares add up to the total", () => {
    const shares = splitShares({ amount: 100, currency: "USD" }, ["a", "b", "c"], "b");
    expect(shares).toEqual({ a: { amount: 33.33, currency: "USD" }, b: { amount: 33.34, currency: "USD" }, c: { amount: 33.33, currency: "USD" } });
    expect(Object.values(shares).reduce((s, m) => s + minorUnits(m), 0)).toBe(10_000);
  });

  it("splits whole yen, never fractions", () => {
    const shares = splitShares({ amount: 10001, currency: "JPY" }, ["a", "b"], "a");
    expect(shares).toEqual({ a: { amount: 5001, currency: "JPY" }, b: { amount: 5000, currency: "JPY" } });
  });

  it("falls back to the first rider when the settler isn't riding", () => {
    expect(splitShares({ amount: 1, currency: "USD" }, ["a", "b", "c"], "zed")).toEqual({
      a: { amount: 0.34, currency: "USD" }, b: { amount: 0.33, currency: "USD" }, c: { amount: 0.33, currency: "USD" },
    });
    expect(splitShares({ amount: 1, currency: "USD" }, [], "zed")).toEqual({});
  });
});

describe("minor units", () => {
  it("counts cents for most currencies and whole units for yen and won", () => {
    expect(minorUnits({ amount: 147.12, currency: "USD" })).toBe(14712);
    expect(minorUnits({ amount: 25000, currency: "JPY" })).toBe(25000);
    expect(minorUnits({ amount: 30000, currency: "KRW" })).toBe(30000);
    expect(fromMinorUnits(14712, "USD")).toBe(147.12);
    expect(roundMoney(1.005, "USD")).toBe(1); // float: 1.005 * 100 is 100.49999
    expect(roundMoney(1.5, "JPY")).toBe(2);
  });
});

describe("bookingDeadline", () => {
  it("takes the earliest limit less an hour", () => {
    expect(
      bookingDeadline({
        priceGuaranteeExpiresAt: "2026-10-05T11:38:07Z",
        paymentRequiredBy: "2026-10-06T11:38:07Z",
        captureBefore: ["2026-10-10T00:00:00Z", null],
      }),
    ).toBe("2026-10-05T10:38:07.000Z");
  });

  it("lets a short card hold bind", () => {
    expect(bookingDeadline({ paymentRequiredBy: "2026-10-06T00:00:00Z", captureBefore: ["2026-10-04T12:00:00Z"] })).toBe("2026-10-04T11:00:00.000Z");
  });

  it("is unknown without any limit", () => {
    expect(bookingDeadline({})).toBeNull();
    expect(bookingDeadline({ priceGuaranteeExpiresAt: "soon" })).toBeNull();
  });
});

describe("seats", () => {
  it("opens one unpaid seat per share and knows when everyone has paid", () => {
    const seats = openSeats({ a: { amount: 1, currency: "USD" }, b: { amount: 1, currency: "USD" } });
    expect(seats.a).toEqual({ share: { amount: 1, currency: "USD" }, details: false, paid: false });
    expect(allPaid(seats)).toBe(false);
    expect(allPaid({ a: { ...seats.a, paid: true }, b: { ...seats.b, paid: true } })).toBe(true);
    expect(allPaid({})).toBe(true);
  });
});

describe("priceRose", () => {
  it("lets a small rise or any drop through, and stops a real rise or a new currency", () => {
    expect(priceRose({ amount: 147.12, currency: "USD" }, { amount: 149.5, currency: "USD" })).toBe(false);
    expect(priceRose({ amount: 147.12, currency: "USD" }, { amount: 120, currency: "USD" })).toBe(false);
    expect(priceRose({ amount: 147.12, currency: "USD" }, { amount: 151, currency: "USD" })).toBe(true);
    expect(priceRose({ amount: 147.12, currency: "USD" }, { amount: 147.12, currency: "EUR" })).toBe(true);
    expect(priceRose(null, { amount: 1, currency: "USD" })).toBe(true);
    expect(priceRose({ amount: 100, currency: "JPY" }, { amount: 103, currency: "JPY" })).toBe(false);
    expect(priceRose({ amount: 100, currency: "JPY" }, { amount: 104, currency: "JPY" })).toBe(true);
  });
});
