import { describe, expect, it, vi } from "vitest";

// the browser's cookies, as next/headers hands them to a Server Function
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

import { forgetGuest, readGuest } from "./guest";

describe("forgetGuest", () => {
  it("leaves nothing of the guest for the next one made on this browser", async () => {
    jar.set("portal_guest", "g_6f1c").set("portal_name", "Cata").set("portal_passports", "HK,TW");
    await forgetGuest();
    expect([...jar.keys()]).toEqual([]);
    expect(await readGuest()).toBeNull();
  });
});
