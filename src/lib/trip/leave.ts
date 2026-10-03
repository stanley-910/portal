// Leaving a trip: what of the plan goes with the person who leaves, and who owns the trip after them.

import type { LiveObject } from "@liveblocks/client";

import type { TripStorage } from "@/lib/liveblocks/types";

type Metadata = Record<string, string | string[] | undefined>;

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);

/** Who has joined the room, in join order. */
export const roomMembers = (metadata: Metadata) => asList(metadata.members);

/** The trip's owner: set when ownership passed on, else whoever made the trip, who joined first. */
export function tripOwner(metadata: Metadata): string | null {
  const owner = metadata.owner;
  return typeof owner === "string" && owner ? owner : (roomMembers(metadata)[0] ?? null);
}

/** The room's members and owner once `userId` has left. The owner leaving passes the trip to whoever joined next. */
export function afterLeave(metadata: Metadata, userId: string) {
  const members = roomMembers(metadata).filter((id) => id !== userId);
  const owner = tripOwner(metadata);
  return { members, owner: owner && owner !== userId && members.includes(owner) ? owner : (members[0] ?? null) };
}

/** The parts of Storage (as JSON) that leaving reads. */
export type LeaveInput = {
  legs?: Record<string, { from: string; to: string; createdBy: string; riders: string[]; votes: Record<string, string> }>;
  thread?: { id: string; author: { kind: string; id?: string } }[];
};

export type LeaveChanges = {
  /** Legs to delete: the ones they drew, and any left with nobody riding. */
  legs: string[];
  /** Leg id → its riders without them, for legs that stay. */
  riders: Record<string, string[]>;
  /** Legs that stay but lose their vote. */
  votes: string[];
  /** Stops no remaining leg uses, with their stays. */
  stops: string[];
  /** Thread messages they wrote. */
  messages: string[];
};

/** Everything `userId` added to the plan, so leaving takes it with them. */
export function leaveChanges(plan: LeaveInput, userId: string): LeaveChanges {
  const changes: LeaveChanges = { legs: [], riders: {}, votes: [], stops: [], messages: [] };
  const used = new Set<string>();
  const dropped = new Set<string>();
  for (const [id, leg] of Object.entries(plan.legs ?? {})) {
    const riders = leg.riders.filter((r) => r !== userId);
    if (leg.createdBy === userId || riders.length === 0) {
      changes.legs.push(id);
      dropped.add(leg.from).add(leg.to);
      continue;
    }
    used.add(leg.from).add(leg.to);
    if (riders.length !== leg.riders.length) changes.riders[id] = riders;
    if (userId in leg.votes) changes.votes.push(id);
  }
  changes.stops = [...dropped].filter((stop) => !used.has(stop));
  changes.messages = (plan.thread ?? []).filter((m) => m.author.kind === "member" && m.author.id === userId).map((m) => m.id);
  return changes;
}

/**
 * Applies `leaveChanges` to the live Storage root (inside `mutateStorage`), and records who owns the trip now so the
 * room sees it pass on. Rooms made before stays or the thread, or never opened, lack those keys; that's fine.
 */
export function applyLeave(root: LiveObject<TripStorage>, changes: LeaveChanges, userId: string, owner: string | null) {
  const legs = root.get("legs");
  const stops = root.get("stops");
  const stays = root.get("stays");
  for (const id of changes.legs) legs?.delete(id);
  for (const [id, riders] of Object.entries(changes.riders)) legs?.get(id)?.set("riders", riders);
  for (const id of changes.votes) legs?.get(id)?.get("votes")?.delete(userId);
  for (const id of changes.stops) {
    stops?.delete(id);
    stays?.delete(id);
  }
  const thread = root.get("thread");
  if (thread) {
    const gone = new Set(changes.messages);
    for (let i = thread.length - 1; i >= 0; i--) if (gone.has(thread.get(i)!.get("id"))) thread.delete(i);
  }
  root.get("members")?.delete(userId);
  if (root.get("owner") !== owner) root.set("owner", owner);
}
