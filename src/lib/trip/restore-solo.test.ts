import { describe, expect, it } from "vitest";
import { restoreSolo } from "./restore-solo";

const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const from = { name: "Hong Kong", lat: 22.31, lng: 114.17, hub: "air:HKG", code: "HKG" };
const to = { name: "Shanghai", lat: 31.23, lng: 121.47, hub: "air:PVG", code: "PVG" };
const offer = { id: "duffel:one", provider: "duffel", mode: "flight", kind: "live", price: { amount: 120, currency: "USD" }, segments: [{ mode: "flight", from, to, depart: `${date}T08:00:00+08:00`, arrive: `${date}T10:00:00+08:00`, durationMin: 120 }] };
const leg = { from, to, date, offers: [offer], chosen: offer.id, stay: { label: "Stay", nightly: { amount: 90, currency: "USD" }, estimated: true } };

describe("resume Save after authentication", () => {
  it("restores exact clicked points, date, chosen fare and stay after JSON storage", () => {
    const restored = restoreSolo(JSON.parse(JSON.stringify({ legs: [leg] })))!;
    expect(restored.legs[0].origin).toEqual(from);
    expect(restored.legs[0].destination).toEqual(to);
    expect(restored.legs[0].departDate.getDate()).toBe(new Date(`${date}T00:00`).getDate());
    expect(restored.picks[0]).toMatchObject({ depart: date, offer: { id: offer.id }, stay: leg.stay });
  });
  it.each([
    { ...leg, from: { ...from, lat: 999 } },
    { ...leg, chosen: "missing" },
    { ...leg, date: "broken" },
    { ...leg, offers: [{ ...offer, bookingUrl: "javascript:alert(1)" }] },
  ])("refuses malformed or unsafe pending data %#", (invalid) => {
    expect(restoreSolo({ legs: [invalid] })).toBeNull();
  });
  it("caps restored legs and refuses empty saves", () => {
    expect(restoreSolo({ legs: Array(10).fill(leg) })).toBeNull();
    expect(restoreSolo({ legs: [] })).toBeNull();
  });
});
