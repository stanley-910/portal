import { LiveList, LiveMap, LiveObject } from "@liveblocks/node";
import { describe, expect, it, vi } from "vitest";

// Liveblocks for adoptTrips: one room, with each call recorded and Storage able to fail
const calls: string[] = [];
let storageFails = false;
let room: LiveObject<never>;
vi.mock("@/lib/liveblocks/server", () => ({
  liveblocks: () => ({
    async *iterRooms() {
      yield { id: "trip:abc", metadata: { members: ["stanley", GUEST, ACCOUNT], owner: GUEST } };
    },
    mutateStorage: async (_id: string, cb: (s: { root: unknown }) => void) => {
      calls.push("storage");
      if (storageFails) throw new Error("Liveblocks is down");
      cb({ root: room });
    },
    updateRoom: async (_id: string, update: unknown) => calls.push(`room ${JSON.stringify(update)}`),
  }),
}));

import { adoptChangeset, adoptInStorage, adoptTrips } from "./adopt";

const GUEST = "g_6f1c";
const ACCOUNT = "acct-catalin";

const leg = (riders: string[], createdBy: string, votes: [string, string][] = []) =>
  new LiveObject({
    from: "s1", to: "s2", date: "2026-10-04", createdBy, riders, search: { id: "x", status: "done" as const, offers: [] },
    votes: new LiveMap(votes), chosen: null, createdAt: 1,
  });

// The trip at 13:39: Catalin joined as the guest "Cata", then signed in and joined again as an account
function trip(withAccount = true) {
  const members: [string, LiveObject<{ name: string; color: number; leaves?: string | null }>][] = [
    ["stanley", new LiveObject({ name: "Stanley", color: 1 })],
    [GUEST, new LiveObject({ name: "Cata", color: 2, leaves: "2026-10-06" })],
  ];
  if (withAccount) members.push([ACCOUNT, new LiveObject({ name: "Catalin", color: 3 })]);
  return new LiveObject({
    members: new LiveMap(members),
    stops: new LiveMap(),
    legs: new LiveMap([
      ["l1", leg(["stanley", GUEST], GUEST, [[GUEST, "o1"]])],
      ["l2", leg([GUEST, ACCOUNT], ACCOUNT, [[GUEST, "o2"], [ACCOUNT, "o3"]])],
    ]),
    thread: new LiveList([new LiveObject({ id: "m1", at: 1, author: { kind: "member" as const, id: GUEST }, text: "hi", state: "done" as const, cards: [] })]),
    changesets: new LiveMap([["c1", JSON.stringify({ legs: { l1: { riders: [GUEST] } }, stops: {} })]]),
  });
}

const run = (root: ReturnType<typeof trip>) => {
  adoptInStorage(root as never, GUEST, ACCOUNT);
  return root.toJSON();
};

describe("adoptInStorage", () => {
  it("folds the guest into the account they signed in as", () => {
    const after = run(trip());
    expect(Object.keys(after.members)).toEqual(["stanley", ACCOUNT]);
    // the account keeps its name, and picks up the leave date set as a guest
    expect(after.members[ACCOUNT]).toEqual({ name: "Catalin", color: 3, leaves: "2026-10-06" });
    expect(after.legs.l1.riders).toEqual(["stanley", ACCOUNT]);
    expect(after.legs.l2.riders).toEqual([ACCOUNT]);
    expect(after.legs.l1.createdBy).toBe(ACCOUNT);
  });

  it("moves votes without overriding one the account already cast", () => {
    const after = run(trip());
    expect(after.legs.l1.votes).toEqual({ [ACCOUNT]: "o1" });
    expect(after.legs.l2.votes).toEqual({ [ACCOUNT]: "o3" });
  });

  it("reattributes messages and undo snapshots", () => {
    const after = run(trip());
    expect(after.thread[0].author).toEqual({ kind: "member", id: ACCOUNT });
    expect(after.changesets.c1).not.toContain(GUEST);
  });

  it("makes the account a member when it hadn't joined yet", () => {
    const after = run(trip(false));
    expect(after.members[ACCOUNT]).toEqual({ name: "Cata", color: 2, leaves: "2026-10-06" });
    expect(after.members[GUEST]).toBeUndefined();
  });
});

describe("adoptChangeset", () => {
  it("moves the guest by field, keeping the account's own vote and listing a rider once", () => {
    const before = { legs: { l1: { riders: [GUEST, ACCOUNT], createdBy: GUEST, votes: { [GUEST]: "o1", [ACCOUNT]: "o2" } } }, leaves: { [GUEST]: { value: "2026-10-06" } }, stops: {} };
    const after = JSON.parse(adoptChangeset(JSON.stringify(before), GUEST, ACCOUNT));
    expect(after.legs.l1).toEqual({ riders: [ACCOUNT], createdBy: ACCOUNT, votes: { [ACCOUNT]: "o2" } });
    expect(after.leaves).toEqual({ [ACCOUNT]: { value: "2026-10-06" } });
  });

  it("leaves snapshots without the guest untouched", () => {
    const json = JSON.stringify({ legs: { l1: { riders: ["stanley"] } }, stops: {} });
    expect(adoptChangeset(json, GUEST, ACCOUNT)).toBe(json);
  });
});

describe("adoptInStorage, meet-up cards", () => {
  it("puts the account in the guest's place in a meet-up group, counting one person once", () => {
    const root = trip();
    const legOf = (members: string[], people: number) => ({ members, people, fromStop: null, from: { name: "HK", lat: 0, lng: 0, hub: null, code: null }, mode: "flight", carrier: null, durationMin: 60, price: null, kind: "estimated" });
    root.get("thread").push(new LiveObject({
      id: "m2", at: 2, author: { kind: "agent" as const }, text: "", state: "done" as const,
      cards: [{ type: "meetup", title: "Where to meet", applied: null, changesetId: null, undone: false,
        options: [{ id: "P1", place: { name: "Taipei", code: null, lat: 0, lng: 0, hub: null }, date: "2026-10-04", total: null, estimated: 1,
          legs: [legOf([GUEST, ACCOUNT], 2), legOf(["stanley", GUEST], 3)] }] }],
    } as never));
    const after = run(root);
    const legs = (after.thread[1].cards[0] as { options: { legs: { members: string[]; people: number }[] }[] }).options[0].legs;
    expect(legs[0]).toMatchObject({ members: [ACCOUNT], people: 1 });
    expect(legs[1]).toMatchObject({ members: ["stanley", ACCOUNT], people: 3 });
  });
});

describe("adoptTrips", () => {
  it("moves Storage before access, so a failure leaves the room for the next try", async () => {
    calls.length = 0;
    storageFails = true;
    expect(await adoptTrips(GUEST, ACCOUNT)).toBe(false);
    expect(calls).toEqual(["storage"]);
  });

  it("hands over access, membership and ownership once Storage has moved", async () => {
    calls.length = 0;
    storageFails = false;
    room = trip() as never;
    expect(await adoptTrips(GUEST, ACCOUNT)).toBe(true);
    expect(calls[0]).toBe("storage");
    expect(JSON.parse(calls[1].slice(5))).toEqual({
      usersAccesses: { [ACCOUNT]: ["room:write"], [GUEST]: null },
      metadata: { members: ["stanley", ACCOUNT], owner: ACCOUNT },
    });
  });
});
