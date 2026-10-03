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
    date: "2026-10-17",
    createdBy,
    riders,
    votes,
    search: { offers: [] },
    chosen: null,
    createdAt: 1,
  });
  const stay = (stop: string, guests: string[]) => ({ stop, checkIn: "2026-10-17", checkOut: "2026-10-19", guests, nightly: null, label: null });

  it("keeps a leg they drew for the others still riding it", () => {
    const out = leaveChanges({ legs: { l1: leg("hk", "sh", "u1", ["u1", "u2"]), l2: leg("sh", "tk", "u2", ["u2"]) } }, "u1");
    expect(out.legs).toEqual([]);
    expect(out.riders).toEqual({ l1: ["u2"] });
    expect(out.stops).toEqual([]);
  });

  it("drops a leg nobody rides then, and stops nothing else uses", () => {
    const out = leaveChanges(
      { legs: { l1: leg("hk", "sh", "u2", ["u1", "u2"]), l2: leg("se", "sh", "u2", ["u1"]) } },
      "u1",
    );
    expect(out.riders).toEqual({ l1: ["u2"] });
    expect(out.legs).toEqual(["l2"]);
    expect(out.stops).toEqual(["se"]);
  });

  it("takes them out of stays, keeping a stay for the others and its stop", () => {
    const out = leaveChanges(
      { legs: { l1: leg("se", "sh", "u1", ["u1"]) }, stays: { s1: stay("sh", ["u1", "u2"]), s2: stay("tk", ["u1"]) } },
      "u1",
    );
    expect(out.legs).toEqual(["l1"]);
    expect(out.stays).toEqual({ s1: { ...stay("sh", ["u2"]), estimated: false, createdAt: 0 }, s2: null });
    expect(out.stops.sort()).toEqual(["se", "tk"]);
  });

  it("writes a room's older stop-keyed stays out whole", () => {
    const out = leaveChanges(
      { members: { u1: {}, u2: {} }, legs: { l1: leg("hk", "sh", "u2", ["u1", "u2"]) }, stays: { sh: { nightly: null, label: "Flat" } }, ends: "2026-10-19" },
      "u1",
    );
    expect(out.stays).toEqual({ sh: { stop: "sh", checkIn: "2026-10-17", checkOut: "2026-10-19", guests: ["u2"], nightly: null, label: "Flat", estimated: false, createdAt: 0 } });
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
// for everyone, Mei and Ada voted, Mei has a flat in HK to herself and shares the Jing'an one with Ada, and Mei talked
// to Pip.
const MEI = "acct-mei";
const ADA = "g_ada";
const JOON = "g_joon";
const DAY = { date: "2026-10-17", search: { offers: [] }, chosen: null, createdAt: 1 };
const legs = {
  hk_sh: { from: "hk", to: "sh", createdBy: MEI, riders: [MEI, ADA], votes: { [MEI]: "g1", [ADA]: "g1" }, ...DAY },
  se_sh: { from: "se", to: "sh", createdBy: JOON, riders: [JOON], votes: {}, ...DAY },
  sh_tk: { from: "sh", to: "tk", createdBy: "pip", riders: [MEI, ADA, JOON], votes: { [MEI]: "f1" }, ...DAY },
};
const stays = {
  flat: { stop: "hk", checkIn: "2026-10-15", checkOut: "2026-10-17", guests: [MEI], nightly: null, label: "Flat" },
  jingan: { stop: "sh", checkIn: "2026-10-17", checkOut: "2026-10-19", guests: [MEI, ADA], nightly: null, label: "Jing'an" },
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
        new LiveObject({ ...l, search: { id: "s", status: "done" as const, offers: [] }, votes: new LiveMap(Object.entries(l.votes)) }),
      ]),
    ),
    ...(keys.stays ? { stays: new LiveMap(Object.entries(stays).map(([id, s]) => [id, new LiveObject(s)])) } : {}),
    ...(keys.thread
      ? { thread: new LiveList(thread.map((m, i) => new LiveObject({ ...m, at: i, text: "", state: "done" as const, cards: [] } as never))) }
      : {}),
  });
}

describe("the owner leaving while others stay", () => {
  const metadata = { members: [MEI, ADA, JOON], title: "HK to Tokyo" };
  const changes = leaveChanges({ legs, stays, thread } as LeaveInput, MEI);

  it("passes the trip to Ada, who joined next", () => {
    expect(tripOwner(metadata)).toBe(MEI);
    expect(afterLeave(metadata, MEI)).toEqual({ members: [ADA, JOON], owner: ADA });
  });

  it("takes Mei off legs and stays, and keeps everything the others are on", () => {
    expect(changes).toEqual({
      legs: [],
      riders: { hk_sh: [ADA], sh_tk: [ADA, JOON] },
      votes: ["hk_sh", "sh_tk"],
      stays: { flat: null, jingan: { ...stays.jingan, guests: [ADA], estimated: false, createdAt: 0 } },
      stops: [],
      messages: ["m1"],
    });
  });

  it("applies to the stored plan, recording the new owner", () => {
    const root = room();
    applyLeave(root, changes, MEI, ADA);
    const after = root.toJSON();
    expect(Object.keys(after.members)).toEqual([ADA, JOON]);
    expect(Object.keys(after.legs)).toEqual(["hk_sh", "se_sh", "sh_tk"]);
    expect(after.legs.hk_sh).toMatchObject({ riders: [ADA], votes: { [ADA]: "g1" } });
    expect(after.legs.sh_tk).toMatchObject({ riders: [ADA, JOON], votes: {} });
    expect(Object.keys(after.stops)).toEqual(["hk", "se", "sh", "tk"]);
    expect(Object.keys(after.stays ?? {})).toEqual(["jingan"]);
    expect(after.stays?.jingan?.guests).toEqual([ADA]);
    expect(after.thread?.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(after.owner).toBe(ADA);
  });

  it("works on rooms made before stays and the thread", () => {
    const root = room({});
    expect(() => applyLeave(root, changes, MEI, ADA)).not.toThrow();
    expect(root.get("owner")).toBe(ADA);
  });
});
