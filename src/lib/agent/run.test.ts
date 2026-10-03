import { LiveList, LiveMap, LiveObject, type LsonObject } from "@liveblocks/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadMessage } from "./types";

// A room's Storage in memory, behind the few Liveblocks calls a run makes
let root: LiveObject<LsonObject>;
vi.mock("@/lib/liveblocks/server", () => ({
  liveblocks: () => ({
    mutateStorage: async (_room: string, cb: (s: { root: unknown }) => void) => cb({ root }),
    getStorageDocument: async () => root.toJSON(),
    setPresence: async () => {},
    broadcastEvent: async () => {},
  }),
}));

import { abandoned, owed, postToPip, runAgent, silentReply } from "./run";

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

const NOW = 1_000_000_000;
const reply = (id: string, state: ThreadMessage["state"], at: number, startedAt?: number): ThreadMessage => ({
  id, at, author: { kind: "agent" }, text: "", state, cards: [], ...(startedAt ? { startedAt } : {}),
});

describe("the reply queue", () => {
  it("counts a run as dead a lease after it started, however long it queued first", () => {
    // posted three minutes ago, started ten seconds ago: alive
    expect(abandoned(reply("a", "streaming", NOW - 180_000, NOW - 10_000), NOW)).toBe(false);
    // started two minutes ago: past the 90 s lease
    expect(abandoned(reply("a", "streaming", NOW - 120_000, NOW - 120_000), NOW)).toBe(true);
    // queued past the longest anyone waits
    expect(abandoned(reply("b", "queued", NOW - 200_000), NOW)).toBe(true);
    expect(abandoned(reply("b", "queued", NOW - 60_000), NOW)).toBe(false);
  });

  it("puts the oldest live reply first and skips dead ones", () => {
    const thread = [reply("dead", "streaming", NOW - 200_000, NOW - 150_000), reply("done", "done", NOW - 5_000), reply("b", "queued", NOW - 2_000), reply("c", "queued", NOW - 1_000)];
    expect(owed(thread, NOW).map((m) => m.id)).toEqual(["b", "c"]);
  });
});

describe("runAgent", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    root = new LiveObject<LsonObject>({
      members: new LiveMap([["u1", new LiveObject({ name: "Stanley", color: 1 })]]),
      stops: new LiveMap(),
      legs: new LiveMap(),
      thread: new LiveList([]),
    });
  });

  it("marks a run that died as failed and answers the next message straight away", async () => {
    const long = Date.now() - 120_000;
    (root.get("thread") as LiveList<LiveObject<ThreadMessage>>).push(new LiveObject(reply("dead", "streaming", long, long)));
    const { claim } = await postToPip("room", "u1", "where should we meet?");
    await runAgent("room", claim, "u1");
    const thread = (root.toJSON() as { thread: ThreadMessage[] }).thread;
    expect(thread.find((m) => m.id === "dead")).toMatchObject({ state: "failed", text: "I lost track of this one. Ask me again." });
    expect(thread.find((m) => m.id === claim.replyId)?.state).toBe("done");
  });

  it("posts behind a live run as queued", async () => {
    (root.get("thread") as LiveList<LiveObject<ThreadMessage>>).push(new LiveObject(reply("live", "streaming", Date.now(), Date.now())));
    const { claim } = await postToPip("room", "u1", "and another thing");
    const thread = (root.toJSON() as { thread: ThreadMessage[] }).thread;
    expect(thread.find((m) => m.id === claim.replyId)?.state).toBe("queued");
  });

  it("gives a room with no thread one before posting", async () => {
    root.delete("thread");
    const { claim } = await postToPip("room", "u1", "hello");
    const thread = (root.toJSON() as { thread: ThreadMessage[] }).thread;
    expect(thread.map((m) => m.id)).toEqual([claim.messageId, claim.replyId]);
  });
});
