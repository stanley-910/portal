import { describe, expect, it } from "vitest";

import { airlineLogoUrl } from "./airline-logos";

describe("airlineLogoUrl", () => {
  it("points at Duffel's logo for an airline in the snapshot", () => {
    expect(airlineLogoUrl("CX")).toBe("https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/CX.svg");
    expect(airlineLogoUrl(" cx ")).toBe(airlineLogoUrl("CX"));
  });
  it("gives null without a code or a logo", () => {
    expect(airlineLogoUrl(undefined)).toBeNull();
    expect(airlineLogoUrl("")).toBeNull();
    expect(airlineLogoUrl("Cathay Pacific")).toBeNull();
  });
});
