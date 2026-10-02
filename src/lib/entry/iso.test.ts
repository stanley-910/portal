import { describe, expect, it } from "vitest";

import { iso2, iso3 } from "./iso";

describe("iso", () => {
  it("maps territories the transport contract uses", () => {
    expect(iso3("HK")).toBe("HKG");
    expect(iso3("mo")).toBe("MAC");
    expect(iso3("TW")).toBe("TWN");
    expect(iso2("CHN")).toBe("CN");
  });

  it("passes known alpha-3 through and rejects unknown codes", () => {
    expect(iso3("GBR")).toBe("GBR");
    expect(iso3("ZZZ")).toBeUndefined();
    expect(iso3("Z")).toBeUndefined();
    expect(iso3(undefined)).toBeUndefined();
  });
});
