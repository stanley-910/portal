import { describe, expect, it } from "vitest";

import { countries, countryName, flagEmoji, MAX_NATIONALITIES, parseNationalities } from "./nationality";

describe("nationalities", () => {
  it("keeps valid, distinct ISO-3 codes in order", () => {
    expect(parseNationalities(["us", "CAN", "USA", "XXX", 4])).toEqual(["USA", "CAN"]);
    expect(parseNationalities("HK,gbr")).toEqual(["HKG", "GBR"]);
    expect(parseNationalities(null)).toEqual([]);
    expect(parseNationalities(["USA", "CAN", "GBR", "FRA", "DEU"])).toHaveLength(MAX_NATIONALITIES);
  });

  it("names countries and draws their flags", () => {
    expect(flagEmoji("CAN")).toBe("🇨🇦");
    expect(flagEmoji("nope")).toBe("");
    expect(countryName("USA")).toBe("United States");
    expect(countryName("HK")).toBe("Hong Kong");
    expect(countries().some((c) => c.code === "HKG")).toBe(true);
  });
});
