import { LiveList, LiveMap, LiveObject } from "@liveblocks/node";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/liveblocks/server", () => ({ liveblocks: () => ({}) }));

import { adoptInStorage } from "./adopt";

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
