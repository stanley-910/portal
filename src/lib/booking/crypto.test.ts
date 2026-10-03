import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { open, parseKey, seal } from "./crypto";

describe("sealed traveller details", () => {
  const key = parseKey(randomBytes(32).toString("base64"));

  it("round-trips and never repeats a token", () => {
    const plain = JSON.stringify({ givenName: "Amelia", passport: "A1234567" });
    const a = seal(plain, key);
    const b = seal(plain, key);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe(plain);
    expect(open(b, key)).toBe(plain);
  });

  it("refuses another key, a tampered token and junk", () => {
    const token = seal("secret", key);
    expect(open(token, parseKey(randomBytes(32).toString("base64")))).toBeNull();
    const [iv, tag, body] = token.split(".");
    expect(open([iv, tag, body.slice(0, -2) + "AA"].join("."), key)).toBeNull();
    expect(open("not.a.token.at.all", key)).toBeNull();
    expect(open("", key)).toBeNull();
  });

  it("insists on 32 bytes", () => {
    expect(() => parseKey("short")).toThrow(/32 random bytes/);
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 random bytes/);
  });
});
