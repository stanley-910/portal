import { describe, expect, it } from "vitest";
import { safeNext } from "./next";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/t/abc")).toBe("/t/abc");
    expect(safeNext("/design?x=1")).toBe("/design?x=1");
  });
  it.each(["//evil.com", "https://evil.com", "javascript:alert(1)", "", "evil.com", "/\\evil.com", "/\t/evil.com"])(
    "rejects %j",
    (raw) => expect(safeNext(raw)).toBe("/"),
  );
  it("rejects non-strings", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
