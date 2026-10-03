import { describe, expect, it } from "vitest";

import type { Offer } from "@/lib/transport/types";

import { isBookable, keepOffers, shownOffers, toStoredOffer, webUrlOrNull } from "./offers";

const offer = (bookingUrl?: string): Offer => ({
  id: "travelpayouts:CX1",
  provider: "travelpayouts",
  mode: "flight",
  kind: "cached",
  segments: [
    {
      mode: "flight",
      carrier: "Cathay Pacific",
      from: { name: "Hong Kong", lat: 22.31, lng: 113.92 },
      to: { name: "Shanghai", lat: 31.14, lng: 121.81 },
      depart: "2099-10-04T08:00:00+08:00",
      arrive: "2099-10-04T10:30:00+08:00",
      durationMin: 150,
    },
  ],
  price: { amount: 120, currency: "USD" },
  bookingUrl,
});

describe("toStoredOffer", () => {
  it("keeps http(s) booking links", () => {
    expect(toStoredOffer(offer("https://example.com/book?x=1")).bookingUrl).toBe("https://example.com/book?x=1");
    expect(toStoredOffer(offer("http://example.com/")).bookingUrl).toBe("http://example.com/");
  });

  it("drops any other booking link", () => {
    for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "/relative", "not a url", ""]) {
      expect(toStoredOffer(offer(url)).bookingUrl).toBeNull();
    }
    expect(toStoredOffer(offer()).bookingUrl).toBeNull();
  });

  it("trims to the stored fields", () => {
    expect(toStoredOffer(offer("https://example.com/"))).toEqual({
      id: "travelpayouts:CX1",
      provider: "travelpayouts",
      mode: "flight",
      kind: "cached",
      price: { amount: 120, currency: "USD" },
      carrier: "Cathay Pacific",
      depart: "2099-10-04T08:00:00+08:00",
      arrive: "2099-10-04T10:30:00+08:00",
      durationMin: 150,
      stops: 0,
      bookingUrl: "https://example.com/",
      attribution: null,
    });
  });
});

describe("toStoredOffer carrierCode", () => {
  it("keeps the first segment's airline code for its logo", () => {
    const o = offer();
    o.segments[0] = { ...o.segments[0], carrierCode: "CX" };
    expect(toStoredOffer(o).carrierCode).toBe("CX");
  });
});

describe("webUrlOrNull", () => {
  it("accepts only http and https", () => {
    expect(webUrlOrNull("https://a.b")).toBe("https://a.b");
    expect(webUrlOrNull("ftp://a.b")).toBeNull();
    expect(webUrlOrNull(undefined)).toBeNull();
  });
});

describe("toStoredOffer flights", () => {
  it("keeps each flight's number, airports and departure when every segment has them", () => {
    const o = offer();
    o.segments[0] = { ...o.segments[0], number: "CX364", from: { ...o.segments[0].from, iata: "HKG" }, to: { ...o.segments[0].to, iata: "PVG" } };
    expect(toStoredOffer(o).flights).toEqual([{ number: "CX364", from: "HKG", to: "PVG", depart: "2099-10-04T08:00:00+08:00" }]);
  });

  it("leaves them out when a segment lacks one", () => {
    expect(toStoredOffer(offer())).not.toHaveProperty("flights");
  });
});

const ranked = (...providers: string[]) => providers.map((provider, i) => ({ id: `${provider}:${i}`, provider }));

describe("keepOffers", () => {
  it("keeps each provider's best few before filling by rank, in ranked order", () => {
    const offers = ranked(...Array(10).fill("duffel"), "china-rail", "travelpayouts");
    const kept = keepOffers(offers, null, 6);
    expect(kept.map((o) => o.id)).toEqual(["duffel:0", "duffel:1", "duffel:2", "duffel:3", "china-rail:10", "travelpayouts:11"]);
  });

  it("always keeps the pick, even past the cut", () => {
    const offers = ranked(...Array(30).fill("travelpayouts"), "duffel");
    const kept = keepOffers(offers, "travelpayouts:25", 5);
    expect(kept).toHaveLength(5);
    expect(kept.map((o) => o.id)).toContain("travelpayouts:25");
    expect(kept.map((o) => o.id)).toContain("duffel:30");
  });

  it("keeps everything under the cap", () => {
    const offers = ranked("duffel", "gtfs");
    expect(keepOffers(offers)).toEqual(offers);
  });
});

describe("shownOffers", () => {
  it("swaps a pick further down in for the last shown option", () => {
    const offers = ranked("a", "b", "c", "d", "e");
    expect(shownOffers(offers, "e:4", 3).map((o) => o.id)).toEqual(["a:0", "b:1", "e:4"]);
    expect(shownOffers(offers, "b:1", 3).map((o) => o.id)).toEqual(["a:0", "b:1", "c:2"]);
    expect(shownOffers(offers, null, 3)).toHaveLength(3);
  });
});

describe("isBookable", () => {
  it("is only a live Duffel fare", () => {
    expect(isBookable({ provider: "duffel", kind: "live" })).toBe(true);
    expect(isBookable({ provider: "duffel", kind: "cached" })).toBe(false);
    expect(isBookable({ provider: "travelpayouts", kind: "live" })).toBe(false);
  });
});
