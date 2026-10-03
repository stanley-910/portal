// The shared thread and the agent in it.
// Type aliases, not interfaces: Liveblocks needs them to be assignable to its JSON object type.

/** The agent's user id in presence. Never a guest id, so it can't collide with a member. */
export const AGENT_ID = "agent:pip";
export const AGENT_NAME = "Pip";

export type ThreadAuthor = { kind: "member"; id: string } | { kind: "agent" };

export type Money = { amount: number; currency: string };

/** One member group's way to a meet-up candidate. */
export type MeetupLeg = {
  /** Guest ids travelling together from the same stop. */
  members: string[];
  /** People in the group, at least 1: a friend not in the trip yet still counts. */
  people: number;
  /** The stop they leave from, or null when it was given as a place that isn't a stop yet. */
  fromStop: string | null;
  from: { name: string; lat: number; lng: number; hub: string | null; code: string | null };
  mode: "flight" | "train" | "bus" | "ferry";
  carrier: string | null;
  durationMin: number;
  /** Per person. */
  price: Money | null;
  kind: "live" | "cached" | "timetable" | "estimated";
};

export type MeetupOption = {
  /** P1, P2…: the handle the agent and the Apply button use. */
  id: string;
  place: { name: string; code: string | null; lat: number; lng: number; hub: string | null };
  date: string;
  legs: MeetupLeg[];
  /** Everyone's fares added up; null if any leg has no price. */
  total: Money | null;
  /** Legs whose price is an estimate. */
  estimated: number;
};

export type ThreadCard = (
  /** One tool call, "Checking fares" then "Checked 14 fares"; `id` is the call's, so its result updates it. */
  | { type: "status"; id?: string; label: string; done: boolean }
  /** Ranked meet-up places; `applied` is the option someone added to the trip. */
  | { type: "meetup"; title: string; options: MeetupOption[]; applied: string | null; changesetId: string | null; undone: boolean }
  /** What one run changed on the trip, with Undo. */
  | { type: "changes"; changesetId: string; lines: string[]; undone: boolean }
) & {
  /** Where in the reply's text it goes: the text's length when it was added. Missing: after the text. */
  at?: number;
};

export type ThreadMessage = {
  id: string;
  at: number;
  author: ThreadAuthor;
  text: string;
  /**
   * "queued" while Pip finishes an earlier request, then "streaming" while it writes this one; the text arrives by
   * broadcast until then. Replies take their turn in thread order (run.ts).
   */
  state: "queued" | "streaming" | "done" | "failed";
  /** When Pip started on it (it may have queued first); a run that started over LEASE_MS ago has died. */
  startedAt?: number;
  cards: ThreadCard[];
};

/** The one run a room can have at a time (harness G9). */
export type AgentRun = {
  id: string;
  status: "running" | "cancelling";
  /** Guest id of whoever asked. */
  by: string;
  /** A run that died leaves its lease; after this, the next message takes over. */
  until: number;
};

/** Model runs a trip has used today (run.ts limits them). */
export type AgentUsage = { day: string; runs: number };

/**
 * The plan as it was before a run changed it, so Undo can put it back: JSON of `{ legs, stops }`, each id → the
 * entry's old JSON, or null if the run created it.
 */
export type Changeset = string;

/**
 * Broadcast while Pip writes, so text streams without a Storage write per token. Each carries the whole text so
 * far; `seq` counts up, so a late one can't roll the text back.
 */
export type AgentEvent = { type: "agent-text"; messageId: string; text: string; seq: number };

/** Presence Pip sets from the server: where it's looking and what it's doing. */
export type AgentActivity = string;

