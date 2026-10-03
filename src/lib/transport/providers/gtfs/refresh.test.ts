import { describe, expect, it } from "vitest";
import { assertHorizon, replaceFeedPairs } from "./refresh";
import type { PairFile } from "./schema";
const pair = (feed: string): PairFile => ({
  from: "a", to: "b", stops: { [feed + ":a"]: { name: "A", lat: 0, lng: 0 }, [feed + ":b"]: { name: "B", lat: 1, lng: 1 } },
  services: { [feed + ":s"]: { start: "20260101", end: "20261231", days: [1, 1, 1, 1, 1, 1, 1], add: [], remove: [] } },
  departures: [{ id: feed + ":d", feed, op: feed, mode: "train", tz: "Asia/Kuala_Lumpur", svc: feed + ":s", from: feed + ":a", to: feed + ":b", dep: 0, arr: 60 }],
});
describe("independent GTFS refresh", () => {
  it("removes withdrawn services while preserving another publisher on the same pair", () => {
    const a = pair("ktmb"), b = pair("namtang");
    const existing = { a__b: { ...a, stops: { ...a.stops, ...b.stops }, services: { ...a.services, ...b.services }, departures: [...a.departures, ...b.departures] } };
    expect(replaceFeedPairs(existing, {}, "ktmb")).toEqual({ a__b: b });
    expect(existing.a__b.departures).toHaveLength(2);
  });
  it("drops a fully withdrawn pair and adds new pairs", () => {
    expect(replaceFeedPairs({ a__b: pair("ktmb") }, {}, "ktmb")).toEqual({});
    expect(replaceFeedPairs({}, { a__b: pair("ktmb") }, "ktmb")).toEqual({ a__b: pair("ktmb") });
  });
  it("rejects replacement content belonging to a different publisher", () => {
    expect(() => replaceFeedPairs({}, { a__b: pair("namtang") }, "ktmb")).toThrow();
  });
  it("checks real calendar days across months without extending upstream service dates", () => {
    expect(assertHorizon("20261017", "20261003", 7)).toBe(14);
    expect(assertHorizon("20261102", "20261031", 2)).toBe(2);
    expect(() => assertHorizon("20261017", "20261018", 0)).toThrow("upstream refresh required");
    expect(() => assertHorizon("20261017", "20261012", 7)).toThrow();
    expect(() => assertHorizon("20260230", "20260201", 0)).toThrow("Invalid");
  });
});
