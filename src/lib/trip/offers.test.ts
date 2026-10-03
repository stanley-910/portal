import { describe, expect, it } from "vitest";

import type { Offer } from "@/lib/transport/types";

import { toStoredOffer, webUrlOrNull } from "./offers";

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

describe("webUrlOrNull", () => {
  it("accepts only http and https", () => {
    expect(webUrlOrNull("https://a.b")).toBe("https://a.b");
    expect(webUrlOrNull("ftp://a.b")).toBeNull();
    expect(webUrlOrNull(undefined)).toBeNull();
  });
});
