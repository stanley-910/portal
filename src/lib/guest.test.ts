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

import { forgetGuest, readGuest, setGuestColor } from "./guest";

describe("forgetGuest", () => {
  it("leaves nothing of the guest for the next one made on this browser", async () => {
    jar.set("portal_guest", "g_6f1c").set("portal_name", "Cata").set("portal_passports", "HK,TW").set("portal_color", "4");
    await forgetGuest();
    expect([...jar.keys()]).toEqual([]);
    expect(await readGuest()).toBeNull();
  });
});

describe("the guest's colour", () => {
  it("reads back the colour they picked, and nothing that isn't a member colour", async () => {
    jar.clear();
    jar.set("portal_guest", "g_6f1c");
    expect((await readGuest())?.color).toBeNull();
    await setGuestColor(5);
    expect((await readGuest())?.color).toBe(5);
    jar.set("portal_color", "9");
    expect((await readGuest())?.color).toBeNull();
  });
});
