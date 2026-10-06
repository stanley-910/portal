import { describe, expect, it } from "vitest";

import { formatNear, parseNear } from "./near";

describe("where the person searching is", () => {
  it("rounds to about a kilometre and reads it back", () => {
    expect(formatNear({ lat: 47.606209, lng: -122.332071 })).toBe("47.61,-122.33");
    expect(parseNear("47.61,-122.33")).toEqual({ lat: 47.61, lng: -122.33 });
  });
  it.each([null, "", "47.61", "91,0", "0,181", "a,b", "47.61,-122.33;drop"])("ignores %j", (value) => {
    expect(parseNear(value)).toBeNull();
  });
});
