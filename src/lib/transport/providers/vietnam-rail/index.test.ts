import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import provider from "./index";
import { searchFromCoordinates } from "../../hub-search";
import { parseTimetable } from "./snapshot";
import type { SearchQuery } from "../../types";
const fixture = readFileSync(new URL("./__fixtures__/endpoints.html", import.meta.url), "utf8");
const query: SearchQuery = {
  from: { name: "Hanoi", lat: 21.0242, lng: 105.8408 }, to: { name: "Saigon", lat: 10.7822, lng: 106.6772 },
  date: "2026-10-31", modes: ["train"], passengers: 1, currency: "USD",
};
describe("Vietnam Railways official timetable snapshot", () => {
  it("extracts both directions and explicit arrival days from recorded endpoint rows", () => {
    const seed = parseTimetable(fixture, "2026-10-03");
    expect(seed.trains).toHaveLength(10);
    expect(seed.trains.find((t) => t.number === "SE1")).toMatchObject({ departMin: 21 * 60 + 45, arriveMin: 2 * 1440 + 6 * 60 + 30 });
    expect(seed.trains.find((t) => t.number === "SE8")).toMatchObject({ from: "saigon", arriveMin: 1440 + 16 * 60 + 20 });
  });
  it("fails closed on changed columns, missing grids and invalid hours", () => {
    expect(() => parseTimetable("<html>Error</html>", "2026-10-03")).toThrow("missing");
    expect(() => parseTimetable(fixture.replace("06:00", "99:00"), "2026-10-03")).toThrow("Invalid");
    expect(() => parseTimetable(fixture.replace(/<th scope="col"><font color="White"><b>SE7<\/b><\/font><\/th>/, ""), "2026-10-03")).toThrow("columns");
  });
  it("returns cited timetable-only offers without prices and rolls two days across a month", async () => {
    expect(provider.covers(query)).toBe(true);
    const offers = await provider.search(query, new AbortController().signal);
    expect(offers).toHaveLength(5);
    const se1 = offers.find((offer) => offer.segments[0].number === "SE1")!;
    expect(se1.segments[0].arrive).toBe("2026-11-02T06:30:00+07:00");
    for (const offer of offers) {
      expect(offer.kind).toBe("timetable"); expect(offer.price).toBeUndefined();
      expect(offer.attribution).toContain("https://giotaugiave.dsvn.vn/");
      expect(Date.parse(offer.segments[0].arrive) - Date.parse(offer.segments[0].depart)).toBe(offer.segments[0].durationMin * 60_000);
    }
  });
  it("survives the real hub-resolution and provider-validation pipeline", async () => {
    const result = await searchFromCoordinates(query, new AbortController().signal);
    expect(result.errors).toEqual([]);
    expect(result.offers.filter((o) => o.provider === "vietnam-rail")).toHaveLength(5);
    expect(Object.values(result.offerPairs).some((pairs) => pairs.length > 0)).toBe(true);
  });
  it("honours cancellation before local work", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.search(query, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("searches the reverse route and rejects mismatched modes or unrelated geography", async () => {
    expect(await provider.search({ ...query, from: query.to, to: query.from }, new AbortController().signal)).toHaveLength(5);
    expect(provider.covers({ ...query, modes: ["ferry"] })).toBe(false);
    expect(provider.covers({ ...query, to: query.from })).toBe(false);
    expect(provider.covers({ ...query, from: { name: "Bangkok", lat: 13.7, lng: 100.5 } })).toBe(false);
  });
});
