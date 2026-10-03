import "server-only";

import { Liveblocks, LiveblocksError } from "@liveblocks/node";

import { MEMBER_COLORS } from "./types";

let client: Liveblocks | null = null;

/** The Liveblocks server client. Throws if LIVEBLOCKS_SECRET_KEY is missing, so a misconfigured deploy fails loudly. */
export function liveblocks() {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret?.startsWith("sk_")) {
    throw new Error("LIVEBLOCKS_SECRET_KEY is missing or not a secret key. Add it to .env.local (see README).");
  }
  client ??= new Liveblocks({ secret });
  return client;
}

export const isNotFound = (e: unknown) => e instanceof LiveblocksError && e.status === 404;

/**
 * Records a signed-in user (by Supabase user id, M19) as a member of a trip room if they aren't one yet, and returns
 * their member colour (1 to MEMBER_COLORS, in join order). Returns null if the room doesn't exist. The access list it
 * writes is what `getRooms({ userId })` reads for "My trips" (M6); connecting uses the access token from the auth route.
 */
export async function joinTrip(roomId: string, userId: string): Promise<number | null> {
  const lb = liveblocks();
  let data;
  try {
    data = await lb.getRoom(roomId);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  // Two users joining in the same instant can both get the same colour; fine for now.
  const raw = data.metadata.members;
  const members = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!data.usersAccesses[userId] || !members.includes(userId)) {
    await lb.updateRoom(roomId, {
      usersAccesses: { [userId]: ["room:write"] },
      metadata: { members: members.includes(userId) ? members : [...members, userId] },
    });
  }
  const index = members.indexOf(userId);
  return ((index < 0 ? members.length : index) % MEMBER_COLORS) + 1;
}
