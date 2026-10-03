import { describe, expect, it } from "vitest";

import { afterLeave, leaveChanges, tripOwner } from "./leave";

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
