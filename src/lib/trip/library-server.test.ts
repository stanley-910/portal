import { beforeEach, describe, expect, it, vi } from "vitest";

// Liveblocks for listMyLibrary: two trip rooms and a room that isn't a trip, each trip with a plan; who's in a room
// can fail on its own without costing the trip.
const plan = {
  members: { me: { name: "Mei", color: 2 }, kit: { name: "Kit", color: 1 } },
  stops: { a: { name: "Hong Kong", code: "HKG", lat: 22.3, lng: 114.17, hub: null }, b: { name: "Shanghai", code: "SHA", lat: 31.2, lng: 121.32, hub: null } },
  legs: { l: { from: "a", to: "b", date: "2026-10-16", riders: ["me", "kit"], createdBy: "kit", createdAt: 1, chosen: null, votes: {}, search: { id: "s", status: "done", offers: [] } } },
};
let down = false;
let presenceFails = false;
vi.mock("@/lib/liveblocks/server", () => ({
  liveblocks: () => ({
    getRooms: async () => {
      if (down) throw new Error("down");
      return {
        data: [
          { id: "trip:aaaaaaaaaaaaaaaa", metadata: { title: "Meet-up", members: ["me", "kit"], updatedAt: "2026-10-03T00:00:00.000Z", owner: "me" }, createdAt: new Date() },
          { id: "other:room", metadata: {}, createdAt: new Date() },
        ],
      };
    },
    getStorageDocument: async () => plan,
    getActiveUsers: async () => {
      if (presenceFails) throw new Error("presence");
      return { data: [{ id: "kit" }, { id: undefined }] };
    },
  }),
}));

const { listMyLibrary } = await import("./server");

describe("listMyLibrary", () => {
  beforeEach(() => {
    down = false;
    presenceFails = false;
  });

  it("lists each trip room with its legs, people and who's in it now", async () => {
    const [trip, ...rest] = await listMyLibrary("me");
    expect(rest).toEqual([]);
    expect(trip).toMatchObject({ id: "aaaaaaaaaaaaaaaa", title: "Meet-up" });
    expect(trip.legs.map((l) => `${l.from.code}-${l.to.code}`)).toEqual(["HKG-SHA"]);
    expect(trip.members.map((m) => [m.name, m.present, m.you])).toEqual([
      ["Mei", false, true],
      ["Kit", true, false],
    ]);
  });

  it("lists a trip whose presence didn't load with nobody in it, and nothing when Liveblocks is down", async () => {
    presenceFails = true;
    const [trip] = await listMyLibrary("me");
    expect(trip.members.every((m) => !m.present)).toBe(true);
    down = true;
    expect(await listMyLibrary("me")).toEqual([]);
  });
});
