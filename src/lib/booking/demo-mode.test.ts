import { afterEach, describe, expect, it, vi } from "vitest";

import { cheapestOffer } from "./offer";

// The demo flag is read when a module loads, so each case loads fresh modules with the env it wants.
const fresh = async (demo: boolean) => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEMO_BOOKING", demo ? "1" : "");
  return { ready: await import("./ready"), offers: await import("@/lib/trip/offers") };
};
afterEach(() => vi.unstubAllEnvs());

const leg = (chosen: string) => ({
  riders: ["a"],
  chosen,
  search: { offers: [
    { id: "tp:1", provider: "travelpayouts", kind: "cached", price: { amount: 80, currency: "USD" } },
    { id: "12go:1", provider: "12go", kind: "timetable", price: null },
    { id: "duffel:off_1", provider: "duffel", kind: "live", price: { amount: 70, currency: "USD" } },
  ] as never[] },
});

describe("demo booking mode", () => {
  it("is off by default: only live Duffel offers settle", async () => {
    const { ready, offers } = await fresh(false);
    expect(offers.isBookable(leg("tp:1").search.offers[0])).toBe(false);
    expect(ready.settleReady(leg("tp:1"), "a")).toMatchObject({ ok: false });
    expect(ready.settleReady(leg("duffel:off_1"), "a")).toMatchObject({ ok: true, offerId: "off_1" });
  });
  it("on: any priced pick settles, a non-Duffel one with no Duffel offer id; unpriced timetables stay out", async () => {
    const { ready, offers } = await fresh(true);
    expect(offers.isBookable(leg("tp:1").search.offers[0])).toBe(true);
    expect(offers.isBookable(leg("12go:1").search.offers[1])).toBe(false);
    expect(ready.settleReady(leg("tp:1"), "a")).toMatchObject({ ok: true, offerId: null });
    expect(ready.settleReady(leg("12go:1"), "a")).toMatchObject({ ok: false });
    expect(ready.settleReady(leg("duffel:off_1"), "a")).toMatchObject({ ok: true, offerId: "off_1" });
  });
});

const raw = (id: string, total: string, instant: boolean, passengers = 1) => ({
  id, total_amount: total, total_currency: "USD", expires_at: "2030-01-01T00:00:00Z", owner: { name: "X" },
  passengers: Array.from({ length: passengers }, (_, i) => ({ id: `p${i}` })),
  payment_requirements: { requires_instant_payment: instant, payment_required_by: null, price_guarantee_expires_at: null },
  slices: [{ segments: [{ origin: { iata_code: "HKG" }, destination: { iata_code: "PVG" }, departing_at: "2030-01-01T08:00:00", arriving_at: "2030-01-01T10:00:00", marketing_carrier: { iata_code: "XX", name: "X Air" }, marketing_carrier_flight_number: "1" }] }],
});
describe("cheapestOffer", () => {
  it("prefers a holdable offer, then the lowest price, for the right seat count", () => {
    const best = cheapestOffer([raw("cheap-instant", "50.00", true), raw("hold-dear", "90.00", false), raw("hold-cheap", "80.00", false), raw("two-seats", "10.00", false, 2)], 1);
    expect(best?.id).toBe("hold-cheap");
    expect(cheapestOffer([raw("a", "50.00", true)], 2)).toBeNull();
  });
});
