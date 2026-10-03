// Leaving a trip: what of the plan goes with the person who leaves, and who owns the trip after them.

import { LiveMap, LiveObject } from "@liveblocks/client";

import type { Stay, TripStorage } from "@/lib/liveblocks/types";
import { staysOf, type SplitInput } from "@/lib/trip/split";

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

/** The parts of Storage (as JSON) that leaving reads. Legs carry what `staysOf` needs to read a room's older stays. */
export type LeaveInput = Pick<SplitInput, "members" | "stays" | "ends"> & {
  legs?: Record<string, NonNullable<SplitInput["legs"]>[string] & { createdBy: string; votes: Record<string, string> }>;
  thread?: { id: string; author: { kind: string; id?: string } }[];
};

export type LeaveChanges = {
  /** Legs left with nobody riding, to delete. Whoever drew a leg doesn't own it: it goes on for its other riders. */
  legs: string[];
  /** Leg id → its riders without them, for legs that stay. */
  riders: Record<string, string[]>;
  /** Legs that stay but lose their vote. */
  votes: string[];
  /** Stay id → the stay without them, or null to delete one left with nobody in it. */
  stays: Record<string, Stay | null>;
  /** Stops no remaining leg or stay uses. */
  stops: string[];
  /** Thread messages they wrote. */
  messages: string[];
};

/**
 * What leaving takes with `userId`: their seats, their place in stays, their votes and messages. Legs and stays others
 * are still on go on without them; one left empty goes. A room's older stop-keyed stays are written out whole.
 */
export function leaveChanges(plan: LeaveInput, userId: string): LeaveChanges {
  const changes: LeaveChanges = { legs: [], riders: {}, votes: [], stays: {}, stops: [], messages: [] };
  const used = new Set<string>();
  const dropped = new Set<string>();
  for (const [id, leg] of Object.entries(plan.legs ?? {})) {
    const riders = leg.riders.filter((r) => r !== userId);
    if (riders.length === 0) {
      changes.legs.push(id);
      dropped.add(leg.from).add(leg.to);
      continue;
    }
    used.add(leg.from).add(leg.to);
    if (riders.length !== leg.riders.length) changes.riders[id] = riders;
    if (userId in leg.votes) changes.votes.push(id);
  }

  const older = Object.entries(plan.stays ?? {}).filter(([, s]) => !s.stop).map(([id]) => id);
  for (const id of older) changes.stays[id] = null;
  for (const { id, ...stay } of staysOf(plan)) {
    const guests = stay.guests.filter((g) => g !== userId);
    if (!guests.length) {
      changes.stays[id] = null;
      dropped.add(stay.stop);
    } else {
      used.add(stay.stop);
      if (guests.length !== stay.guests.length || older.length) changes.stays[id] = { ...stay, guests };
    }
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
  let stays = root.get("stays");
  for (const id of changes.legs) legs?.delete(id);
  for (const [id, riders] of Object.entries(changes.riders)) legs?.get(id)?.set("riders", riders);
  for (const id of changes.votes) legs?.get(id)?.get("votes")?.delete(userId);
  for (const [id, stay] of Object.entries(changes.stays)) {
    if (!stay) stays?.delete(id);
    else {
      if (!stays) root.set("stays", (stays = new LiveMap()));
      stays.set(id, new LiveObject(stay));
    }
  }
  for (const id of changes.stops) stops?.delete(id);
  const thread = root.get("thread");
  if (thread) {
    const gone = new Set(changes.messages);
    for (let i = thread.length - 1; i >= 0; i--) if (gone.has(thread.get(i)!.get("id"))) thread.delete(i);
  }
  root.get("members")?.delete(userId);
  if (root.get("owner") !== owner) root.set("owner", owner);
}
