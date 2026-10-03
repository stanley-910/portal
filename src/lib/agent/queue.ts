import type { ThreadMessage } from "@/lib/agent/types";

// Pip's reply queue, shared by the server that runs replies (run.ts) and the chat that shows them. Turns go by a
// reply's place in the thread; a reply whose request died is skipped, and reads as failed.

/** How long one run may take, from when it starts. */
export const LEASE_MS = 90_000;
/** A waiting request marks its reply this often, so a reply nobody marks was left by a request that died. */
export const QUEUE_BEAT_MS = 10_000;
/** A queued reply not marked for this long was left by a request that died. */
export const QUEUED_STALE_MS = 3 * QUEUE_BEAT_MS;

/** What a dead reply says, wherever it's noticed. */
export const LOST_REPLY = "I lost track of this one. Ask me again.";

export const waiting = (m: ThreadMessage) => m.author.kind === "agent" && (m.state === "queued" || m.state === "streaming");

/** Whether a reply that says it's queued or being written was left by a request that died. */
export const abandoned = (m: ThreadMessage, now: number) =>
  m.state === "streaming" ? now - (m.startedAt ?? m.at) > LEASE_MS : now - (m.seenAt ?? m.at) > QUEUED_STALE_MS;

/** Replies Pip still owes, in thread order: the first one is the one Pip is on. */
export const owed = (thread: readonly ThreadMessage[], now: number) => thread.filter((m) => waiting(m) && !abandoned(m, now));
