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

  it("does not relabel ferries as buses when both modes are requested", async () => {
    const offers = await twelveGo.search({ ...query, modes: ["flight", "ferry", "bus"] }, new AbortController().signal);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((offer) => offer.mode === "ferry" && offer.segments[0].mode === "ferry")).toBe(true);
    expect(offers.every((offer) => offer.id.startsWith("12go:ferry:") && offer.attribution)).toBe(true);
  });

  it("searches buses too when an empty mode list means all modes", async () => {
    // Add an isolated fixture to exercise the all-modes contract independently
    // of the production seed's evolving route coverage.
    const route = { ...routesFor("ferry")[0] };
    routesFor("bus").push(route);
    try {
      const allModes = { ...query, from: route.from, to: route.to, modes: [] };
      expect(twelveGo.covers(allModes)).toBe(true);
      const offers = await twelveGo.search(allModes, new AbortController().signal);
      expect(offers.some((offer) => offer.mode === "bus" && offer.id.startsWith("12go:bus:"))).toBe(true);
    } finally {
      routesFor("bus").pop();
    }
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

describe("12Go bus seed", () => {
  const busQuery = (from: SearchQuery["from"], to: SearchQuery["to"]): SearchQuery => ({
    ...query,
    from,
    to,
    modes: ["bus"],
  });
  const hanoi = { name: "Hanoi", lat: 21.03, lng: 105.85 };
  const sapa = { name: "Sapa", lat: 22.34, lng: 103.84 };
  const hcmc = { name: "Ho Chi Minh City", lat: 10.78, lng: 106.7 };
  const phnomPenh = { name: "Phnom Penh", lat: 11.56, lng: 104.92 };

  it("returns a 12Go bus offer for Hanoi to Sapa", async () => {
    const offers = await twelveGo.search(busQuery(hanoi, sapa), new AbortController().signal);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((offer) => offer.mode === "bus" && offer.kind === "timetable")).toBe(true);
    expect(offers[0].bookingUrl).toBe("https://12go.asia/en/travel/hanoi/sapa");
  });

  it("returns a bus offer with a 12Go link for Ho Chi Minh City to Phnom Penh", async () => {
    const q = busQuery(hcmc, phnomPenh);
    expect(twelveGo.covers(q)).toBe(true);
    const offers = await twelveGo.search(q, new AbortController().signal);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]).toMatchObject({
      provider: "12go",
      mode: "bus",
      bookingUrl: "https://12go.asia/en/travel/ho-chi-minh-city/phnom-penh",
    });
    expect(offers[0].segments[0]).toMatchObject({
      from: { slug: "ho-chi-minh-city" },
      to: { slug: "phnom-penh" },
      depart: "2026-11-15T08:00:00+07:00",
    });
  });

  it("serves the reverse direction with the reverse 12Go link", async () => {
    const offers = await twelveGo.search(busQuery(phnomPenh, hcmc), new AbortController().signal);
    expect(offers[0].bookingUrl).toBe("https://12go.asia/en/travel/phnom-penh/ho-chi-minh-city");
  });

  it("leaves ferry searches unaffected", async () => {
    const ferryOffers = await twelveGo.search(query, new AbortController().signal);
    expect(ferryOffers.every((offer) => offer.mode === "ferry")).toBe(true);
    const defaultModes = await twelveGo.search({ ...busQuery(hanoi, sapa), modes: [] }, new AbortController().signal);
    // The shared query contract defines an empty mode list as all modes.
    expect(defaultModes.length).toBeGreaterThan(0);
    expect(defaultModes.every((offer) => offer.mode === "bus")).toBe(true);
    expect(twelveGo.covers({ ...busQuery(hanoi, sapa), modes: ["ferry"] })).toBe(false);
  });

  it("ships at least ten cited bus routes with valid times", () => {
    const routes = routesFor("bus");
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const route of routes) {
      expect(route.source).toMatch(/^https?:\/\//);
      expect(route.source).not.toContain("12go.asia");
      expect(route.departures.length).toBeGreaterThan(0);
      expect(route.departures.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))).toBe(true);
      expect(route.durationMin).toBeGreaterThan(0);
      expect(route.from.slug).toMatch(/^[a-z0-9-]+$/);
      expect(route.to.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
