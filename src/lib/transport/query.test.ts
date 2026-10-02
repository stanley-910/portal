import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "./query";

const from = { name: "Hong Kong", lat: 22.3, lng: 114.2 };
const to = { name: "Shanghai", lat: 31.2, lng: 121.5 };
function url(overrides: Record<string, string> = {}) {
  return `http://localhost/api/transport/search?${new URLSearchParams({
    from: JSON.stringify(from), to: JSON.stringify(to), date: "2026-10-03", ...overrides,
  })}`;
}

describe("public transport query", () => {
  it("defaults all modes, one passenger and USD", () => {
    expect(parseSearchQuery(url())).toEqual({ from, to, date: "2026-10-03", modes: [], passengers: 1, currency: "USD" });
  });

  it("normalizes identifiers without stripping provider place IDs", () => {
    const result = parseSearchQuery(url({
      from: JSON.stringify({ ...from, country: "hk", iata: "hkg", providerIds: { "12go": "hong-kong" } }),
      currency: "hkd", modes: "flight,train,flight",
    }));
    expect(result.from).toMatchObject({ country: "HK", iata: "HKG", providerIds: { "12go": "hong-kong" } });
    expect(result.currency).toBe("HKD");
    expect(result.modes).toEqual(["flight", "train"]);
  });

  it.each(["2026-02-30", "2026-02-29", "2026-13-01", "26-10-03"])("rejects impossible date %s", (date) => {
    expect(() => parseSearchQuery(url({ date }))).toThrow();
  });
  it("accepts leap day", () => expect(parseSearchQuery(url({ date: "2028-02-29" })).date).toBe("2028-02-29"));
  it.each([null, "", "22.3", 91])("rejects invalid latitude %s rather than coercing", (lat) => {
    expect(() => parseSearchQuery(url({ from: JSON.stringify({ ...from, lat }) }))).toThrow();
  });
  it.each<Record<string, string>>([{ from: "{" }, { modes: "car" }, { passengers: "0" }, { passengers: "1.5" }])("rejects invalid query %j", (input) => {
    expect(() => parseSearchQuery(url(input))).toThrow();
  });
});
