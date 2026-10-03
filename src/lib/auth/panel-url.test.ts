import { describe, expect, it } from "vitest";

import { panelUrl } from "./panel-url";

describe("panelUrl", () => {
  it("opens the panel over the page you came from", () => {
    expect(panelUrl("/t/abcdefghijklmnop", "signin")).toBe("/t/abcdefghijklmnop?auth=signin");
  });
  it("keeps that page's own params", () => {
    expect(panelUrl("/t/abcdefghijklmnop?pip=open", "signup")).toBe("/t/abcdefghijklmnop?pip=open&auth=signup");
  });
  it("falls back to the globe for unsafe or missing targets", () => {
    expect(panelUrl("//evil.com", "signin")).toBe("/?auth=signin");
    expect(panelUrl(undefined, "signin")).toBe("/?auth=signin");
  });
});
