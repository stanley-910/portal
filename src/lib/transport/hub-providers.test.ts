import { describe, expect, it } from "vitest";
import { searchFromCoordinates } from "./hub-search";
import type { SearchQuery } from "./types";

// Exercise real bundled adapters through the merged validation boundary. No
// flight mode, credentials, network mocks or external fetches are involved.
describe("hub search with surface providers from main", () => {
  it("retains Korean train fares with date-only seed freshness", async () => {
    const query: SearchQuery = {
      from: { name: "Seoul", lat: 37.55, lng: 126.97 },
      to: { name: "Busan", lat: 35.115, lng: 129.041 },
      date: "2026-11-01", modes: ["train"], passengers: 1, currency: "USD",
    };
    const result = await searchFromCoordinates(query, new AbortController().signal);
    expect(result.errors).toEqual([]);
    const trains = result.offers.filter((offer) => offer.provider === "korea-tago");
    expect(trains.length).toBeGreaterThan(0);
    expect(trains.every((offer) => offer.kind === "timetable")).toBe(true);
    expect(trains[0].price?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
