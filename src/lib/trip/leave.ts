// Leaving a trip: what of the plan goes with the person who leaves, and who owns the trip after them.

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
