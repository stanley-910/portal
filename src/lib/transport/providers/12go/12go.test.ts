import { describe, expect, it, afterEach } from "vitest";

import { routesFor, twelveGo } from "./index";
import { tagged, twelveGoUrl } from "./links";
import type { SearchQuery } from "../../types";

const query: SearchQuery = {
  from: { name: "Surat Thani", lat: 9.13, lng: 99.14 },
  to: { name: "Koh Samui", lat: 9.51, lng: 100.01 },
  date: "2026-11-15",
  modes: ["ferry"],
  passengers: 1,
  currency: "USD",
};

const originalMarker = process.env.TRAVELPAYOUTS_MARKER;
const originalAffiliateId = process.env.TWELVEGO_AFFILIATE_ID;

afterEach(() => {
  if (originalMarker === undefined) delete process.env.TRAVELPAYOUTS_MARKER;
  else process.env.TRAVELPAYOUTS_MARKER = originalMarker;
  if (originalAffiliateId === undefined) delete process.env.TWELVEGO_AFFILIATE_ID;
  else process.env.TWELVEGO_AFFILIATE_ID = originalAffiliateId;
});

describe("12Go links", () => {
  it("builds an English route URL", () => {
    expect(twelveGoUrl("Bangkok", "Koh Samui")).toBe("https://12go.asia/en/travel/bangkok/koh%20samui");
  });

  it("uses the Travelpayouts path when a marker is configured", () => {
    process.env.TRAVELPAYOUTS_MARKER = "marker";
    process.env.TWELVEGO_AFFILIATE_ID = "direct";
    expect(tagged("https://12go.asia/en/travel/bangkok/koh-samui")).toBe(
      "https://c44.travelpayouts.com/click?shmarker=marker&promo_id=1764&source_type=customlink&type=click&custom_url=https%3A%2F%2F12go.asia%2Fen%2Ftravel%2Fbangkok%2Fkoh-samui",
    );
  });

  it("uses a direct affiliate ID when no Travelpayouts marker is configured", () => {
    delete process.env.TRAVELPAYOUTS_MARKER;
    process.env.TWELVEGO_AFFILIATE_ID = "direct";
    expect(tagged("https://12go.asia/en/travel/bangkok/koh-samui")).toBe(
      "https://12go.asia/en/travel/bangkok/koh-samui?z=direct",
    );
  });

  it("leaves the route untagged when neither program is configured", () => {
    delete process.env.TRAVELPAYOUTS_MARKER;
    delete process.env.TWELVEGO_AFFILIATE_ID;
    expect(tagged("https://12go.asia/en/travel/bangkok/koh-samui")).toBe("https://12go.asia/en/travel/bangkok/koh-samui");
  });
});

describe("12Go ferry adapter", () => {
  it("returns timetable offers for a nearby seeded route", async () => {
    const offers = await twelveGo.search(query, new AbortController().signal);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]).toMatchObject({
      provider: "12go",
      mode: "ferry",
      kind: "timetable",
      bookingUrl: "https://12go.asia/en/travel/surat-thani-airport/koh-samui",
    });
    expect(offers[0].price).toBeUndefined();
    expect(offers[0].segments[0]).toMatchObject({
      depart: "2026-11-15T08:00:00+07:00",
      durationMin: 150,
    });
  });

  it("does not cover a query outside the snap radius", () => {
    expect(twelveGo.covers({
      ...query,
      from: { name: "Singapore", lat: 1.29, lng: 103.85 },
    })).toBe(false);
  });

  it("matches a seeded route in reverse", async () => {
    const offers = await twelveGo.search({ ...query, from: query.to, to: query.from }, new AbortController().signal);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].segments[0]).toMatchObject({
      from: { slug: "koh-samui" },
      to: { slug: "surat-thani-airport" },
    });
  });

  it("ships at least ten curated ferry routes", () => {
    expect(routesFor("ferry")).toHaveLength(10);
    expect(routesFor("ferry").every((route) => route.source && route.source.includes("://"))).toBe(true);
  });
});
