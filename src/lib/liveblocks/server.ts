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
 * Adds a guest to a trip room if they aren't in it yet, and returns their member colour (1 to MEMBER_COLORS, in join
 * order). Opening a trip's URL is the invite (M7). Returns null if the room doesn't exist.
 *
 * Call it when the trip page renders, well before the browser connects: Liveblocks checks room access on connect,
 * and a grant made in the same moment may not have reached it yet.
 */
export async function joinTrip(roomId: string, guestId: string): Promise<number | null> {
  const lb = liveblocks();
  let data;
  try {
    data = await lb.getRoom(roomId);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  // Two guests joining in the same instant can both get the same colour; fine for now.
  const raw = data.metadata.members;
  const members = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!data.usersAccesses[guestId] || !members.includes(guestId)) {
    await lb.updateRoom(roomId, {
      usersAccesses: { [guestId]: ["room:write"] },
      metadata: { members: members.includes(guestId) ? members : [...members, guestId] },
    });
  }
  const index = members.indexOf(guestId);
  return ((index < 0 ? members.length : index) % MEMBER_COLORS) + 1;
}
