import { LiveList, LiveMap, LiveObject } from "@liveblocks/client";
import { describe, expect, it } from "vitest";

import type { TripStorage } from "@/lib/liveblocks/types";

import { afterLeave, applyLeave, leaveChanges, tripOwner, type LeaveInput } from "./leave";

describe("tripOwner", () => {
  it("is whoever made the trip until ownership passes on", () => {
    expect(tripOwner({ members: ["u1", "u2"] })).toBe("u1");
    expect(tripOwner({ members: ["u1", "u2"], owner: "u2" })).toBe("u2");
    expect(tripOwner({ members: "u1" })).toBe("u1");
    expect(tripOwner({})).toBeNull();
  });
});

describe("afterLeave", () => {
  it("passes the trip to whoever joined next when the owner leaves", () => {
    expect(afterLeave({ members: ["u1", "u2", "u3"] }, "u1")).toEqual({ members: ["u2", "u3"], owner: "u2" });
  });

  it("keeps the owner when someone else leaves", () => {
    expect(afterLeave({ members: ["u1", "u2", "u3"], owner: "u3" }, "u2")).toEqual({ members: ["u1", "u3"], owner: "u3" });
  });

  it("passes the trip on when the owner it was passed to leaves", () => {
    expect(afterLeave({ members: ["u2", "u3", "u4"], owner: "u2" }, "u2")).toEqual({ members: ["u3", "u4"], owner: "u3" });
  });

  it("falls back to whoever joined first when the recorded owner is no longer a member", () => {
    expect(afterLeave({ members: ["u2", "u3"], owner: "u1" }, "u3")).toEqual({ members: ["u2"], owner: "u2" });
  });

  it("leaves no owner when the last member leaves", () => {
    expect(afterLeave({ members: ["u1"] }, "u1")).toEqual({ members: [], owner: null });
  });
});

describe("leaveChanges", () => {
  const leg = (from: string, to: string, createdBy: string, riders: string[], votes: Record<string, string> = {}) => ({
    from,
    to,
    createdBy,
    riders,
    votes,
  });

  it("removes the legs they drew and stops nobody else uses", () => {
    const out = leaveChanges({ legs: { l1: leg("hk", "sh", "u1", ["u1", "u2"]), l2: leg("sh", "tk", "u2", ["u2"]) } }, "u1");
    expect(out.legs).toEqual(["l1"]);
    expect(out.stops).toEqual(["hk"]);
  });

  it("takes them off other legs, and drops a leg nobody rides then", () => {
    const out = leaveChanges(
      { legs: { l1: leg("hk", "sh", "u2", ["u1", "u2"]), l2: leg("se", "sh", "u2", ["u1"]) } },
      "u1",
    );
    expect(out.riders).toEqual({ l1: ["u2"] });
    expect(out.legs).toEqual(["l2"]);
    expect(out.stops).toEqual(["se"]);
  });

  it("drops their votes and messages, not Pip's or anyone else's", () => {
    const out = leaveChanges(
      {
        legs: { l1: leg("hk", "sh", "u2", ["u2"], { u1: "o1", u2: "o2" }) },
        thread: [
          { id: "m1", author: { kind: "member", id: "u1" } },
          { id: "m2", author: { kind: "agent" } },
          { id: "m3", author: { kind: "member", id: "u2" } },
        ],
      },
      "u1",
    );
    expect(out.votes).toEqual(["l1"]);
    expect(out.messages).toEqual(["m1"]);
    expect(out.legs).toEqual([]);
  });
});

// The owner leaving a party of three, as the room stores it: Mei drew HK → SH (Ada rides it too), Pip drew SH → TK
// for everyone, Mei and Ada voted, and Mei talked to Pip.
const MEI = "acct-mei";
const ADA = "g_ada";
const JOON = "g_joon";
type Json = { from: string; to: string; createdBy: string; riders: string[]; votes: Record<string, string> };
const legs: Record<string, Json> = {
  hk_sh: { from: "hk", to: "sh", createdBy: MEI, riders: [MEI, ADA], votes: { [MEI]: "g1", [ADA]: "g1" } },
  se_sh: { from: "se", to: "sh", createdBy: JOON, riders: [JOON], votes: {} },
  sh_tk: { from: "sh", to: "tk", createdBy: "pip", riders: [MEI, ADA, JOON], votes: { [MEI]: "f1" } },
};
const thread = [
  { id: "m1", author: { kind: "member", id: MEI } },
  { id: "m2", author: { kind: "agent" } },
  { id: "m3", author: { kind: "member", id: ADA } },
];

function room(keys: { stays?: boolean; thread?: boolean } = { stays: true, thread: true }) {
  const stop = (name: string) => new LiveObject({ lat: 0, lng: 0, hub: null, name });
  return new LiveObject<TripStorage>({
    members: new LiveMap([MEI, ADA, JOON].map((id, i) => [id, new LiveObject({ name: id, color: i + 1 })])),
    stops: new LiveMap(["hk", "se", "sh", "tk"].map((id) => [id, stop(id)])),
    legs: new LiveMap(
      Object.entries(legs).map(([id, l]) => [
        id,
        new LiveObject({ ...l, date: "2026-10-17", search: { id: "s", status: "done" as const, offers: [] }, votes: new LiveMap(Object.entries(l.votes)), chosen: null, createdAt: 1 }),
      ]),
    ),
    ...(keys.stays ? { stays: new LiveMap([["hk", new LiveObject({ nightly: null, label: "Flat" })], ["sh", new LiveObject({ nightly: null, label: "Jing'an" })]]) } : {}),
    ...(keys.thread
      ? { thread: new LiveList(thread.map((m, i) => new LiveObject({ ...m, at: i, text: "", state: "done" as const, cards: [] } as never))) }
      : {}),
  });
}

describe("the owner leaving while others stay", () => {
  const metadata = { members: [MEI, ADA, JOON], title: "HK to Tokyo" };
  const changes = leaveChanges({ legs, thread } as LeaveInput, MEI);

  it("passes the trip to Ada, who joined next", () => {
    expect(tripOwner(metadata)).toBe(MEI);
    expect(afterLeave(metadata, MEI)).toEqual({ members: [ADA, JOON], owner: ADA });
  });

  it("takes Mei's leg, seat, votes and messages, and leaves Pip's leg and the others' things", () => {
    expect(changes).toEqual({ legs: ["hk_sh"], riders: { sh_tk: [ADA, JOON] }, votes: ["sh_tk"], stops: ["hk"], messages: ["m1"] });
  });

  it("applies to the stored plan, recording the new owner", () => {
    const root = room();
    applyLeave(root, changes, MEI, ADA);
    const after = root.toJSON();
    expect(Object.keys(after.members)).toEqual([ADA, JOON]);
    expect(Object.keys(after.legs)).toEqual(["se_sh", "sh_tk"]);
    expect(after.legs.sh_tk).toMatchObject({ riders: [ADA, JOON], votes: {} });
    expect(Object.keys(after.stops)).toEqual(["se", "sh", "tk"]);
    expect(Object.keys(after.stays ?? {})).toEqual(["sh"]);
    expect(after.thread?.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(after.owner).toBe(ADA);
  });

  it("works on rooms made before stays and the thread", () => {
    const root = room({});
    expect(() => applyLeave(root, changes, MEI, ADA)).not.toThrow();
    expect(root.get("owner")).toBe(ADA);
  });
});
