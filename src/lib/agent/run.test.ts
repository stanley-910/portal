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

import { abandoned, owed } from "./queue";
import { postToPip, runAgent, silentReply } from "./run";

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
const reply = (id: string, state: ThreadMessage["state"], at: number, startedAt?: number, seenAt?: number): ThreadMessage => ({
  id, at, author: { kind: "agent" }, text: "", state, cards: [], ...(startedAt ? { startedAt } : {}), ...(seenAt ? { seenAt } : {}),
});

describe("the reply queue", () => {
  it("counts a run as dead a lease after it started, however long it queued first", () => {
    // posted three minutes ago, started ten seconds ago: alive
    expect(abandoned(reply("a", "streaming", NOW - 180_000, NOW - 10_000), NOW)).toBe(false);
    // started two minutes ago: past the 90 s lease
    expect(abandoned(reply("a", "streaming", NOW - 120_000, NOW - 120_000), NOW)).toBe(true);
    // queued, and its request stopped saying it's still there
    expect(abandoned(reply("b", "queued", NOW - 60_000), NOW)).toBe(true);
    expect(abandoned(reply("b", "queued", NOW - 170_000, undefined, NOW - 5_000), NOW)).toBe(false);
    expect(abandoned(reply("b", "queued", NOW - 5_000), NOW)).toBe(false);
  });

  it("puts the oldest live reply first and skips dead ones", () => {
    const thread = [reply("dead", "streaming", NOW - 200_000, NOW - 150_000), reply("done", "done", NOW - 5_000), reply("b", "queued", NOW - 2_000), reply("c", "queued", NOW - 1_000)];
    expect(owed(thread, NOW).map((m: ThreadMessage) => m.id)).toEqual(["b", "c"]);
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

  it("doesn't wait behind a queued reply whose request died", async () => {
    (root.get("thread") as LiveList<LiveObject<ThreadMessage>>).push(new LiveObject(reply("left", "queued", Date.now() - 60_000)));
    const { claim } = await postToPip("room", "u1", "where should we meet?");
    await runAgent("room", claim, "u1");
    const thread = (root.toJSON() as { thread: ThreadMessage[] }).thread;
    expect(thread.find((m) => m.id === "left")?.state).toBe("failed");
    expect(thread.find((m) => m.id === claim.replyId)?.state).toBe("done");
  });

  it("stands down when another request took its reply for dead", async () => {
    const { claim } = await postToPip("room", "u1", "where should we meet?");
    const thread = root.get("thread") as LiveList<LiveObject<ThreadMessage>>;
    thread.find((m) => m.get("id") === claim.replyId)!.update({ state: "failed", text: "I lost track of this one. Ask me again." });
    await runAgent("room", claim, "u1");
    expect(thread.find((m) => m.get("id") === claim.replyId)?.get("text")).toBe("I lost track of this one. Ask me again.");
    expect(root.get("agentRun")).toBeUndefined();
  });

  it("posts behind a live run as queued", async () => {
    (root.get("thread") as LiveList<LiveObject<ThreadMessage>>).push(new LiveObject(reply("live", "streaming", Date.now(), Date.now())));
    const { claim } = await postToPip("room", "u1", "and another thing");
    const thread = (root.toJSON() as { thread: ThreadMessage[] }).thread;
    expect(thread.find((m) => m.id === claim.replyId)?.state).toBe("queued");
  });

  it("waits for a room made before the thread to get one from a browser, rather than make it", async () => {
    root.delete("thread");
    setTimeout(() => root.set("thread", new LiveList([])), 200);
    const { claim } = await postToPip("room", "u1", "hello");
    const thread = (root.toJSON() as { thread: ThreadMessage[] }).thread;
    expect(thread.map((m) => m.id)).toEqual([claim.messageId, claim.replyId]);
  });
});
