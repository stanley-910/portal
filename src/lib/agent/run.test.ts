import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/liveblocks/server", () => ({ liveblocks: () => ({}) }));

import { silentReply } from "./run";

const did = (over: Partial<Parameters<typeof silentReply>[0]>) => ({ edits: 0, problems: [], aborted: false, finish: "stop", ...over });

describe("silentReply", () => {
  it("only says Done when something on the trip changed", () => {
    expect(silentReply(did({ edits: 2 }))).toBe("Done.");
    expect(silentReply(did({}))).not.toContain("Done");
  });

  it("says why nothing changed", () => {
    expect(silentReply(did({ problems: ["L3 isn't in the trip."] }))).toBe("I couldn't do that: L3 isn't in the trip.");
    expect(silentReply(did({ finish: "tool-calls" }))).toContain("didn't get to the end");
  });

  it("owns up to running out of time", () => {
    expect(silentReply(did({ aborted: true }))).toContain("before changing anything");
    expect(silentReply(did({ aborted: true, edits: 1 }))).toContain("went through");
  });
});
